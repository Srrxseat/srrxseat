/**
 * แปลงข้อมูลที่ parse จาก LINE -> ค่าที่ต้องกรอกบน MyDHL+ ครบทุกขั้น
 * (ทำเป็น plan ก่อน เพื่อให้ตรวจ/ทดสอบได้โดยไม่ต้องเปิด browser)
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_CATALOG = path.join(__dirname, '..', '..', 'config', 'products.json');

const LABELS = {
  receiverName: 'ชื่อผู้รับ',
  addressLines: 'ที่อยู่',
  city: 'เมือง',
  countryCode: 'ประเทศ',
  phone: 'เบอร์โทร',
  postalCode: 'รหัสไปรษณีย์',
  state: 'รัฐ/จังหวัด',
  items: 'รายการสินค้า (บรรทัด x<จำนวน> ชื่อสินค้า [ราคา USD])',
  goodsValue: 'มูลค่าสินค้า',
  boxDimensions: 'ขนาดกล่อง (Box: กxยxส cm)',
  netWeight: 'น้ำหนักของ (Box: ... / X kg)',
};

const NO_POSTAL_CODE = new Set(['HK', 'MO', 'AE', 'QA', 'KW', 'BH', 'OM', 'IE', 'PA']);
const STATE_REQUIRED = new Set(['US', 'CA', 'AU', 'IN', 'BR', 'MX', 'CN', 'JP', 'IE']);

function loadCatalog(file = DEFAULT_CATALOG) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** หาหมวดสินค้าจากชื่อใน LINE (ใช้ตาราง config/products.json) */
function categorize(itemName, catalog) {
  const name = String(itemName || '').toLowerCase();
  for (const category of catalog.categories) {
    if (category.keywords.some((kw) => name.includes(kw.toLowerCase()))) return category;
  }
  return catalog.fallback;
}

/**
 * @param {object} parsed ผลจาก parseLineShipment()
 * @param {object} opts {catalog, invoiceNumber, shipperCountryCode, customsLineMode, packagingByCategory}
 */
