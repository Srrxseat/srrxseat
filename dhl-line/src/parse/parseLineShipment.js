/**
 * อ่านข้อความ Shipment ที่ส่งเข้ามาในกลุ่ม LINE (ฟอร์แมตที่ใช้งานจริง)
 *
 *   Item:
 *   x2 FISHNET HEADREST BLACK AVUS [280 USD]
 *   Place, Payment: [EBAY]
 *   Courier: [DHL] / [Commercial]
 *   Shipping cost: [50 USD]
 *   HS Code: 9401.99.90
 *   Export terms: [DAP] / @nut
 *   Box: 35x25x7 cm / 1 kg
 *   *******
 *   Ship to: Chris Konstantaras
 *   9 Narani Crescent
 *   Earlwood
 *   Earlwood, NSW 2206
 *   Australia
 *   +61 418 219 809
 *   0122fa03cddd447bc8c9@members.ebay.com
 *
 * หมายเหตุเรื่องน้ำหนัก (ยืนยันจากงานจริง):
 *   - ตัวเลขหลัง "Box: ... /" คือน้ำหนักของ "ไม่รวมกล่อง" ต่อ 1 ชิ้น -> ใช้ในบรรทัดศุลกากร
 *   - น้ำหนักที่กรอกในขั้นเลือกบรรจุภัณฑ์ = น้ำหนักของ + น้ำหนักกล่อง (tare) ต่อ 1 ชิ้น
 *     ตั้งค่า tare ได้ที่ BOX_TARE_KG (ดีฟอลต์ 1 กก. ทำให้ของ 1 กก. -> ชั่งได้ 2 กก.)
 */

const COUNTRY_BY_NAME = {
  'thailand': { code: 'TH', name: 'Thailand', dial: '66' },
  'australia': { code: 'AU', name: 'Australia', dial: '61' },
  'united states': { code: 'US', name: 'United States of America', dial: '1' },
  'united states of america': { code: 'US', name: 'United States of America', dial: '1' },
  'usa': { code: 'US', name: 'United States of America', dial: '1' },
  'canada': { code: 'CA', name: 'Canada', dial: '1' },
  'united kingdom': { code: 'GB', name: 'United Kingdom', dial: '44' },
  'uk': { code: 'GB', name: 'United Kingdom', dial: '44' },
  'england': { code: 'GB', name: 'United Kingdom', dial: '44' },
  'germany': { code: 'DE', name: 'Germany', dial: '49' },
  'france': { code: 'FR', name: 'France', dial: '33' },
  'netherlands': { code: 'NL', name: 'Netherlands', dial: '31' },
  'italy': { code: 'IT', name: 'Italy', dial: '39' },
  'spain': { code: 'ES', name: 'Spain', dial: '34' },
  'switzerland': { code: 'CH', name: 'Switzerland', dial: '41' },
  'sweden': { code: 'SE', name: 'Sweden', dial: '46' },
  'norway': { code: 'NO', name: 'Norway', dial: '47' },
  'denmark': { code: 'DK', name: 'Denmark', dial: '45' },
  'belgium': { code: 'BE', name: 'Belgium', dial: '32' },
  'austria': { code: 'AT', name: 'Austria', dial: '43' },
  'poland': { code: 'PL', name: 'Poland', dial: '48' },
  'ireland': { code: 'IE', name: 'Ireland', dial: '353' },
  'new zealand': { code: 'NZ', name: 'New Zealand', dial: '64' },
  'japan': { code: 'JP', name: 'Japan', dial: '81' },
  'singapore': { code: 'SG', name: 'Singapore', dial: '65' },
  'malaysia': { code: 'MY', name: 'Malaysia', dial: '60' },
  'hong kong': { code: 'HK', name: 'Hong Kong', dial: '852' },
  'taiwan': { code: 'TW', name: 'Taiwan', dial: '886' },
  'china': { code: 'CN', name: 'China', dial: '86' },
  'south korea': { code: 'KR', name: 'Korea, Republic of', dial: '82' },
  'korea': { code: 'KR', name: 'Korea, Republic of', dial: '82' },
  'united arab emirates': { code: 'AE', name: 'United Arab Emirates', dial: '971' },
  'israel': { code: 'IL', name: 'Israel', dial: '972' },
  'south africa': { code: 'ZA', name: 'South Africa', dial: '27' },
  'brazil': { code: 'BR', name: 'Brazil', dial: '55' },
  'mexico': { code: 'MX', name: 'Mexico', dial: '52' },
};

const KV_PATTERNS = {
  place: /^place[,\s]*payment\s*:?\s*(.*)$/i,
  courier: /^courier\s*:?\s*(.*)$/i,
  shippingCost: /^shipping\s*cost\s*:?\s*(.*)$/i,
  hsCode: /^hs\s*code\s*:?\s*(.*)$/i,
  exportTerms: /^export\s*terms?\s*:?\s*(.*)$/i,
  box: /^box\s*:?\s*(.*)$/i,
  netWeight: /^net(?:\s*weight)?\s*:?\s*(.*)$/i,
  grossWeight: /^gross(?:\s*weight)?\s*:?\s*(.*)$/i,
  invoiceNumber: /^invoice(?:\s*(?:no|number))?\s*:?\s*(.*)$/i,
};

