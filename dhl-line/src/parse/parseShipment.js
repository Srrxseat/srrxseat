/**
 * แปลงข้อความ Shipment ที่พิมพ์มาใน LINE ให้เป็น object
 *
 * รองรับรูปแบบ "คีย์: ค่า" หนึ่งบรรทัดต่อหนึ่งฟิลด์ (ไทย/อังกฤษ) เช่น
 *
 *   ผู้รับ: Taro Yamada
 *   บริษัท: Yamada Trading
 *   ที่อยู่: 1-2-3 Shibuya
 *           Shibuya-ku
 *   เมือง: Tokyo
 *   รหัสไปรษณีย์: 1500002
 *   ประเทศ: ญี่ปุ่น
 *   โทร: +81 3 1234 5678
 *   น้ำหนัก: 2.5 kg
 *   ขนาด: 30x20x10 cm
 *   สินค้า: เบาะรถยนต์ x 2
 *   มูลค่า: 4,500 บาท
 *   อ้างอิง: SO-2026-0912
 *
 * บรรทัดที่ไม่มีคีย์จะถูกต่อเข้ากับฟิลด์ก่อนหน้า (ใช้กับที่อยู่หลายบรรทัด)
 */

const COUNTRY_ALIASES = {
  ไทย: 'TH', ประเทศไทย: 'TH', thailand: 'TH',
  ญี่ปุ่น: 'JP', japan: 'JP',
  จีน: 'CN', china: 'CN',
  ฮ่องกง: 'HK', 'hong kong': 'HK', hongkong: 'HK',
  ไต้หวัน: 'TW', taiwan: 'TW',
  สิงคโปร์: 'SG', singapore: 'SG',
  มาเลเซีย: 'MY', malaysia: 'MY',
  เวียดนาม: 'VN', vietnam: 'VN',
  อินโดนีเซีย: 'ID', indonesia: 'ID',
  ฟิลิปปินส์: 'PH', philippines: 'PH',
  กัมพูชา: 'KH', cambodia: 'KH',
  ลาว: 'LA', laos: 'LA',
  เมียนมา: 'MM', พม่า: 'MM', myanmar: 'MM',
  เกาหลีใต้: 'KR', เกาหลี: 'KR', 'south korea': 'KR', korea: 'KR',
  อินเดีย: 'IN', india: 'IN',
  ออสเตรเลีย: 'AU', australia: 'AU',
  นิวซีแลนด์: 'NZ', 'new zealand': 'NZ',
  สหรัฐ: 'US', สหรัฐอเมริกา: 'US', อเมริกา: 'US', usa: 'US', 'united states': 'US', us: 'US',
  แคนาดา: 'CA', canada: 'CA',
  อังกฤษ: 'GB', สหราชอาณาจักร: 'GB', uk: 'GB', 'united kingdom': 'GB',
  เยอรมนี: 'DE', เยอรมัน: 'DE', germany: 'DE',
  ฝรั่งเศส: 'FR', france: 'FR',
  เนเธอร์แลนด์: 'NL', netherlands: 'NL',
  อิตาลี: 'IT', italy: 'IT',
  สเปน: 'ES', spain: 'ES',
  สวิตเซอร์แลนด์: 'CH', switzerland: 'CH',
  ยูเออี: 'AE', ดูไบ: 'AE', uae: 'AE', 'united arab emirates': 'AE',
  ซาอุดีอาระเบีย: 'SA', ซาอุ: 'SA', 'saudi arabia': 'SA',
};

const CURRENCY_ALIASES = {
  บาท: 'THB', thb: 'THB', baht: 'THB', '฿': 'THB',
  ดอลลาร์: 'USD', usd: 'USD', '$': 'USD',
  ยูโร: 'EUR', eur: 'EUR', '€': 'EUR',
  เยน: 'JPY', jpy: 'JPY', '¥': 'JPY',
  ปอนด์: 'GBP', gbp: 'GBP', '£': 'GBP',
  sgd: 'SGD', aud: 'AUD', cny: 'CNY', hkd: 'HKD',
};

// คีย์ -> ชื่อฟิลด์ (เทียบแบบ lowercase และตัดช่องว่างออก)
const FIELD_ALIASES = {
  receiverName: ['ผู้รับ', 'ชื่อผู้รับ', 'ชื่อ', 'ชื่อ-นามสกุล', 'name', 'receiver', 'recipient', 'to', 'consignee'],
  receiverCompany: ['บริษัท', 'บริษัทผู้รับ', 'company', 'companyname'],
  addressLine1: ['ที่อยู่', 'ที่อยู่1', 'address', 'address1', 'addr'],
  addressLine2: ['ที่อยู่2', 'address2'],
  addressLine3: ['ที่อยู่3', 'address3'],
  city: ['เมือง', 'อำเภอ', 'เขต', 'city', 'town'],
  state: ['จังหวัด', 'รัฐ', 'state', 'province', 'รัฐ/จังหวัด'],
  postalCode: ['รหัสไปรษณีย์', 'ไปรษณีย์', 'รหัสไปรสณีย์', 'zip', 'zipcode', 'postcode', 'postalcode', 'postal'],
  countryCode: ['ประเทศ', 'country', 'countrycode'],
  phone: ['โทร', 'โทรศัพท์', 'เบอร์', 'เบอร์โทร', 'phone', 'tel', 'telephone', 'mobile'],
  email: ['อีเมล', 'อีเมล์', 'email', 'mail', 'e-mail'],
  weightKg: ['น้ำหนัก', 'weight', 'kg'],
  dimensions: ['ขนาด', 'ขนาดกล่อง', 'dimension', 'dimensions', 'dim', 'size', 'กว้างxยาวxสูง'],
  description: ['สินค้า', 'รายละเอียด', 'รายละเอียดสินค้า', 'description', 'goods', 'item', 'items', 'content', 'contents'],
  quantity: ['จำนวน', 'qty', 'quantity', 'pieces'],
  declaredValue: ['มูลค่า', 'ราคา', 'value', 'declaredvalue', 'invoicevalue'],
  reference: ['อ้างอิง', 'เลขอ้างอิง', 'ออเดอร์', 'เลขออเดอร์', 'ref', 'reference', 'order', 'orderno', 'so'],
  productCode: ['บริการ', 'service', 'product', 'productcode'],
  note: ['หมายเหตุ', 'note', 'remark', 'remarks'],
};

