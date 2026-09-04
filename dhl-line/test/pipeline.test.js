const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { JobStore, STATUS } = require('../src/store/jobStore');
const { intake } = require('../src/intake');
const { processJob } = require('../src/pipeline');
const { verifySignature } = require('../src/line/client');

const CONFIG = { shipper: { countryCode: 'TH' }, boxTareKg: 1, customsLineMode: 'box' };

const GOOD_TEXT = [
  'Item:',
  'x2 FISHNET HEADREST BLACK AVUS [280 USD]',
  'Courier: [DHL] / [Commercial]',
  'Shipping cost: [50 USD]',
  'HS Code: 9401.99.90',
  'Export terms: [DAP] / @nut',
  'Box: 35x25x7 cm / 1 kg',
  '*******',
  'Ship to: Chris Konstantaras',
  '9 Narani Crescent',
  'Earlwood, NSW 2206',
  'Australia',
  '+61 418 219 809',
  'buyer@members.ebay.com',
].join('\n');

function newStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dhl-line-test-'));
  return new JobStore(dir);
}

test('ข้อความครบ -> งานสถานะ pending, ข้อความเดิมซ้ำ -> ไม่สร้างงานใหม่', () => {
  const store = newStore();
  const first = intake({ store, config: CONFIG, text: GOOD_TEXT, sourceId: 'G1', messageId: 'm1' });
  assert.equal(first.kind, 'job');
  assert.equal(first.job.status, STATUS.PENDING);

  const again = intake({ store, config: CONFIG, text: GOOD_TEXT, sourceId: 'G1', messageId: 'm1' });
  assert.equal(again.kind, 'duplicate');
  assert.equal(again.job.jobId, first.job.jobId);
  assert.equal(store.list().length, 1);
});

test('ข้อมูลไม่ครบ -> needs_input และบอกฟิลด์ที่ขาด', () => {
  const store = newStore();
  const text = ['Item:', 'x1 HEADREST [100 USD]', 'Ship to: No Address Guy', 'Australia'].join('\n');
  const result = intake({ store, config: CONFIG, text, sourceId: 'G1', messageId: 'm2' });
  assert.equal(result.job.status, STATUS.NEEDS_INPUT);
  assert.ok(result.reply.includes('ที่อยู่'));
});

test('ข้อความคุยกันธรรมดาในกลุ่มไม่สร้างงานและไม่ตอบ', () => {
  const store = newStore();
  const result = intake({ store, config: CONFIG, text: 'พี่ส่งของให้ด้วยนะครับ', sourceId: 'G1', messageId: 'm9' });
  assert.equal(result.kind, 'ignored');
  assert.equal(result.reply, null);
  assert.equal(store.list().length, 0);
});

test('คำว่า "ช่วยเหลือ" และ "สถานะ" ไม่สร้างงาน', () => {
  const store = newStore();
  assert.equal(intake({ store, config: CONFIG, text: 'ช่วยเหลือ', sourceId: 'G1' }).kind, 'help');
  assert.equal(intake({ store, config: CONFIG, text: 'สถานะ', sourceId: 'G1' }).kind, 'status');
  assert.equal(store.list().length, 0);
});

test('pipeline สร้าง shipment เซฟ label แล้วสั่งพิมพ์', async () => {
  const store = newStore();
  const { job } = intake({ store, config: CONFIG, text: GOOD_TEXT, sourceId: 'G1', messageId: 'm3' });
  const claimed = store.claimNext();
  assert.equal(claimed.jobId, job.jobId);

  const printed = [];
  const pushed = [];
  const done = await processJob({
    store,
    config: CONFIG,
    dhl: {
      async createShipment() {
        return { trackingNumber: '1234567890', label: { buffer: Buffer.from('%PDF-1.4 fake'), ext: 'pdf' } };
      },
    },
    printer: {
      async print(file) { printed.push(file); return { printer: 'TEST_PRINTER', jobId: 'TEST-1' }; },
    },
    line: { async push(to, text) { pushed.push({ to, text }); } },
  }, claimed);

  assert.equal(done.status, STATUS.DONE);
  assert.equal(done.trackingNumber, '1234567890');
  assert.equal(printed.length, 1);
  assert.equal(fs.readFileSync(done.labelPath, 'utf8'), '%PDF-1.4 fake');
  assert.equal(pushed[0].to, 'G1');
  assert.ok(pushed[0].text.includes('1234567890'));
});

