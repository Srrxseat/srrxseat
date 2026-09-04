const assert = require('node:assert');
const { test } = require('node:test');

const { parseLineShipment, parseBox, parseAmount, bracketValue } = require('../src/parse/parseLineShipment');

const AU = [
  'Item:',
  'x2 FISHNET HEADREST BLACK AVUS [280 USD]',
  'Place, Payment: [EBAY]',
  'Courier: [DHL] / [Commercial]',
  'Shipping cost: [50 USD]',
  'HS Code: 9401.99.90',
  'Export terms: [DAP] / @nut',
  'Box: 35x25x7 cm / 1 kg',
  '*******',
  'Ship to: Chris Konstantaras',
  '9 Narani Crescent',
  'Earlwood',
  'Earlwood, NSW 2206',
  'Australia',
  '+61 418 219 809',
  '0122fa03cddd447bc8c9@members.ebay.com',
].join('\n');

test('อ่านใบงานจริงจาก LINE ได้ตรงกับที่กรอกมือ', () => {
  const s = parseLineShipment(AU, { boxTareKg: 1 });
  assert.deepEqual(s.items, [{
    quantity: 2, name: 'FISHNET HEADREST BLACK AVUS', totalValue: 280, currency: 'USD', unitValue: 140,
  }]);
  assert.equal(s.goodsValue, 280);
  assert.equal(s.place, 'EBAY');
  assert.equal(s.courier, 'DHL');
  assert.equal(s.shipmentPurpose, 'Commercial');
  assert.deepEqual(s.shippingCost, { amount: 50, currency: 'USD' });
  assert.equal(s.hsCode, '9401.99.90');
  assert.equal(s.incoterm, 'DAP');
  assert.equal(s.handledBy, '@nut');
  assert.deepEqual(s.box, { length: 35, width: 25, height: 7, netWeightKg: 1, grossWeightKg: 2 });
  assert.equal(s.unknownLines.length, 0);
});

test('แยกที่อยู่ผู้รับแบบ Australia (เมือง, รัฐ ไปรษณีย์) และตัดบรรทัดเขตที่ซ้ำชื่อเมือง', () => {
  const { receiver } = parseLineShipment(AU);
  assert.equal(receiver.name, 'Chris Konstantaras');
  assert.deepEqual(receiver.addressLines, ['9 Narani Crescent']);
  assert.equal(receiver.city, 'Earlwood');
  assert.equal(receiver.state, 'NSW');
  assert.equal(receiver.postalCode, '2206');
  assert.equal(receiver.countryCode, 'AU');
  assert.equal(receiver.countryName, 'Australia');
  assert.equal(receiver.phoneCountryCode, '61');
  assert.equal(receiver.phoneNumber, '418219809');
  assert.equal(receiver.email, '0122fa03cddd447bc8c9@members.ebay.com');
});

test('แยกที่อยู่แบบอเมริกา (ZIP+4) และหลายรายการสินค้า', () => {
  const s = parseLineShipment([
    'Item:',
    'x2 LE MAN CONFETTI FABRIC [258 USD]',
    'x2 BLACK AVUS FABRIC [230 USD]',
    'Place, Payment: [EBAY]',
    'Courier: [DHL] / [Commercial]',
    'Shipping cost: [120 USD]',
    'HS Code: 9401.99.1020',
    'Export terms: [DAP] / @nut',
    'Box: 33x25x7 cm / 1 kg',
    '*******',
    'Ship to: Alex Friedman',
    '6445 Downing St',
    'Denver, CO 80229-7223',
    'United States',
    '+1 720-463-0717',
    'buyer@members.ebay.com',
  ].join('\n'));

  assert.equal(s.items.length, 2);
  assert.equal(s.totalPieces, 4);
  assert.equal(s.goodsValue, 488);
  assert.equal(s.receiver.city, 'Denver');
  assert.equal(s.receiver.state, 'CO');
  assert.equal(s.receiver.postalCode, '80229-7223');
  assert.equal(s.receiver.countryCode, 'US');
  assert.equal(s.receiver.phoneCountryCode, '1');
  assert.equal(s.receiver.phoneNumber, '7204630717');
});

test('น้ำหนักใน LINE คือน้ำหนักของ ไม่รวมกล่อง — น้ำหนักชั่งจริงบวก tare', () => {
  const s = parseLineShipment(AU, { boxTareKg: 1.5 });
  assert.equal(s.box.netWeightKg, 1);
  assert.equal(s.box.grossWeightKg, 2.5);

  // ระบุ Gross มาเองก็ใช้ค่าที่ระบุ ไม่บวก tare ซ้ำ
  const withGross = parseLineShipment(`${AU}\nGross: 3 kg`, { boxTareKg: 1 });
  assert.equal(withGross.box.grossWeightKg, 3);
});

test('ตัวช่วยย่อย: กล่อง / จำนวนเงิน / ค่าในวงเล็บเหลี่ยม', () => {
  assert.deepEqual(parseBox('12x8x4 inch / 500 g'), { length: 30.5, width: 20.3, height: 10.2, netWeightKg: 0.5 });
  assert.deepEqual(parseAmount('[1,250.50 THB]'), { amount: 1250.5, currency: 'THB' });
  assert.equal(bracketValue('[DHL] / [Commercial]', 1), 'Commercial');
  assert.equal(bracketValue('DHL / Commercial', 1), 'Commercial');
});
