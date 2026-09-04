/**
 * สร้าง Shipment โดยกรอกฟอร์มบนเว็บ MyDHL+ ด้วย Playwright (โหมด DHL_MODE=web)
 *
 * ใช้เมื่อบัญชียังไม่ได้เปิดใช้ MyDHL API — ช้ากว่าและเปราะกว่าโหมด api
 * เพราะ UI ของ DHL เปลี่ยนได้ตลอด ถ้ากรอกไม่ผ่านให้แก้ selector ที่ SEL ด้านล่าง
 * (สคริปต์จะเซฟภาพหน้าจอไว้ที่ data/labels/<jobId>-error.png ทุกครั้งที่ล้ม)
 *
 * ครั้งแรกให้รันด้วย DHL_WEB_HEADLESS=false เพื่อ login/ทำ OTP เอง
 * session จะถูกเก็บไว้ที่ data/dhl-web-session.json แล้วครั้งต่อไปไม่ต้อง login ใหม่
 */
const fs = require('fs');
const path = require('path');

// ---------- SELECTORS (แก้ตรงนี้ถ้า UI MyDHL+ เปลี่ยน) ----------
const SEL = {
  loginUser: 'input#loginUsername, input[name="username"], input[type="email"]',
  loginPass: 'input#loginPassword, input[name="password"], input[type="password"]',
  loginSubmit: 'button#loginSubmitButton, button[type="submit"]:has-text("Log in"), button:has-text("เข้าสู่ระบบ")',
  cookieAccept: 'button:has-text("Accept All"), button:has-text("ยอมรับ"), #onetrust-accept-btn-handler',

  createShipment: 'a:has-text("Create a shipment"), a:has-text("สร้างการจัดส่ง"), button:has-text("Create a shipment")',

  toName: 'input[name*="receiverContactName"], input#receiverContactName, input[aria-label*="Contact name"]',
  toCompany: 'input[name*="receiverCompanyName"], input#receiverCompanyName',
  toCountry: 'input[name*="receiverCountry"], select[name*="receiverCountry"], input#receiverCountry',
  toAddress1: 'input[name*="receiverAddress1"], input#receiverAddress1, textarea[name*="receiverAddress1"]',
  toAddress2: 'input[name*="receiverAddress2"], input#receiverAddress2',
  toCity: 'input[name*="receiverCity"], input#receiverCity',
  toState: 'input[name*="receiverState"], select[name*="receiverState"], input#receiverState',
  toPostal: 'input[name*="receiverPostcode"], input[name*="receiverPostalCode"], input#receiverPostcode',
  toPhone: 'input[name*="receiverPhone"], input#receiverPhone',
  toEmail: 'input[name*="receiverEmail"], input#receiverEmail',

  shipmentTypePackage: 'label:has-text("Package"), input[value="package"], button:has-text("Package")',
  goodsDescription: 'input[name*="description"], textarea[name*="description"], input#shipmentDescription',
  declaredValue: 'input[name*="declaredValue"], input[name*="customsValue"], input#customsValue',
  currency: 'select[name*="currency"], input[name*="currency"]',
  weight: 'input[name*="weight"], input#packageWeight',
  dimLength: 'input[name*="length"], input#packageLength',
  dimWidth: 'input[name*="width"], input#packageWidth',
  dimHeight: 'input[name*="height"], input#packageHeight',
  reference: 'input[name*="reference"], input#shipmentReference',

  next: 'button:has-text("Next"), button:has-text("ต่อไป"), button[aria-label="Next"]',
  serviceFirstOption: '[data-testid="product-option"], .product-option, li:has-text("EXPRESS WORLDWIDE")',
  acceptAndPrint: 'button:has-text("Accept and Continue"), button:has-text("Accept & Print"), button:has-text("Print")',
  trackingNumber: '[data-testid="shipment-number"], :text-matches("\\\\b\\\\d{10}\\\\b")',
};

class DhlWebClient {
  constructor(config) {
    this.cfg = config.dhl.web;
    this.shipper = config.shipper;
    this.dataDir = config.dataDir;
    this.sessionFile = path.join(config.dataDir, 'dhl-web-session.json');
  }

  get available() {
    try {
      require.resolve('playwright');
    } catch {
      return false;
    }
    return Boolean(this.cfg.username && this.cfg.password);
  }

