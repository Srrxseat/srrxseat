const assert = require('node:assert');
const { test } = require('node:test');

const { DhlApiClient, nextShippingDateTime } = require('../src/dhl/apiClient');
const { parseShipment } = require('../src/parse/parseShipment');
const { validateShipment } = require('../src/parse/schema');

const config = {
  dhl: {
    api: {
      base: 'https://express.api.dhl.com/mydhlapi',
      username: 'u', password: 'p', accountNumber: '123456789',
      productCode: 'P', labelFormat: 'PDF', incoterm: 'DAP', unitOfMeasurement: 'metric',
      timezoneOffset: '+07:00', pickupRequested: false, labelTemplate: 'ECOM26_84_A4_001',
    },
  },
  shipper: {
    name: 'SRRX Seat', company: 'SRRX Seat Co., Ltd.', phone: '+66812345678', email: 'info@srrxseat.com',
    addressLine1: '99 Sukhumvit Rd', addressLine2: '', city: 'Bangkok', state: '',
    postalCode: '10110', countryCode: 'TH',
  },
};

function build(text) {
  const { shipment } = parseShipment(text);
  const { shipment: normalized } = validateShipment(shipment, { shipperCountryCode: 'TH' });
  return new DhlApiClient(config).buildPayload(normalized);
}

const INTERNATIONAL = [
  'ผู้รับ: Taro Yamada', 'ที่อยู่: 1-2-3 Shibuya', 'เมือง: Tokyo', 'รัฐ/จังหวัด: Tokyo',
  'รหัสไปรษณีย์: 1500002', 'ประเทศ: ญี่ปุ่น', 'โทร: +81312345678', 'น้ำหนัก: 2.5 kg',
  'ขนาด: 30x20x10 cm', 'สินค้า: Car seat cover', 'จำนวน: 2', 'มูลค่า: 4500 บาท', 'อ้างอิง: SO-1',
].join('\n');

test('payload มีโครงสร้างที่ MyDHL API ต้องการ', () => {
  const payload = build(INTERNATIONAL);
  assert.equal(payload.productCode, 'P');
  assert.deepEqual(payload.accounts, [{ typeCode: 'shipper', number: '123456789' }]);
  assert.equal(payload.customerDetails.receiverDetails.postalAddress.countryCode, 'JP');
  assert.equal(payload.customerDetails.shipperDetails.postalAddress.cityName, 'Bangkok');
  assert.deepEqual(payload.content.packages[0].dimensions, { length: 30, width: 20, height: 10 });
  assert.equal(payload.content.packages[0].weight, 2.5);
  assert.equal(payload.content.packages[0].customerReferences[0].value, 'SO-1');
  assert.match(payload.plannedShippingDateAndTime, /^\d{4}-\d{2}-\d{2}T10:00:00 GMT\+07:00$/);
});

test('ส่งข้ามประเทศต้องมี exportDeclaration และราคาต่อชิ้น', () => {
  const payload = build(INTERNATIONAL);
  assert.equal(payload.content.isCustomsDeclarable, true);
  assert.equal(payload.content.declaredValue, 4500);
  assert.equal(payload.content.declaredValueCurrency, 'THB');
  const item = payload.content.exportDeclaration.lineItems[0];
  assert.equal(item.quantity.value, 2);
  assert.equal(item.price, 2250, 'ราคาต่อชิ้น = มูลค่ารวม / จำนวน');
  assert.equal(item.manufacturerCountry, 'TH');
});

test('ส่งในประเทศไม่ใส่ข้อมูลศุลกากร และไม่มีฟิลด์ว่างหลุดไปใน payload', () => {
  const payload = build([
    'ผู้รับ: สมชาย', 'ที่อยู่: 99 ถนนสุขุมวิท', 'เมือง: กรุงเทพ', 'รหัสไปรษณีย์: 10110',
    'ประเทศ: ไทย', 'โทร: 0812345678', 'น้ำหนัก: 1 kg',
  ].join('\n'));
  assert.equal(payload.content.isCustomsDeclarable, false);
  assert.equal(payload.content.exportDeclaration, undefined);
  assert.equal('addressLine2' in payload.customerDetails.receiverDetails.postalAddress, false);
  assert.equal('provinceCode' in payload.customerDetails.shipperDetails.postalAddress, false);
});

test('วันส่งเลื่อนเป็นวันถัดไปเมื่อเลยเวลา และไม่ตรงวันอาทิตย์', () => {
  const date = nextShippingDateTime('+07:00').slice(0, 10);
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  assert.notEqual(day, 0);
  assert.ok(date >= new Date().toISOString().slice(0, 10));
});