const ITEM_LINE = /^x\s*(\d+)\s+(.+?)\s*(?:\[\s*([\d.,]+)\s*([A-Za-z]{3})?\s*\])?\s*$/;
const SEPARATOR = /^[*=\-_~]{3,}$/;
const SHIP_TO = /^ship\s*to\s*:?\s*(.*)$/i;
const PHONE_LINE = /^\+?[\d][\d\s().\-]{6,}$/;
const EMAIL_LINE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// "Denver, CO 80229-7223" / "Earlwood, NSW 2206" / "London EC1A 1BB" / "Tokyo 150-0002"
const CITY_STATE_ZIP = /^(.+?),\s*([A-Za-z][A-Za-z.\s]{0,20}?)\s+([A-Za-z0-9][A-Za-z0-9\s-]{2,10})$/;
const CITY_ZIP = /^(.+?)\s+(\d{4,5}(?:-\d{4})?)$/;

/**
 * @param {string} text ข้อความดิบจาก LINE
 * @param {{boxTareKg?: number}} [opts]
 */
function parseLineShipment(text, opts = {}) {
  const boxTareKg = opts.boxTareKg ?? 1;
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim());

  const items = [];
  const fields = {};
  const shipToLines = [];
  let mode = 'header';

  for (const line of lines) {
    if (!line) continue;
    if (SEPARATOR.test(line)) continue;

    const shipTo = line.match(SHIP_TO);
    if (shipTo) {
      mode = 'shipTo';
      if (shipTo[1]) shipToLines.push(shipTo[1].trim());
      continue;
    }

    const kv = matchKeyValue(line);
    if (kv) {
      // คีย์ที่รู้จัก (เช่น Net:/Gross:) ใช้ได้แม้จะพิมพ์ต่อท้ายบล็อกที่อยู่
      fields[kv[0]] = kv[1];
      continue;
    }

    if (mode === 'shipTo') {
      shipToLines.push(line);
      continue;
    }

    if (/^item\s*:?\s*$/i.test(line)) continue;

    const item = line.match(ITEM_LINE);
    if (item) {
      items.push({
        quantity: parseInt(item[1], 10),
        name: item[2].trim(),
        totalValue: item[3] ? Number(item[3].replace(/,/g, '')) : null,
        currency: (item[4] || 'USD').toUpperCase(),
      });
      continue;
    }

    fields._unknown = [...(fields._unknown || []), line];
  }

  const box = parseBox(fields.box);
  const netPerPiece = parseWeightKg(fields.netWeight) ?? box.netWeightKg;
  const totalPieces = items.reduce((sum, i) => sum + i.quantity, 0) || 1;
  const grossPerPiece = parseWeightKg(fields.grossWeight)
    ?? (netPerPiece !== null ? round(netPerPiece + boxTareKg, 2) : null);

  const shipment = {
    items: items.map((i) => ({
      ...i,
      unitValue: i.totalValue !== null ? round(i.totalValue / i.quantity, 2) : null,
    })),
    totalPieces,
    goodsValue: items.reduce((sum, i) => sum + (i.totalValue || 0), 0) || null,
    currency: items.find((i) => i.currency)?.currency || 'USD',
    place: bracketValue(fields.place),
    courier: bracketValue(fields.courier, 0),
    shipmentPurpose: bracketValue(fields.courier, 1) || 'Commercial',
    shippingCost: parseAmount(fields.shippingCost),
    hsCode: fields.hsCode ? fields.hsCode.replace(/[[\]\s]/g, '') : null,
    incoterm: (bracketValue(fields.exportTerms, 0) || 'DAP').toUpperCase(),
    handledBy: (fields.exportTerms || '').match(/@\S+/)?.[0] || null,
    invoiceNumber: fields.invoiceNumber || null,
    box: {
      length: box.length,
      width: box.width,
      height: box.height,
      netWeightKg: netPerPiece,
      grossWeightKg: grossPerPiece,
    },
    receiver: parseShipTo(shipToLines),
    unknownLines: fields._unknown || [],
  };

  return shipment;
}

function matchKeyValue(line) {
  for (const [key, pattern] of Object.entries(KV_PATTERNS)) {
    const m = line.match(pattern);
    if (m) return [key, m[1].trim()];
  }
  return null;
}