  /**
   * @param {object} s ข้อมูล shipment ที่ผ่าน validateShipment แล้ว
   * @param {{jobId?: string}} [meta]
   */
  async createShipment(s, meta = {}) {
    if (!this.available) {
      throw new Error('โหมด web ต้องติดตั้ง playwright และตั้ง DHL_WEB_USERNAME / DHL_WEB_PASSWORD');
    }
    const { chromium } = require('playwright');
    const jobId = meta.jobId || `job-${Date.now()}`;
    const downloadDir = path.join(this.dataDir, 'labels');
    fs.mkdirSync(downloadDir, { recursive: true });

    const browser = await chromium.launch({ headless: this.cfg.headless });
    const context = await browser.newContext({
      acceptDownloads: true,
      storageState: fs.existsSync(this.sessionFile) ? this.sessionFile : undefined,
    });
    const page = await context.newPage();

    try {
      await page.goto(this.cfg.url, { waitUntil: 'domcontentloaded' });
      await click(page, SEL.cookieAccept, { optional: true });
      await this.login(page);
      await context.storageState({ path: this.sessionFile });

      await click(page, SEL.createShipment);
      await this.fillReceiver(page, s);
      await click(page, SEL.next, { optional: true });
      await this.fillPackage(page, s);
      await click(page, SEL.next, { optional: true });
      await click(page, SEL.serviceFirstOption, { optional: true });
      await click(page, SEL.next, { optional: true });

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 120_000 }),
        click(page, SEL.acceptAndPrint),
      ]);

      const labelPath = path.join(downloadDir, `${jobId}-web.pdf`);
      await download.saveAs(labelPath);
      const trackingNumber = await this.readTrackingNumber(page);

      return {
        trackingNumber,
        label: { buffer: fs.readFileSync(labelPath), ext: 'pdf' },
        raw: { mode: 'web', labelPath },
      };
    } catch (err) {
      const shot = path.join(downloadDir, `${jobId}-error.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      err.message = `${err.message} (ภาพหน้าจอตอนล้ม: ${shot})`;
      throw err;
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  async login(page) {
    const userField = page.locator(SEL.loginUser).first();
    if (!(await userField.isVisible({ timeout: 5000 }).catch(() => false))) return; // มี session อยู่แล้ว
    await userField.fill(this.cfg.username);
    await page.locator(SEL.loginPass).first().fill(this.cfg.password);
    await click(page, SEL.loginSubmit);
    // ถ้ามี OTP และเปิดหน้าจออยู่ ให้ผู้ใช้กรอกเอง (รอได้ถึง 3 นาที)
    await page.waitForLoadState('networkidle', { timeout: this.cfg.headless ? 60_000 : 180_000 }).catch(() => {});
  }

  async fillReceiver(page, s) {
    await fill(page, SEL.toCountry, countryLabel(s.countryCode), { select: true });
    await fill(page, SEL.toName, s.receiverName);
    await fill(page, SEL.toCompany, s.receiverCompany || s.receiverName, { optional: true });
    await fill(page, SEL.toAddress1, s.addressLine1);
    await fill(page, SEL.toAddress2, s.addressLine2, { optional: true });
    await fill(page, SEL.toCity, s.city);
    await fill(page, SEL.toState, s.state, { optional: true, select: true });
    await fill(page, SEL.toPostal, s.postalCode, { optional: true });
    await fill(page, SEL.toPhone, s.phone);
    await fill(page, SEL.toEmail, s.email, { optional: true });
  }

  async fillPackage(page, s) {
    await click(page, SEL.shipmentTypePackage, { optional: true });
    await fill(page, SEL.goodsDescription, s.description || 'General goods', { optional: true });
    if (s.isCustomsDeclarable) {
      await fill(page, SEL.declaredValue, String(s.declaredValue), { optional: true });
      await fill(page, SEL.currency, s.currency || 'THB', { optional: true, select: true });
    }
    await fill(page, SEL.weight, String(s.weightKg), { optional: true });
    await fill(page, SEL.dimLength, String(s.dimensions.length), { optional: true });
    await fill(page, SEL.dimWidth, String(s.dimensions.width), { optional: true });
    await fill(page, SEL.dimHeight, String(s.dimensions.height), { optional: true });
    await fill(page, SEL.reference, s.reference, { optional: true });
  }

  async readTrackingNumber(page) {
    const body = await page.locator('body').innerText().catch(() => '');
    const m = body.match(/\b\d{10}\b/);
    return m ? m[0] : null;
  }
}

async function click(page, selector, { optional = false, timeout = 20_000 } = {}) {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: 'visible', timeout });
    await el.click();
  } catch (err) {
    if (!optional) throw new Error(`กดปุ่มไม่ได้: ${selector}`);
  }
}

async function fill(page, selector, value, { optional = false, select = false, timeout = 20_000 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return;
    throw new Error(`ไม่มีค่าที่จะกรอกลง ${selector}`);
  }
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: 'visible', timeout });
    const tag = await el.evaluate((node) => node.tagName.toLowerCase());
    if (tag === 'select') {
      await el.selectOption({ label: String(value) }).catch(async () => {
        await el.selectOption(String(value));
      });
      return;
    }
    await el.fill(String(value));
    if (select) {
      // ช่องแบบ autocomplete ต้องเลือกจากรายการที่เด้งขึ้นมา
      await page.keyboard.press('ArrowDown').catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
    }
  } catch (err) {
    if (!optional) throw new Error(`กรอกช่อง ${selector} ไม่ได้: ${err.message}`);
  }
}

const COUNTRY_LABELS = {
  TH: 'Thailand', JP: 'Japan', CN: 'China', HK: 'Hong Kong', TW: 'Taiwan', SG: 'Singapore',
  MY: 'Malaysia', VN: 'Vietnam', ID: 'Indonesia', PH: 'Philippines', KH: 'Cambodia', LA: 'Laos',
  MM: 'Myanmar', KR: 'Korea, Republic of', IN: 'India', AU: 'Australia', NZ: 'New Zealand',
  US: 'United States of America', CA: 'Canada', GB: 'United Kingdom', DE: 'Germany', FR: 'France',
  NL: 'Netherlands', IT: 'Italy', ES: 'Spain', CH: 'Switzerland', AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
};

function countryLabel(code) {
  return COUNTRY_LABELS[code] || code;
}

module.exports = { DhlWebClient, SEL, countryLabel };