const ALIAS_TO_FIELD = new Map();
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const alias of aliases) ALIAS_TO_FIELD.set(normalizeKey(alias), field);
}

function normalizeKey(s) {
  return String(s).toLowerCase().replace(/[\s_.]+/g, '').replace(/[:：]+$/, '').trim();
}

/** แยกบรรทัดเป็น [key, value] ถ้าเป็นบรรทัดแบบ "คีย์: ค่า" */
function splitKeyValue(line) {
  const m = line.match(/^\s*([^:：=]{1,30}?)\s*[:：=]\s*(.*)$/);
  if (!m) return null;
  const field = ALIAS_TO_FIELD.get(normalizeKey(m[1]));
  if (!field) return null;
  return [field, m[2].trim()];
}

function parseWeightKg(raw) {
  if (!raw) return null;
  const text = String(raw).toLowerCase().replace(/,/g, '');
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kgs?|กก\.?|กิโล(?:กรัม)?|g|gram|กรัม|lbs?|ปอนด์)?/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2] || 'kg';
  if (/^(g|gram|กรัม)$/.test(unit)) return round(value / 1000, 3);
  if (/^(lbs?|ปอนด์)$/.test(unit)) return round(value * 0.45359237, 3);
  return round(value, 3);
}

function parseDimensions(raw) {
  if (!raw) return null;
  const text = String(raw).toLowerCase().replace(/,/g, '');
  const m = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const inch = /(in|inch|นิ้ว)/.test(text);
  const factor = inch ? 2.54 : 1;
  const [length, width, height] = [m[1], m[2], m[3]].map((v) => round(Number(v) * factor, 1));
  if ([length, width, height].some((v) => !Number.isFinite(v) || v <= 0)) return null;
  return { length, width, height };
}

function parseMoney(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const rest = text.replace(/[\d.,\s]/g, '').toLowerCase();
  let currency = null;
  for (const [alias, code] of Object.entries(CURRENCY_ALIASES)) {
    if (rest.includes(alias)) { currency = code; break; }
  }
  return { amount: round(amount, 2), currency };
}

function parseCountry(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  const key = text.toLowerCase();
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  const noSpace = key.replace(/\s+/g, '');
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) {
    if (alias.replace(/\s+/g, '') === noSpace) return code;
  }
  return null;
}

function parsePhone(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return cleaned.length >= 8 ? cleaned : null;
}

function parseEmail(raw) {
  if (!raw) return null;
  const m = String(raw).match(/[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/);
  return m ? m[0] : null;
}

function parseQuantity(raw) {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, '').match(/(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * @param {string} text ข้อความดิบจาก LINE
 * @returns {{shipment: object, rawFields: object, unknownLines: string[]}}
 */
function parseShipment(text) {
  const rawFields = {};
  const unknownLines = [];
  let lastField = null;

  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) { lastField = null; continue; }

    const kv = splitKeyValue(trimmed);
    if (kv) {
      const [field, value] = kv;
      rawFields[field] = rawFields[field] ? `${rawFields[field]} ${value}`.trim() : value;
      lastField = field;
      continue;
    }

    // บรรทัดต่อเนื่อง — ต่อท้ายฟิลด์ก่อนหน้า (ปกติคือที่อยู่)
    if (lastField && ['addressLine1', 'addressLine2', 'addressLine3', 'description', 'note'].includes(lastField)) {
      rawFields[lastField] = `${rawFields[lastField]} ${trimmed}`.trim();
      continue;
    }
    unknownLines.push(trimmed);
  }

  const money = parseMoney(rawFields.declaredValue);
  const shipment = {
    receiverName: rawFields.receiverName || null,
    receiverCompany: rawFields.receiverCompany || null,
    addressLine1: rawFields.addressLine1 || null,
    addressLine2: rawFields.addressLine2 || null,
    addressLine3: rawFields.addressLine3 || null,
    city: rawFields.city || null,
    state: rawFields.state || null,
    postalCode: rawFields.postalCode ? String(rawFields.postalCode).replace(/\s+/g, '') : null,
    countryCode: parseCountry(rawFields.countryCode),
    phone: parsePhone(rawFields.phone),
    email: parseEmail(rawFields.email),
    weightKg: parseWeightKg(rawFields.weightKg),
    dimensions: parseDimensions(rawFields.dimensions),
    description: rawFields.description || null,
    quantity: parseQuantity(rawFields.quantity) || 1,
    declaredValue: money ? money.amount : null,
    currency: money && money.currency ? money.currency : null,
    reference: rawFields.reference || null,
    productCode: rawFields.productCode ? String(rawFields.productCode).toUpperCase() : null,
    note: rawFields.note || null,
  };

  return { shipment, rawFields, unknownLines };
}

module.exports = {
  parseShipment,
  parseWeightKg,
  parseDimensions,
  parseMoney,
  parseCountry,
  parsePhone,
  FIELD_ALIASES,
};