function buildShipmentPlan(parsed, opts = {}) {
  const catalog = opts.catalog || loadCatalog();
  const shipperCountry = (opts.shipperCountryCode || 'TH').toUpperCase();
  const customsLineMode = opts.customsLineMode || 'box'; // box = 1 Boxes ต่อรายการ (ตามที่ทำมือ), piece = แยกต่อชิ้น
  const warnings = [];
  const missing = [];

  const r = parsed.receiver || {};
  if (!r.name) missing.push(LABELS.receiverName);
  if (!r.addressLines || !r.addressLines.length) missing.push(LABELS.addressLines);
  if (!r.city) missing.push(LABELS.city);
  if (!r.countryCode) missing.push(LABELS.countryCode);
  if (!r.phone) missing.push(LABELS.phone);
  if (r.countryCode && !NO_POSTAL_CODE.has(r.countryCode) && !r.postalCode) missing.push(LABELS.postalCode);
  if (r.countryCode && STATE_REQUIRED.has(r.countryCode) && !r.state) missing.push(LABELS.state);
  if (!parsed.items || !parsed.items.length) missing.push(LABELS.items);
  if (!parsed.goodsValue) missing.push(LABELS.goodsValue);
  if (!parsed.box || !parsed.box.length || !parsed.box.width || !parsed.box.height) missing.push(LABELS.boxDimensions);
  if (!parsed.box || !parsed.box.netWeightKg) missing.push(LABELS.netWeight);

  const currency = parsed.currency || 'USD';
  const netWeightKg = parsed.box?.netWeightKg || null;
  const grossWeightKg = parsed.box?.grossWeightKg || netWeightKg;

  const categorized = (parsed.items || []).map((item) => ({ item, category: categorize(item.name, catalog) }));
  const primary = categorized[0]?.category || catalog.fallback;

  // HS code: ถ้า LINE ระบุมาให้ใช้ตามนั้น ไม่ระบุค่อยเลือกตามหมวดสินค้า
  const customsLines = categorized.map(({ item, category }, index) => {
    const hsCode = parsed.hsCode || category.hsCode;
    if (parsed.hsCode && parsed.hsCode !== category.hsCode) {
      warnings.push(`HS Code จาก LINE (${parsed.hsCode}) ไม่ตรงกับหมวด ${category.key} (${category.hsCode}) — ใช้ค่าจาก LINE`);
    }
    // น้ำหนักในบรรทัดศุลกากร = น้ำหนักของ ไม่รวมกล่อง เกลี่ยตามจำนวนรายการ
    const lineNetWeight = netWeightKg ? round(netWeightKg / categorized.length, 3) : null;
    if (customsLineMode === 'piece') {
      return {
        index: index + 1,
        itemName: item.name,
        description: category.customsDescription,
        hsCode,
        quantity: item.quantity,
        unit: 'Pieces',
        unitValue: item.unitValue,
        currency: item.currency || currency,
        netWeightKg: lineNetWeight && item.quantity ? round(lineNetWeight / item.quantity, 3) : null,
        manufacturerCountry: category.manufacturerCountry,
      };
    }
    return {
      index: index + 1,
      itemName: item.name,
      description: category.customsDescription,
      hsCode,
      quantity: 1,
      unit: 'Boxes',
      unitValue: item.totalValue,
      currency: item.currency || currency,
      netWeightKg: lineNetWeight,
      manufacturerCountry: category.manufacturerCountry,
    };
  });

  const freight = parsed.shippingCost || null;
  if (freight && freight.currency !== currency) {
    warnings.push(`สกุลเงินค่าขนส่ง (${freight.currency}) ไม่ตรงกับสกุลเงินสินค้า (${currency})`);
  }
  const totalShipmentValue = round((parsed.goodsValue || 0) + (freight?.amount || 0), 2);

  const incoterm = (parsed.incoterm || 'DAP').toUpperCase();
  // DDP = ผู้ส่งจ่ายภาษี, ที่เหลือ (DAP/DAT/EXW...) ผู้รับปลายทางจ่าย
  const dutiesPaidBy = incoterm === 'DDP' ? 'shipper' : 'receiver';

  if (parsed.courier && parsed.courier.toUpperCase() !== 'DHL') {
    warnings.push(`Courier ใน LINE ไม่ใช่ DHL (${parsed.courier}) — ระบบนี้ทำได้แค่ DHL`);
  }

  return {
    ok: missing.length === 0,
    missing: [...new Set(missing)],
    warnings,
    plan: {
      invoiceNumber: parsed.invoiceNumber || opts.invoiceNumber || null,
      receiver: {
        name: r.name || null,
        company: r.company || '-',
        countryName: r.countryName || null,
        countryCode: r.countryCode || null,
        addressLine1: r.addressLines?.[0] || null,
        addressLine2: r.addressLines?.[1] || null,
        addressLine3: r.addressLines?.[2] || null,
        city: r.city || null,
        state: r.state || null,
        postalCode: r.postalCode || null,
        email: r.email || null,
        phoneCountryCode: r.phoneCountryCode || null,
        phoneNumber: r.phoneNumber || null,
        saveToAddressBook: true,
      },
      shipmentType: 'package',
      purpose: parsed.shipmentPurpose || 'Commercial',
      customsLines,
      goodsValue: parsed.goodsValue || null,
      currency,
      freightCharge: freight,
      totalShipmentValue,
      insurance: { enabled: Boolean(parsed.goodsValue), value: parsed.goodsValue || null },
      incoterm,
      dutiesPaidBy,
      tradeAgreement: false,
      package: {
        packaging: primary.packaging,
        quantity: 1,
        weightKg: grossWeightKg,
        length: parsed.box?.length || null,
        width: parsed.box?.width || null,
        height: parsed.box?.height || null,
      },
      service: { preferred: 'EXPRESS WORLDWIDE', shipDate: 'today' },
      optionalServices: { goGreenPlus: true, directSignature: true },
      pickup: { requested: true, location: 'Loading Dock', weightKg: grossWeightKg },
      source: {
        place: parsed.place || null,
        courier: parsed.courier || null,
        handledBy: parsed.handledBy || null,
        items: parsed.items || [],
        totalPieces: parsed.totalPieces || null,
        netWeightKg,
        category: primary.key,
      },
    },
  };
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

module.exports = { buildShipmentPlan, categorize, loadCatalog, LABELS };
