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
   * @param {object} plan ผลจาก buildShipmentPlan().plan
   * @returns {Promise<{trackingNumber: string, label: {buffer: Buffer, ext: string}, raw: object}>}
   */
  async createShipment(plan) {
    if (!this.available) {
      throw new Error('ยังไม่ได้ตั้งค่า DHL_API_USERNAME / DHL_API_PASSWORD / DHL_ACCOUNT_NUMBER');
    }
    const payload = this.buildPayload(plan);
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

  /**
   * @param {object} plan ผลจาก buildShipmentPlan().plan
   */
  buildPayload(plan) {
    const cfg = this.cfg;
    const pkg = plan.package;
    const isCustomsDeclarable = plan.receiver.countryCode !== this.shipper.countryCode;

    const payload = {
      plannedShippingDateAndTime: nextShippingDateTime(cfg.timezoneOffset),
      pickup: { isRequested: Boolean(plan.pickup?.requested ?? cfg.pickupRequested) },
      productCode: cfg.productCode,
      accounts: [{ typeCode: 'shipper', number: cfg.accountNumber }],
      outputImageProperties: {
        printerDPI: 300,
        encodingFormat: cfg.labelFormat.toLowerCase() === 'zpl' ? 'zpl' : 'pdf',
        imageOptions: [{ typeCode: 'label', templateName: cfg.labelTemplate }],
      },
      customerDetails: {
        shipperDetails: this.shipperDetails(),
        receiverDetails: receiverDetails(plan.receiver),
      },
      content: {
        packages: [trimNulls({
          weight: pkg.weightKg,
          dimensions: { length: pkg.length, width: pkg.width, height: pkg.height },
          customerReferences: plan.invoiceNumber
            ? [{ value: String(plan.invoiceNumber).slice(0, 35), typeCode: 'CU' }]
            : undefined,
        })],
        isCustomsDeclarable,
        description: (plan.customsLines[0]?.description || 'Car seat spare parts').slice(0, 70),
        incoterm: plan.incoterm || cfg.incoterm,
        unitOfMeasurement: cfg.unitOfMeasurement,
      },
    };

    if (isCustomsDeclarable) {
      payload.content.declaredValue = plan.goodsValue;
      payload.content.declaredValueCurrency = plan.currency || 'USD';
      payload.content.exportDeclaration = {
        lineItems: plan.customsLines.map((line) => ({
          number: line.index,
          description: line.description.slice(0, 75),
          price: line.unitValue,
          quantity: { value: line.quantity, unitOfMeasurement: line.unit === 'Boxes' ? 'BOX' : 'PCS' },
          commodityCodes: line.hsCode ? [{ typeCode: 'outbound', value: line.hsCode.replace(/\./g, '') }] : [],
          exportReasonType: 'permanent',
          manufacturerCountry: this.shipper.countryCode,
          weight: {
            netValue: line.netWeightKg,
            grossValue: pkg.weightKg,
          },
        })),
        invoice: {
          number: String(plan.invoiceNumber || `INV-${Date.now()}`).slice(0, 35),
          date: new Date().toISOString().slice(0, 10),
        },
        exportReason: 'permanent',
        placeOfIncoterm: this.shipper.city,
        // ค่าขนส่งที่เก็บลูกค้า ต้องโชว์ในใบขนเพื่อให้มูลค่ารวมตรงกับที่ทำมือ
        additionalCharges: plan.freightCharge?.amount
          ? [{ value: plan.freightCharge.amount, caption: 'freight', typeCode: 'freight' }]
          : undefined,
      };
      if (!payload.content.exportDeclaration.additionalCharges) {
        delete payload.content.exportDeclaration.additionalCharges;
      }
    }

    if (plan.insurance?.enabled && plan.insurance.value) {
      payload.valueAddedServices = [{ serviceCode: 'II', value: plan.insurance.value, currency: plan.currency || 'USD' }];
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

function receiverDetails(r) {
  return {
    postalAddress: trimNulls({
      postalCode: r.postalCode || undefined,
      cityName: r.city,
      countryCode: r.countryCode,
      provinceCode: r.state || undefined,
      addressLine1: r.addressLine1,
      addressLine2: r.addressLine2 || undefined,
      addressLine3: r.addressLine3 || undefined,
    }),
    contactInformation: trimNulls({
      phone: r.phoneCountryCode ? `+${r.phoneCountryCode}${r.phoneNumber}` : r.phoneNumber,
      companyName: r.company && r.company !== '-' ? r.company : r.name,
      fullName: r.name,
      email: r.email || undefined,
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

module.exports = { DhlApiClient, nextShippingDateTime };
