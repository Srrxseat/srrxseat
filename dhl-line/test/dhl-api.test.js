const assert = require('node:assert');
const { test } = require('node:test');

const { DhlApiClient, nextShippingDateTime } = require('../src/dhl/apiClient');
const { parseLineShipment } = require('../src/parse/parseLineShipment');
const { buildShipmentPlan } = require('../src/plan/buildShipmentPlan');

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
  const parsed = parseLineShipment(text, { boxTareKg: 1 });
  const { plan } = buildShipmentPlan(parsed, { shipperCountryCode: 'TH', invoiceNumber: '2569-09-04-01' });
  return new DhlApiClient(config).buildPayload(plan);
}

const INTERNATIONAL = [
  'Item:', 'x2 FISHNET HEADREST BLACK AVUS [280 USD]', 'Courier: [DHL] / [Commercial]',
  'Shipping cost: [50 USD]', 'HS Code: 9401.99.90', 'Export terms: [DAP] / @nut',
  'Box: 35x25x7 cm / 1 kg', '*******', 'Ship to: Chris Konstantaras', '9 Narani Crescent',
  'Earlwood, NSW 2206', 'Australia', '+61 418 219 809', 'buyer@members.ebay.com',
].join('\n');

test('payload มีโครงสร้างที่ MyDHL API ต้องการ', () => {
  const payload = build(INTERNATIONAL);
  assert.equal(payload.productCode, 'P');
  assert.deepEqual(payload.accounts, [{ typeCode: 'shipper', number: '123456789' }]);
  const receiver = payload.customerDetails.receiverDetails;
  assert.equal(receiver.postalAddress.countryCode, 'AU');
  assert.equal(receiver.postalAddress.cityName, 'Earlwood');
  assert.equal(receiver.postalAddress.provinceCode, 'NSW');
  assert.equal(receiver.contactInformation.phone, '+61418219809');
  assert.equal(receiver.contactInformation.companyName, 'Chris Konstantaras', 'บริษัท "-" ให้ใช้ชื่อคนแทน');
  assert.equal(payload.customerDetails.shipperDetails.postalAddress.cityName, 'Bangkok');
  assert.deepEqual(payload.content.packages[0].dimensions, { length: 35, width: 25, height: 7 });
  assert.equal(payload.content.packages[0].weight, 2);
  assert.equal(payload.content.packages[0].customerReferences[0].value, '2569-09-04-01');
  assert.match(payload.plannedShippingDateAndTime, /^\d{4}-\d{2}-\d{2}T10:00:00 GMT\+07:00$/);
});

test('ส่งข้ามประเทศต้องมี exportDeclaration + HS code + ค่าขนส่ง + ประกัน', () => {
  const payload = build(INTERNATIONAL);
  assert.equal(payload.content.isCustomsDeclarable, true);
  assert.equal(payload.content.declaredValue, 280);
  assert.equal(payload.content.declaredValueCurrency, 'USD');
  assert.equal(payload.content.incoterm, 'DAP');
  const declaration = payload.content.exportDeclaration;
  assert.equal(declaration.invoice.number, '2569-09-04-01');
  assert.deepEqual(declaration.additionalCharges, [{ value: 50, caption: 'freight', typeCode: 'freight' }]);
  const item = declaration.lineItems[0];
  assert.equal(item.quantity.value, 1);
  assert.equal(item.quantity.unitOfMeasurement, 'BOX');
  assert.equal(item.price, 280);
  assert.deepEqual(item.commodityCodes, [{ typeCode: 'outbound', value: '94019990' }]);
  assert.equal(item.weight.netValue, 1);
  assert.equal(item.weight.grossValue, 2);
  assert.equal(item.manufacturerCountry, 'TH');
  assert.deepEqual(payload.valueAddedServices, [{ serviceCode: 'II', value: 280, currency: 'USD' }]);
});

test('ส่งในประเทศไม่ใส่ข้อมูลศุลกากร และไม่มีฟิลด์ว่างหลุดไปใน payload', () => {
  const payload = build([
    'Item:', 'x1 HEADREST BLACK [1000 THB]', 'Courier: [DHL] / [Commercial]',
    'Box: 35x25x7 cm / 1 kg', '*******', 'Ship to: สมชาย', '99 Sukhumvit Rd',
    'Bangkok 10110', 'Thailand', '+66 81 234 5678', 'somchai@example.com',
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
