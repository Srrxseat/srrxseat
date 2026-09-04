const assert = require('node:assert');
const { test } = require('node:test');

const { parseLineShipment } = require('../src/parse/parseLineShipment');
const { buildShipmentPlan, categorize, loadCatalog } = require('../src/plan/buildShipmentPlan');

const catalog = loadCatalog();

function planFor(text, opts = {}) {
  return buildShipmentPlan(parseLineShipment(text, { boxTareKg: 1 }), { shipperCountryCode: 'TH', ...opts });
}

const AU = [
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

test('plan ตรงกับที่กรอกมือในวิดีโอทุกช่อง', () => {
  const { ok, plan } = planFor(AU, { invoiceNumber: '2569-09-04-01' });
  assert.equal(ok, true);
  assert.equal(plan.invoiceNumber, '2569-09-04-01');
  assert.equal(plan.receiver.company, '-', 'ไม่มีชื่อบริษัทให้ใส่ขีด');
  assert.equal(plan.purpose, 'Commercial');
  assert.equal(plan.customsLines[0].description, 'REPLACEMENT SEAT HEADREST (NON-LEATHER) / SYNTHETIC FOAM / NON-WOVEN FABRIC');
  assert.equal(plan.customsLines[0].unit, 'Boxes');
  assert.equal(plan.customsLines[0].quantity, 1);
  assert.equal(plan.customsLines[0].unitValue, 280);
  assert.equal(plan.customsLines[0].netWeightKg, 1);
  assert.equal(plan.totalShipmentValue, 330, 'สินค้า 280 + ค่าขนส่ง 50');
  assert.deepEqual(plan.insurance, { enabled: true, value: 280 });
  assert.equal(plan.package.packaging, 'HEADREST');
  assert.equal(plan.package.weightKg, 2);
  assert.deepEqual(
    [plan.package.length, plan.package.width, plan.package.height],
    [35, 25, 7],
  );
  assert.equal(plan.dutiesPaidBy, 'receiver', 'DAP = ผู้รับจ่ายภาษี');
  assert.equal(plan.tradeAgreement, false);
  assert.deepEqual(plan.optionalServices, { goGreenPlus: true, directSignature: true });
  assert.deepEqual(plan.pickup, { requested: true, location: 'Loading Dock', weightKg: 2 });
  assert.equal(plan.service.preferred, 'EXPRESS WORLDWIDE');
});

test('HS code เลือกตามหมวดสินค้าเมื่อ LINE ไม่ระบุ', () => {
  const noHs = AU.split('\n').filter((l) => !l.startsWith('HS Code')).join('\n');
  assert.equal(planFor(noHs).plan.customsLines[0].hsCode, '9401.99.90');

  const fabric = noHs.replace('x2 FISHNET HEADREST BLACK AVUS', 'x2 LE MAN CONFETTI FABRIC');
  const fabricPlan = planFor(fabric).plan;
  assert.equal(fabricPlan.customsLines[0].hsCode, '9401.99.1020');
  assert.equal(fabricPlan.package.packaging, 'UPHOLSTERY KITS');
});

test('หมวดสินค้าจากชื่อ: เบาะ/ที่พักหัว/webbing = 9401.99.90, ผ้า/ชุดหุ้ม = 9401.99.1020', () => {
  assert.equal(categorize('FISHNET HEADREST BLACK', catalog).hsCode, '9401.99.90');
  assert.equal(categorize('SR SEAT BLACK', catalog).hsCode, '9401.99.90');
  assert.equal(categorize('WEBBING MAT', catalog).hsCode, '9401.99.90');
  assert.equal(categorize('SEAT SLIDER BRACKET', catalog).hsCode, '9401.99.90');
  assert.equal(categorize('LE MAN CONFETTI FABRIC', catalog).hsCode, '9401.99.1020');
  assert.equal(categorize('UPHOLSTERY KITS RECARO', catalog).hsCode, '9401.99.1020');
  assert.equal(categorize('SEAT COVERS SET', catalog).hsCode, '9401.99.1020');
  assert.equal(categorize('ของอย่างอื่นที่ไม่รู้จัก', catalog).key, 'other');
});

test('HS code ใน LINE ชนะตารางเสมอ แต่เตือนไว้ให้ตรวจ', () => {
  const mismatch = AU.replace('HS Code: 9401.99.90', 'HS Code: 9401.99.1020');
  const result = planFor(mismatch);
  assert.equal(result.plan.customsLines[0].hsCode, '9401.99.1020');
  assert.ok(result.warnings.some((w) => w.includes('ไม่ตรงกับหมวด')));
});

test('DDP = ผู้ส่งจ่ายภาษี', () => {
  assert.equal(planFor(AU.replace('[DAP]', '[DDP]')).plan.dutiesPaidBy, 'shipper');
});

test('โหมด piece แยกบรรทัดศุลกากรตามจำนวนชิ้น', () => {
  const plan = planFor(AU, { customsLineMode: 'piece' }).plan;
  assert.equal(plan.customsLines[0].quantity, 2);
  assert.equal(plan.customsLines[0].unit, 'Pieces');
  assert.equal(plan.customsLines[0].unitValue, 140);
  assert.equal(plan.customsLines[0].netWeightKg, 0.5);
});

test('ข้อมูลไม่ครบ -> บอกฟิลด์ที่ขาดเป็นภาษาไทย', () => {
  const result = planFor([
    'Item:',
    'x1 HEADREST [100 USD]',
    'Ship to: No Address Guy',
    'Australia',
  ].join('\n'));
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('ที่อยู่'));
  assert.ok(result.missing.includes('เมือง'));
  assert.ok(result.missing.includes('เบอร์โทร'));
  assert.ok(result.missing.includes('ขนาดกล่อง (Box: กxยxส cm)'));
});

test('courier ที่ไม่ใช่ DHL เตือน', () => {
  const result = planFor(AU.replace('[DHL]', '[FEDEX]'));
  assert.ok(result.warnings.some((w) => w.includes('ไม่ใช่ DHL')));
});
