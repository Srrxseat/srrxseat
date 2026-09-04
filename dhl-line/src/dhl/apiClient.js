/**
 * สร้าง Shipment ผ่าน MyDHL API (โหมด DHL_MODE=api)
 * เอกสาร: https://developer.dhl.com/api-reference/dhl-express-mydhl-api
 * ต้องขอ username/password ของ MyDHL API และเลขบัญชี DHL ก่อนใช้
 */
const crypto = require('crypto');

class DhlApiClient {
  constructor(config) {
    this.cfg = config.dhl.api;
    this.shipper = config.shipper;
  }

  get available() {
    return Boolean(this.cfg.username && this.cfg.password && this.cfg.accountNumber);
  }

  /**
   * @param {object} shipment ข้อมูลที่ผ่าน validateShipment แล้ว
   * @returns {Promise<{trackingNumber: string, label: {buffer: Buffer, ext: string}, raw: object}>}
   */
  async createShipment(shipment) {
    if (!this.available) {
      throw new Error('ยังไม่ได้ตั้งค่า DHL_API_USERNAME / DHL_API_PASSWORD / DHL_ACCOUNT_NUMBER');
    }
    const payload = this.buildPayload(shipment);
    const auth = Buffer.from(`${this.cfg.username}:${this.cfg.password}`).toString('base64');

    const res = await fetch(`${this.cfg.base}/shipments`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Message-Reference': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    if (!res.ok) {
      throw new Error(`DHL API ${res.status}: ${describeError(body) || text.slice(0, 500)}`);
    }

    const trackingNumber = body.shipmentTrackingNumber;
    const doc = (body.documents || []).find((d) => d.typeCode === 'label') || (body.documents || [])[0];
    if (!trackingNumber || !doc?.content) {
      throw new Error(`DHL API ตอบกลับไม่ครบ (ไม่มีเลขติดตามหรือไฟล์ label): ${text.slice(0, 500)}`);
    }

    return {
      trackingNumber,
      label: {
        buffer: Buffer.from(doc.content, 'base64'),
        ext: (doc.imageFormat || 'PDF').toLowerCase(),
      },
      raw: body,
    };
  }

  buildPayload(s) {
    const cfg = this.cfg;
    const packages = [{
      weight: s.weightKg,
      dimensions: {
        length: s.dimensions.length,
        width: s.dimensions.width,
        height: s.dimensions.height,
      },
      ...(s.reference ? { customerReferences: [{ value: String(s.reference).slice(0, 35), typeCode: 'CU' }] } : {}),
    }];

    const payload = {
      plannedShippingDateAndTime: nextShippingDateTime(cfg.timezoneOffset),
      pickup: { isRequested: cfg.pickupRequested },
      productCode: s.productCode || cfg.productCode,
      accounts: [{ typeCode: 'shipper', number: cfg.accountNumber }],
      outputImageProperties: {
        printerDPI: 300,
        encodingFormat: cfg.labelFormat.toLowerCase() === 'zpl' ? 'zpl' : 'pdf',
        imageOptions: [{ typeCode: 'label', templateName: cfg.labelTemplate }],
      },
      customerDetails: {
        shipperDetails: this.shipperDetails(),
        receiverDetails: receiverDetails(s),
      },
      content: {
        packages,
        isCustomsDeclarable: Boolean(s.isCustomsDeclarable),
        description: (s.description || 'General goods').slice(0, 70),
        incoterm: cfg.incoterm,
        unitOfMeasurement: cfg.unitOfMeasurement,
      },
    };

    if (s.isCustomsDeclarable) {
      payload.content.declaredValue = s.declaredValue;
      payload.content.declaredValueCurrency = s.currency || 'THB';
      payload.content.exportDeclaration = {
        lineItems: [{
          number: 1,
          description: (s.description || 'General goods').slice(0, 75),
          price: round(s.declaredValue / Math.max(1, s.quantity), 2),
          quantity: { value: s.quantity, unitOfMeasurement: 'PCS' },
          commodityCodes: [],
          exportReasonType: 'permanent',
          manufacturerCountry: this.shipper.countryCode,
          weight: {
            netValue: round(s.weightKg * 0.95, 3),
            grossValue: s.weightKg,
          },
        }],
        invoice: {
          number: String(s.reference || `INV-${Date.now()}`).slice(0, 35),
          date: new Date().toISOString().slice(0, 10),
        },
        exportReason: 'permanent',
        placeOfIncoterm: this.shipper.city,
      };
    }

    return payload;
  }

  shipperDetails() {
    const sp = this.shipper;
    return {
      postalAddress: trimNulls({
        postalCode: sp.postalCode,
        cityName: sp.city,
        countryCode: sp.countryCode,
        provinceCode: sp.state || undefined,
        addressLine1: sp.addressLine1,
        addressLine2: sp.addressLine2 || undefined,
      }),
      contactInformation: trimNulls({
        phone: sp.phone,
        companyName: sp.company || sp.name,
        fullName: sp.name,
        email: sp.email || undefined,
      }),
    };
  }
}

function receiverDetails(s) {
  return {
    postalAddress: trimNulls({
      postalCode: s.postalCode || undefined,
      cityName: s.city,
      countryCode: s.countryCode,
      provinceCode: s.state || undefined,
      addressLine1: s.addressLine1,
      addressLine2: s.addressLine2 || undefined,
      addressLine3: s.addressLine3 || undefined,
    }),
    contactInformation: trimNulls({
      phone: s.phone,
      companyName: s.receiverCompany || s.receiverName,
      fullName: s.receiverName,
      email: s.email || undefined,
    }),
  };
}

/** วันส่งถัดไป: ถ้าเลย 15:00 แล้วให้เป็นวันรุ่งขึ้น และข้ามวันอาทิตย์ */
function nextShippingDateTime(offset = '+07:00') {
  const offsetMinutes = parseOffset(offset);
  const local = new Date(Date.now() + offsetMinutes * 60_000);
  if (local.getUTCHours() >= 15) local.setUTCDate(local.getUTCDate() + 1);
  if (local.getUTCDay() === 0) local.setUTCDate(local.getUTCDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  return `${date}T10:00:00 GMT${offset}`;
}

function parseOffset(offset) {
  const m = String(offset).match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function describeError(body) {
  if (!body || typeof body !== 'object') return null;
  const parts = [body.title, body.detail, body.message].filter(Boolean);
  for (const item of body.additionalDetails || []) parts.push(String(item));
  return parts.join(' | ') || null;
}

function trimNulls(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

module.exports = { DhlApiClient, nextShippingDateTime };