test('พิมพ์ไม่ผ่านแต่สร้าง shipment แล้ว -> ลองใหม่ไม่สร้าง shipment ซ้ำ', async () => {
  const store = newStore();
  intake({ store, config: CONFIG, text: GOOD_TEXT, sourceId: 'G1', messageId: 'm4' });

  let created = 0;
  let printAttempts = 0;
  const deps = {
    store,
    config: CONFIG,
    dhl: {
      async createShipment() {
        created += 1;
        return { trackingNumber: '9999999999', label: { buffer: Buffer.from('pdf'), ext: 'pdf' } };
      },
    },
    printer: {
      async print() {
        printAttempts += 1;
        if (printAttempts === 1) throw new Error('เครื่องพิมพ์ออฟไลน์');
        return { printer: 'TEST_PRINTER', jobId: 'TEST-2' };
      },
    },
    line: { async push() {} },
  };

  const firstRound = await processJob(deps, store.claimNext());
  assert.equal(firstRound.status, STATUS.SHIPMENT_CREATED);
  assert.match(firstRound.error, /ออฟไลน์/);

  const secondRound = await processJob(deps, store.claimNext());
  assert.equal(secondRound.status, STATUS.DONE);
  assert.equal(created, 1, 'ต้องไม่สร้าง shipment ซ้ำจนเสียเงินสองรอบ');
});

test('ล้มเหลวครบ 3 ครั้ง -> failed และแจ้ง LINE', async () => {
  const store = newStore();
  intake({ store, config: CONFIG, text: GOOD_TEXT, sourceId: 'G1', messageId: 'm5' });
  const pushed = [];
  const deps = {
    store,
    config: CONFIG,
    dhl: { async createShipment() { throw new Error('DHL API 422: postal code invalid'); } },
    printer: { async print() { return {}; } },
    line: { async push(to, text) { pushed.push(text); } },
  };

  let job = null;
  for (let i = 0; i < 3; i += 1) job = await processJob(deps, store.claimNext());

  assert.equal(job.status, STATUS.FAILED);
  assert.equal(pushed.length, 1, 'แจ้งครั้งเดียวเมื่อเลิกลองแล้ว');
  assert.ok(pushed[0].includes('postal code invalid'));
  assert.equal(store.claimNext(), null, 'งานที่ failed ต้องไม่ถูกหยิบมาทำเองอีก');
});

test('สั่ง "ลองใหม่ <jobId>" ปลุกงานที่ failed', async () => {
  const store = newStore();
  const { job } = intake({ store, config: CONFIG, text: GOOD_TEXT, sourceId: 'G1', messageId: 'm6' });
  store.update(job.jobId, { status: STATUS.FAILED, error: 'x' });
  const result = intake({ store, config: CONFIG, text: `ลองใหม่ ${job.jobId}`, sourceId: 'G1', messageId: 'm7' });
  assert.equal(result.kind, 'retry');
  assert.equal(store.get(job.jobId).status, STATUS.PENDING);
});

test('pipeline ออกเลขอินวอยซ์ให้ตอนยิงจริง และลองใหม่ใช้เลขเดิม', async () => {
  const store = newStore();
  intake({ store, config: CONFIG, text: GOOD_TEXT, sourceId: 'G1', messageId: 'm8' });

  const issued = [];
  const invoiceSequence = {
    next() { const n = `2569-09-04-0${issued.length + 1}`; issued.push(n); return n; },
  };
  const seen = [];
  let printOk = false;
  const deps = {
    store,
    config: CONFIG,
    invoiceSequence,
    dhl: {
      async createShipment(plan) {
        seen.push(plan.invoiceNumber);
        return {
          trackingNumber: '2222514055',
          pickupConfirmation: 'CBJ260904140637',
          label: { buffer: Buffer.from('pdf'), ext: 'pdf' },
        };
      },
    },
    printer: {
      async print() {
        if (!printOk) { printOk = true; throw new Error('เครื่องพิมพ์ออฟไลน์'); }
        return { printer: 'TEST', jobId: '1' };
      },
    },
    line: { async push() {} },
  };

  const first = await processJob(deps, store.claimNext());
  assert.equal(first.invoiceNumber, '2569-09-04-01');
  assert.equal(first.trackingNumber, '2222514055');
  assert.equal(first.pickupConfirmation, 'CBJ260904140637');

  const second = await processJob(deps, store.claimNext());
  assert.equal(second.status, STATUS.DONE);
  assert.deepEqual(seen, ['2569-09-04-01'], 'รอบสองไม่สร้าง shipment ใหม่ จึงไม่กินเลขอินวอยซ์เพิ่ม');
  assert.equal(issued.length, 1);
});

test('ตรวจลายเซ็น LINE webhook', () => {
  const secret = 'sekret';
  const body = Buffer.from(JSON.stringify({ events: [] }));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64');
  assert.equal(verifySignature(body, signature, secret), true);
  assert.equal(verifySignature(body, signature, 'wrong'), false);
  assert.equal(verifySignature(body, 'AAAA', secret), false);
  assert.equal(verifySignature(body, undefined, secret), false);
});
