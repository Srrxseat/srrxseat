const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { InvoiceSequence } = require('../src/store/invoiceSequence');

function newSeq() {
  return new InvoiceSequence(fs.mkdtempSync(path.join(os.tmpdir(), 'dhl-seq-')));
}

test('เลขอินวอยซ์ = พ.ศ.-เดือน-วัน-ลำดับของวัน', () => {
  const seq = newSeq();
  const morning = new Date('2026-09-04T03:00:00Z'); // 10:00 น. ไทย
  assert.equal(seq.next(morning), '2569-09-04-01');
  assert.equal(seq.next(morning), '2569-09-04-02');
  assert.equal(seq.next(new Date('2026-09-04T10:00:00Z')), '2569-09-04-03');
});

test('ขึ้นวันใหม่เริ่มนับ 01 ใหม่', () => {
  const seq = newSeq();
  assert.equal(seq.next(new Date('2026-09-04T03:00:00Z')), '2569-09-04-01');
  assert.equal(seq.next(new Date('2026-09-05T03:00:00Z')), '2569-09-05-01');
  // 31 ธ.ค. 2026 เวลา 18:00Z = 1 ม.ค. 2027 ตอน 01:00 น. เวลาไทย -> ขึ้น พ.ศ. ใหม่
  assert.equal(seq.next(new Date('2026-12-31T18:00:00Z')), '2570-01-01-01');
});

test('peek ไม่กินเลข', () => {
  const seq = newSeq();
  const t = new Date('2026-09-04T03:00:00Z');
  assert.equal(seq.peek(t), null);
  assert.equal(seq.next(t), '2569-09-04-01');
  assert.equal(seq.peek(t), '2569-09-04-01');
  assert.equal(seq.peek(t), '2569-09-04-01');
  assert.equal(seq.next(t), '2569-09-04-02');
});
