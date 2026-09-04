const assert = require('node:assert');
const { test } = require('node:test');

const { parseShipment, parseWeightKg, parseDimensions, parseMoney, parseCountry, parsePhone } = require('../src/parse/parseShipment');
const { validateShipment } = require('../src/parse/schema');

test('อ่านฟอร์มภาษาไทยได้ครบทุกฟิลด์', () => {
  const { shipment } = parseShipment([
    'ผู้รับ: Taro Yamada',
    'ที่อยู่: 1-2-3 Shibuya',
    'Shibuya-ku',
    'เมือง: Tokyo',
    'รหัสไปรษณีย์: 150-0002',
    'ประเทศ: ญี่ปุ่น',
    'โทร: 081-234-5678',
    'น้ำหนัก: 2.5 kg',
    'ขนาด: 30x20x10 ซม.',
    'สินค้า: เบาะรถยนต์',
    'มูลค่า: 4,500 บาท',
  ].join('\n'));

  assert.equal(shipment.receiverName, 'Taro Yamada');
  assert.equal(shipment.addressLine1, '1-2-3 Shibuya Shibuya-ku', 'บรรทัดต่อเนื่องต้องต่อเข้ากับที่อยู่');
  assert.equal(shipment.countryCode, 'JP');
  assert.equal(shipment.postalCode, '150-0002');
  assert.equal(shipment.phone, '0812345678');
  assert.equal(shipment.weightKg, 2.5);
  assert.deepEqual(shipment.dimensions, { length: 30, width: 20, height: 10 });
  assert.equal(shipment.declaredValue, 4500);
  assert.equal(shipment.currency, 'THB');
});

test('อ่านฟอร์มภาษาอังกฤษและคีย์แบบย่อได้', () => {
  const { shipment } = parseShipment([
    'Name: John Smith',
    'Address: 100 Main St',
    'City: Dallas',
    'State: TX',
    'Zip: 75201',
    'Country: US',
    'Tel: +1 214 555 0100',
    'Weight: 3 kg',
    'Items: Seat covers',
    'Value: 200 USD',
  ].join('\n'));

  assert.equal(shipment.receiverName, 'John Smith');
  assert.equal(shipment.state, 'TX');
  assert.equal(shipment.countryCode, 'US');
  assert.equal(shipment.currency, 'USD');
  assert.equal(shipment.declaredValue, 200);
});

test('แปลงหน่วยน้ำหนักและขนาด', () => {
  assert.equal(parseWeightKg('500 g'), 0.5);
  assert.equal(parseWeightKg('2 กก.'), 2);
  assert.equal(parseWeightKg('1 lb'), 0.454);
  assert.equal(parseWeightKg('0'), null);
  assert.deepEqual(parseDimensions('12 x 8 x 4 inch'), { length: 30.5, width: 20.3, height: 10.2 });
  assert.equal(parseDimensions('30x20'), null);
});

test('แปลงประเทศ สกุลเงิน เบอร์โทร', () => {
  assert.equal(parseCountry('ญี่ปุ่น'), 'JP');
  assert.equal(parseCountry('hong kong'), 'HK');
  assert.equal(parseCountry('de'), 'DE');
  assert.equal(parseCountry('ดาวอังคาร'), null);
  assert.deepEqual(parseMoney('฿1,250.50'), { amount: 1250.5, currency: 'THB' });
  assert.equal(parsePhone('02-000'), null, 'เบอร์สั้นเกินไปถือว่าไม่ผ่าน');
});

test('ข้อความที่ไม่ใช่ฟอร์มไม่ถูกอ่านเป็นฟิลด์', () => {
  const { shipment, unknownLines } = parseShipment('สวัสดีครับ พี่ส่งของให้ด้วยนะ');
  assert.equal(shipment.receiverName, null);
  assert.equal(unknownLines.length, 1);
});

test('validate บอกฟิลด์ที่ขาดเป็นภาษาไทย', () => {
  const { shipment } = parseShipment('ผู้รับ: A\nประเทศ: JP\nโทร: 0812345678');
  const result = validateShipment(shipment, { shipperCountryCode: 'TH' });
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('ที่อยู่'));
  assert.ok(result.missing.includes('รหัสไปรษณีย์'));
  assert.ok(result.missing.includes('มูลค่าสินค้า'), 'ส่งข้ามประเทศต้องมีมูลค่าสำหรับศุลกากร');
});

test('ส่งในประเทศไม่ต้องมีข้อมูลศุลกากร และไม่ต้องมีรหัสไปรษณีย์ในเขตที่ไม่ใช้', () => {
  const domestic = validateShipment(parseShipment([
    'ผู้รับ: สมชาย',
    'ที่อยู่: 99 ถนนสุขุมวิท',
    'เมือง: กรุงเทพ',
    'รหัสไปรษณีย์: 10110',
    'ประเทศ: ไทย',
    'โทร: 0812345678',
    'น้ำหนัก: 1 kg',
  ].join('\n')).shipment, { shipperCountryCode: 'TH' });
  assert.equal(domestic.ok, true);
  assert.equal(domestic.shipment.isCustomsDeclarable, false);

  const hk = validateShipment(parseShipment([
    'ผู้รับ: Chan',
    'ที่อยู่: 1 Queen Rd',
    'เมือง: Hong Kong',
    'ประเทศ: ฮ่องกง',
    'โทร: +852 2000 0000',
    'น้ำหนัก: 1 kg',
    'สินค้า: parts',
    'มูลค่า: 500 บาท',
  ].join('\n')).shipment, { shipperCountryCode: 'TH' });
  assert.equal(hk.ok, true, hk.missing.join(','));
});