function parseShipTo(lines) {
  const receiver = {
    name: null, company: null, addressLines: [], city: null, state: null,
    postalCode: null, countryCode: null, countryName: null,
    phone: null, phoneCountryCode: null, email: null,
  };
  if (!lines.length) return receiver;

  const rest = [...lines];
  receiver.name = rest.shift();

  // เก็บอีเมลกับเบอร์โทรออกจากกองก่อน (อยู่ท้ายบล็อกเสมอ)
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const line = rest[i];
    if (!receiver.email && EMAIL_LINE.test(line)) {
      receiver.email = line;
      rest.splice(i, 1);
      continue;
    }
    if (!receiver.phone && PHONE_LINE.test(line)) {
      receiver.phone = line;
      rest.splice(i, 1);
    }
  }

  // บรรทัดที่เป็นชื่อประเทศ
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const country = COUNTRY_BY_NAME[rest[i].toLowerCase()];
    if (country) {
      receiver.countryCode = country.code;
      receiver.countryName = country.name;
      receiver.dialCode = country.dial;
      rest.splice(i, 1);
      break;
    }
  }

  // บรรทัด "เมือง, รัฐ รหัสไปรษณีย์" หรือ "เมือง รหัสไปรษณีย์" (ไล่จากล่างขึ้นบน)
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const csz = rest[i].match(CITY_STATE_ZIP);
    if (csz) {
      receiver.city = csz[1].trim();
      receiver.state = csz[2].trim();
      receiver.postalCode = csz[3].trim();
      rest.splice(i, 1);
      break;
    }
    const cz = rest[i].match(CITY_ZIP);
    if (cz) {
      receiver.city = cz[1].trim();
      receiver.postalCode = cz[2].trim();
      rest.splice(i, 1);
      break;
    }
  }

  // ที่เหลือคือที่อยู่ — ตัดบรรทัดที่ซ้ำกับชื่อเมืองออก (เช่นชื่อเขต Earlwood ที่พิมพ์ซ้ำ)
  receiver.addressLines = rest
    .filter((line) => !receiver.city || line.toLowerCase() !== receiver.city.toLowerCase())
    .slice(0, 3);

  if (receiver.phone) {
    const digits = receiver.phone.replace(/[^\d+]/g, '');
    const dial = receiver.dialCode;
    if (dial && digits.startsWith(`+${dial}`)) {
      receiver.phoneCountryCode = dial;
      receiver.phoneNumber = digits.slice(dial.length + 1);
    } else if (dial && digits.startsWith(dial)) {
      receiver.phoneCountryCode = dial;
      receiver.phoneNumber = digits.slice(dial.length);
    } else {
      receiver.phoneNumber = digits.replace(/^\+/, '');
      receiver.phoneCountryCode = dial || null;
    }
  }

  return receiver;
}

/** "35x25x7 cm / 1 kg" -> {length,width,height,netWeightKg} */
function parseBox(raw) {
  const out = { length: null, width: null, height: null, netWeightKg: null };
  if (!raw) return out;
  const text = String(raw).toLowerCase().replace(/,/g, '');
  const dims = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/);
  if (dims) {
    const inch = /(in|inch|นิ้ว)/.test(text);
    const factor = inch ? 2.54 : 1;
    out.length = round(Number(dims[1]) * factor, 1);
    out.width = round(Number(dims[2]) * factor, 1);
    out.height = round(Number(dims[3]) * factor, 1);
  }
  const weightPart = text.includes('/') ? text.split('/').pop() : text;
  out.netWeightKg = parseWeightKg(weightPart);
  return out;
}

function parseWeightKg(raw) {
  if (!raw) return null;
  const text = String(raw).toLowerCase().replace(/,/g, '');
  const m = text.match(/(\d+(?:\.\d+)?)\s*(kgs?|กก\.?|g|gram|กรัม|lbs?)?/);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = m[2] || 'kg';
  if (/^(g|gram|กรัม)$/.test(unit)) return round(value / 1000, 3);
  if (/^lbs?$/.test(unit)) return round(value * 0.45359237, 3);
  return round(value, 3);
}

/** "[DHL] / [Commercial]" -> index 0 = DHL, index 1 = Commercial */
function bracketValue(raw, index = 0) {
  if (!raw) return null;
  const brackets = String(raw).match(/\[([^\]]*)\]/g);
  if (brackets && brackets.length > index) return brackets[index].slice(1, -1).trim() || null;
  if (index === 0) return String(raw).split('/')[0].trim() || null;
  const parts = String(raw).split('/');
  return parts[index] ? parts[index].trim() : null;
}

/** "[50 USD]" -> {amount: 50, currency: 'USD'} */
function parseAmount(raw) {
  if (!raw) return null;
  const inner = bracketValue(raw) || String(raw);
  const m = inner.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const currency = inner.match(/[A-Za-z]{3}/);
  return { amount: round(Number(m[1]), 2), currency: currency ? currency[0].toUpperCase() : 'USD' };
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

module.exports = { parseLineShipment, parseBox, parseWeightKg, bracketValue, parseAmount, COUNTRY_BY_NAME };
