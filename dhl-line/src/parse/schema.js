/** ตรวจความครบถ้วนของข้อมูล Shipment ก่อนส่งให้ DHL */

// ประเทศ/เขตที่ไม่ใช้รหัสไปรษณีย์
const NO_POSTAL_CODE = new Set(['HK', 'MO', 'AE', 'QA', 'KW', 'BH', 'OM', 'IE', 'PA', 'AO', 'BS', 'BZ', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CF', 'KM', 'CG', 'CD', 'CK', 'CI', 'DJ', 'DM', 'GQ', 'ER', 'FJ', 'TF', 'GM', 'GH', 'GD', 'GY', 'LY', 'MW', 'ML', 'MR', 'NR', 'AN', 'AW', 'QA', 'RW', 'KN', 'LC', 'ST', 'SC', 'SL', 'SB', 'SO', 'SR', 'SY', 'TZ', 'TL', 'TG', 'TO', 'TT', 'TV', 'UG', 'VU', 'YE', 'ZW']);

const LABELS = {
  receiverName: 'ชื่อผู้รับ',
  addressLine1: 'ที่อยู่',
  city: 'เมือง',
  state: 'รัฐ/จังหวัด',
  postalCode: 'รหัสไปรษณีย์',
  countryCode: 'ประเทศ',
  phone: 'เบอร์โทร',
  weightKg: 'น้ำหนัก (กก.)',
  dimensions: 'ขนาดกล่อง (กxยxส ซม.)',
  description: 'รายละเอียดสินค้า',
  declaredValue: 'มูลค่าสินค้า',
};

// ประเทศที่ DHL บังคับให้มี state code
const STATE_REQUIRED = new Set(['US', 'CA', 'AU', 'IN', 'BR', 'MX', 'CN', 'JP', 'IE']);

/**
 * @param {object} shipment ผลจาก parseShipment()
 * @param {{shipperCountryCode?: string, defaultCurrency?: string}} [opts]
 * @returns {{ok: boolean, missing: string[], warnings: string[], shipment: object}}
 */
function validateShipment(shipment, opts = {}) {
  const shipperCountry = (opts.shipperCountryCode || 'TH').toUpperCase();
  const s = { ...shipment };
  const missing = [];
  const warnings = [];

  const required = ['receiverName', 'addressLine1', 'city', 'countryCode', 'phone', 'weightKg'];
  for (const field of required) {
    if (!s[field]) missing.push(LABELS[field] || field);
  }

  if (s.countryCode) {
    if (!NO_POSTAL_CODE.has(s.countryCode) && !s.postalCode) missing.push(LABELS.postalCode);
    if (STATE_REQUIRED.has(s.countryCode) && !s.state) missing.push(LABELS.state);

    // ส่งข้ามประเทศ = ต้องมีข้อมูลศุลกากร
    const international = s.countryCode !== shipperCountry;
    if (international) {
      if (!s.description) missing.push(LABELS.description);
      if (!s.declaredValue) missing.push(LABELS.declaredValue);
      if (s.declaredValue && !s.currency) {
        s.currency = opts.defaultCurrency || 'THB';
        warnings.push(`ไม่ระบุสกุลเงิน ใช้ ${s.currency} เป็นค่าเริ่มต้น`);
      }
    }
    s.isCustomsDeclarable = international;
  }

  if (!s.dimensions) {
    s.dimensions = { length: 30, width: 20, height: 15 };
    warnings.push('ไม่ระบุขนาดกล่อง ใช้ค่าเริ่มต้น 30x20x15 ซม.');
  }
  if (s.weightKg && s.weightKg > 70) {
    warnings.push('น้ำหนักเกิน 70 กก. ต่อกล่อง DHL Express อาจไม่รับ ตรวจสอบก่อนพิมพ์');
  }
  if (!s.email) warnings.push('ไม่มีอีเมลผู้รับ DHL จะไม่ส่งอีเมลแจ้งเตือนให้ผู้รับ');

  return { ok: missing.length === 0, missing: [...new Set(missing)], warnings, shipment: s };
}

module.exports = { validateShipment, LABELS, NO_POSTAL_CODE, STATE_REQUIRED };
