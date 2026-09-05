/**
 * กรอกฟอร์ม MyDHL+ ให้ครบทั้ง 7 ขั้น ตาม flow ที่ทำมืออยู่ทุกวัน
 *
 *   1. #/address-details      ผู้ส่ง (ค่าเดิมในบัญชี) + ผู้รับจาก LINE
 *   2. #/shipment-type        บรรจุภัณฑ์ + Commercial + รายการศุลกากร + ค่าขนส่ง + ประกัน
 *   3. #/customs-declaration  สร้าง invoice + เลขรันของวัน (2569-09-04-01)
 *   4. #/package-details      เลือกบรรจุภัณฑ์ที่บันทึกไว้ + น้ำหนัก + ขนาดกล่อง
 *   5. #/shipment-products    วันส่ง + บริการ (EXPRESS WORLDWIDE)
 *   6. #/optional-services    GoGreen Plus + Direct Signature
 *   7. #/pickup -> #/print -> #/complete   นัดรับ + พิมพ์ + เก็บเลข Tracking
 *
 * UI ของ DHL เปลี่ยนได้ตลอด — selector ทั้งหมดรวมไว้ที่ SEL ด้านล่างที่เดียว
 * ทุกขั้นจะเซฟภาพหน้าจอไว้ที่ data/steps/<jobId>/<ลำดับ>-<ขั้น>.png ให้ตรวจย้อนหลังได้
 */
const fs = require('fs');
const path = require('path');

const SEL = {
  cookieAccept: '#onetrust-accept-btn-handler, button:has-text("Accept All"), button:has-text("ยอมรับทั้งหมด")',
  loginUser: 'input#loginUsername, input[name="username"], input[type="email"]',
  loginPass: 'input#loginPassword, input[name="password"], input[type="password"]',
  loginSubmit: 'button#loginSubmitButton, button[type="submit"]:has-text("Log in"), button:has-text("เข้าสู่ระบบ")',
  loggedInMarker: 'a:has-text("การส่งชิปเมนต์"), a:has-text("Ship")',

  // ---- 1. ที่อยู่ผู้รับ (ฝั่ง "ส่งถึง") ----
  toName: '[id*="receiver"][id*="Name"], input[name*="receiverContactName"]',
  toCompany: 'input[id*="receiverCompany"], input[name*="receiverCompanyName"]',
  toCountry: 'input[id*="receiverCountry"], select[id*="receiverCountry"], input[name*="receiverCountry"]',
  toAddress1: 'input[id*="receiverAddress1"], input[name*="receiverAddress1"]',
  toAddress2: 'input[id*="receiverAddress2"], input[name*="receiverAddress2"]',
  toAddress3: 'input[id*="receiverAddress3"], input[name*="receiverAddress3"]',
  toPostal: 'input[id*="receiverPostalCode"], input[id*="receiverPostcode"], input[name*="receiverPostalCode"]',
  toCity: 'input[id*="receiverCity"], input[name*="receiverCity"]',
  toState: 'input[id*="receiverState"], select[id*="receiverState"], input[name*="receiverState"]',
  toEmail: 'input[id*="receiverEmail"], input[name*="receiverEmail"]',
  toPhoneCountryCode: 'input[id*="receiverPhoneCountry"], input[name*="receiverPhoneCountryCode"]',
  toPhone: 'input[id*="receiverPhone"]:not([id*="Country"]), input[name*="receiverPhone"]:not([name*="Country"])',
  saveAddress: 'input[type="checkbox"][id*="saveAddress"], label:has-text("บันทึกที่อยู่") input[type="checkbox"]',

  // ---- 2. ประเภทชิปเมนต์ + สินค้า ----
  typePackage: 'button:has-text("บรรจุภัณฑ์"), [data-testid="shipment-type-package"], div[role="button"]:has-text("บรรจุภัณฑ์")',
  purposeSelect: 'select[id*="purpose"], select[id*="Purpose"], select[name*="purpose"]',
  itemDetailsManual: 'button:has-text("กรุณาบอกรายละเอียดสินค้า"), button:has-text("Tell us the item details")',
  itemDescription: 'input[id*="itemDescription"], input[name*="itemDescription"], textarea[id*="itemDescription"]',
  itemHsCode: 'input[id*="commodityCode"], input[id*="hsCode"], input[name*="commodityCode"]',
  itemQuantity: 'input[id*="itemQuantity"], input[name*="itemQuantity"]',
  itemUnit: 'select[id*="itemUnit"], select[name*="itemUnit"], select[id*="quantityUnit"]',
  itemUnitValue: 'input[id*="itemValue"], input[name*="itemValue"], input[id*="unitPrice"]',
  itemWeight: 'input[id*="itemWeight"], input[name*="itemWeight"]',
  itemManufacturerCountry: 'input[id*="manufactureCountry"], input[id*="itemCountry"], input[name*="manufactureCountry"]',
  addItemLine: 'a:has-text("เพิ่มรายการ"), button:has-text("เพิ่มรายการ"), a:has-text("Add another item")',

  extraChargeType: 'select[id*="chargeType"], select[id*="additionalCharge"], select[name*="chargeType"]',
  extraChargeAmount: 'input[id*="chargeValue"], input[id*="additionalChargeValue"], input[name*="chargeValue"]',
  insuranceCheckbox: 'input[type="checkbox"][id*="insurance"], label:has-text("เพิ่มการป้องกัน") input[type="checkbox"]',
  insuranceValue: 'input[id*="insuranceValue"], input[id*="insuredValue"], input[name*="insuranceValue"]',

  // ---- 3. customs invoice ----
  createInvoice: 'button:has-text("สร้าง Invoice"), button:has-text("Create invoice")',
  invoiceNumber: 'input[id*="invoiceNumber"], input[name*="invoiceNumber"]',
  tradeAgreementNo: 'input[type="radio"][id*="tradeAgreement"][value="false"], label:has-text("ไม่") input[type="radio"]',

  // ---- 4. บรรจุภัณฑ์ ----
  packagingSelect: 'select[id*="packaging"], select[name*="packaging"], input[id*="packaging"]',
  packageQuantity: 'input[id*="packageQuantity"], input[name*="packageQuantity"]',
  packageWeight: 'input[id*="packageWeight"], input[name*="packageWeight"]',
  packageLength: 'input[id*="packageLength"], input[name*="packageLength"]',
  packageWidth: 'input[id*="packageWidth"], input[name*="packageWidth"]',
  packageHeight: 'input[id*="packageHeight"], input[name*="packageHeight"]',

  // ---- 5. บริการ ----
  productCard: '[data-testid*="product"], .product-card, [class*="productOption"]',
  productSelectButton: 'button:has-text("เลือก"), button:has-text("Select")',

  // ---- 6. บริการเสริม ----
  goGreenPlus: 'input[type="checkbox"][id*="goGreen"], label:has-text("GoGreen Plus") input[type="checkbox"]',
  directSignature: 'input[type="checkbox"][id*="directSignature"], label:has-text("Direct Signature") input[type="checkbox"]',

  // ---- 7. นัดรับ + พิมพ์ ----
  pickupYes: 'button:has-text("ใช่ แจ้งรับงาน"), button:has-text("Yes, schedule"), div[role="button"]:has-text("ใช่ แจ้งรับงาน")',
  pickupNo: 'button:has-text("ไม่"), button:has-text("No")',
  pickupLocation: 'select[id*="pickupLocation"], select[name*="pickupLocation"], input[id*="pickupLocation"]',
  pickupWeight: 'input[id*="pickupWeight"], input[name*="pickupWeight"]',
  acceptAndPrint: 'button:has-text("ยอมรับและดำเนินการต่อ"), button:has-text("Accept and Continue"), button:has-text("ยืนยันและพิมพ์")',
  downloadDocuments: 'a:has-text("ดาวน์โหลดเอกสาร"), button:has-text("ดาวน์โหลดเอกสาร"), button:has-text("Download documents")',
  reprintDocuments: 'button:has-text("พิมพ์เอกสารอีกครั้ง"), a:has-text("พิมพ์เอกสารอีกครั้ง")',

  next: 'button:has-text("ถัดไป"), button:has-text("Next")',
};

/** โหมดซ้อม: กรอกครบแล้วหยุดก่อนกดยืนยัน — ตั้งใจให้ throw เพื่อไม่ให้ pipeline เดินต่อ */
class DryRunStop extends Error {
  constructor(stepDir) {
    super(`โหมดซ้อม (DHL_DRY_RUN=true): กรอกฟอร์มครบแล้วแต่ยังไม่กดยืนยัน — ตรวจภาพหน้าจอที่ ${stepDir}`);
    this.name = 'DryRunStop';
    this.dryRun = true;
    this.stepDir = stepDir;
  }
}

const TRACKING_RE = /\b\d{10}\b/;
const PICKUP_CONFIRM_RE = /\b[A-Z]{3}\d{12}\b/;

class MyDhlFlow {
  constructor(config) {
    this.cfg = config.dhl.web;
    this.dataDir = config.dataDir;
    this.sessionFile = path.join(config.dataDir, 'dhl-web-session.json');
  }

  get available() {
    try { require.resolve('playwright'); } catch { return false; }
    return Boolean(this.cfg.username && this.cfg.password);
  }

  /**
   * @param {object} plan ผลจาก buildShipmentPlan().plan
   * @param {{jobId?: string}} [meta]
   * @returns {Promise<{trackingNumber: string|null, pickupConfirmation: string|null, label: {buffer: Buffer, ext: string}, steps: string[]}>}
   */
  async createShipment(plan, meta = {}) {
    if (!this.available) {
      throw new Error('โหมด web ต้องติดตั้ง playwright และตั้ง DHL_WEB_USERNAME / DHL_WEB_PASSWORD');
    }
    const { chromium } = require('playwright');
    const jobId = meta.jobId || `job-${Date.now()}`;
    const stepDir = path.join(this.dataDir, 'steps', jobId);
    fs.mkdirSync(stepDir, { recursive: true });

    const browser = await chromium.launch({ headless: this.cfg.headless });
    const context = await browser.newContext({
      acceptDownloads: true,
      locale: 'th-TH',
      viewport: { width: 1600, height: 1000 },
      storageState: fs.existsSync(this.sessionFile) ? this.sessionFile : undefined,
    });
    const page = await context.newPage();
    const steps = [];
    let stepNo = 0;
    const shot = async (name) => {
      stepNo += 1;
      const file = path.join(stepDir, `${String(stepNo).padStart(2, '0')}-${name}.png`);
      await page.screenshot({ path: file, fullPage: true }).catch(() => {});
      steps.push(file);
    };

    try {
      await page.goto(this.cfg.url, { waitUntil: 'domcontentloaded' });
      await click(page, SEL.cookieAccept, { optional: true, timeout: 5000 });
      await this.login(page);
      await context.storageState({ path: this.sessionFile });
      await shot('login');

      await page.goto(`${shipUrl(this.cfg.url)}#/address-details`, { waitUntil: 'domcontentloaded' });
      await this.fillReceiver(page, plan.receiver);
      await shot('address-details');
      await click(page, SEL.next);

      await this.fillShipmentType(page, plan);
      await shot('shipment-type');
      await click(page, SEL.next);

      await this.fillCustomsInvoice(page, plan);
      await shot('customs-declaration');
      await click(page, SEL.next);

      await this.fillPackage(page, plan.package);
      await shot('package-details');
      await click(page, SEL.next);

      await this.pickService(page, plan.service);
      await shot('shipment-products');

      await this.pickOptionalServices(page, plan.optionalServices);
      await shot('optional-services');
      await click(page, SEL.next, { optional: true });

      await this.fillPickup(page, plan.pickup);
      await shot('pickup');
      await click(page, SEL.next, { optional: true });

      if (this.cfg.dryRun) {
        await shot('dry-run-before-confirm');
        throw new DryRunStop(stepDir);
      }

      const label = await this.acceptAndCollectLabel(page, stepDir, jobId);
      await shot('complete');

      const body = await page.locator('body').innerText().catch(() => '');
      return {
        trackingNumber: body.match(TRACKING_RE)?.[0] || null,
        pickupConfirmation: body.match(PICKUP_CONFIRM_RE)?.[0] || null,
        label,
        steps,
      };
    } catch (err) {
      if (!(err instanceof DryRunStop)) await shot('error');
      err.message = `${err.message} (ภาพหน้าจอทุกขั้น: ${stepDir})`;
      throw err;
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  async login(page) {
    const user = page.locator(SEL.loginUser).first();
    if (!(await user.isVisible({ timeout: 5000 }).catch(() => false))) return; // มี session อยู่แล้ว
    await user.fill(this.cfg.username);
    await page.locator(SEL.loginPass).first().fill(this.cfg.password);
    await click(page, SEL.loginSubmit);
    // ถ้ามี OTP และเปิดหน้าจออยู่ ให้ผู้ใช้กรอกเอง (รอได้ถึง 3 นาที)
    await page.locator(SEL.loggedInMarker).first()
      .waitFor({ state: 'visible', timeout: this.cfg.headless ? 60_000 : 180_000 })
      .catch(() => {});
  }

  async fillReceiver(page, r) {
    await fill(page, SEL.toCountry, r.countryName || r.countryCode, { autocomplete: true });
    await fill(page, SEL.toName, r.name);
    await fill(page, SEL.toCompany, r.company || '-');
    await fill(page, SEL.toAddress1, r.addressLine1);
    await fill(page, SEL.toAddress2, r.addressLine2, { optional: true });
    await fill(page, SEL.toAddress3, r.addressLine3, { optional: true });
    await fill(page, SEL.toPostal, r.postalCode, { optional: true });
    await fill(page, SEL.toCity, r.city);
    await fill(page, SEL.toState, r.state, { optional: true, autocomplete: true });
    await fill(page, SEL.toEmail, r.email, { optional: true });
    await fill(page, SEL.toPhoneCountryCode, r.phoneCountryCode, { optional: true });
    await fill(page, SEL.toPhone, r.phoneNumber, { optional: true });
    if (r.saveToAddressBook) await setCheckbox(page, SEL.saveAddress, true, { optional: true });
  }

  async fillShipmentType(page, plan) {
    await click(page, SEL.typePackage, { optional: true });
    await fill(page, SEL.purposeSelect, plan.purpose, { optional: true, select: true });
    await click(page, SEL.itemDetailsManual, { optional: true });

    for (const [index, line] of plan.customsLines.entries()) {
      if (index > 0) await click(page, SEL.addItemLine, { optional: true });
      const nth = index;
      await fill(page, SEL.itemDescription, line.description, { nth });
      await fill(page, SEL.itemHsCode, line.hsCode, { nth, optional: true });
      await fill(page, SEL.itemQuantity, String(line.quantity), { nth, optional: true });
      await fill(page, SEL.itemUnit, line.unit, { nth, optional: true, select: true });
      await fill(page, SEL.itemUnitValue, String(line.unitValue), { nth, optional: true });
      await fill(page, SEL.itemWeight, String(line.netWeightKg), { nth, optional: true });
      await fill(page, SEL.itemManufacturerCountry, line.manufacturerCountry, { nth, optional: true, autocomplete: true });
    }

    // ค่าขนส่งที่เก็บลูกค้า ใส่เป็น "ค่าใช้จ่ายเพิ่ม" เพื่อให้มูลค่าชิปเมนต์รวมถูกต้อง
    if (plan.freightCharge?.amount) {
      await fill(page, SEL.extraChargeType, 'freight', { optional: true, select: true, contains: true });
      await fill(page, SEL.extraChargeAmount, String(plan.freightCharge.amount), { optional: true });
    }

    if (plan.insurance?.enabled) {
      await setCheckbox(page, SEL.insuranceCheckbox, true, { optional: true });
      await fill(page, SEL.insuranceValue, String(plan.insurance.value), { optional: true });
    }
  }

  async fillCustomsInvoice(page, plan) {
    await click(page, SEL.createInvoice, { optional: true });
    await fill(page, SEL.invoiceNumber, plan.invoiceNumber, { optional: true });
    if (plan.tradeAgreement === false) await click(page, SEL.tradeAgreementNo, { optional: true });
  }

  async fillPackage(page, pkg) {
    await fill(page, SEL.packagingSelect, pkg.packaging, { select: true, autocomplete: true });
    await fill(page, SEL.packageQuantity, String(pkg.quantity), { optional: true });
    await fill(page, SEL.packageWeight, String(pkg.weightKg), { optional: true });
    await fill(page, SEL.packageLength, String(pkg.length), { optional: true });
    await fill(page, SEL.packageWidth, String(pkg.width), { optional: true });
    await fill(page, SEL.packageHeight, String(pkg.height), { optional: true });
  }

  /** เลือกบริการที่ต้องการ (ดีฟอลต์ EXPRESS WORLDWIDE) วันส่ง = วันแรกที่เลือกไว้ให้แล้ว */
  async pickService(page, service) {
    const preferred = service?.preferred || 'EXPRESS WORLDWIDE';
    const card = page.locator(SEL.productCard).filter({ hasText: preferred }).first();
    if (await card.isVisible({ timeout: 20_000 }).catch(() => false)) {
      await card.locator(SEL.productSelectButton).first().click();
      return;
    }
    // ไม่เจอชื่อบริการที่ต้องการ -> เลือกใบที่ถูกที่สุด (รายการล่างสุดของตาราง)
    const buttons = page.locator(SEL.productSelectButton);
    const count = await buttons.count();
    if (!count) throw new Error('ไม่พบตัวเลือกบริการขนส่งในขั้น shipment-products');
    await buttons.nth(count - 1).click();
  }

  async pickOptionalServices(page, services = {}) {
    await setCheckbox(page, SEL.goGreenPlus, Boolean(services.goGreenPlus), { optional: true });
    await setCheckbox(page, SEL.directSignature, Boolean(services.directSignature), { optional: true });
  }

  async fillPickup(page, pickup = {}) {
    if (pickup.requested) {
      await click(page, SEL.pickupYes, { optional: true });
      await fill(page, SEL.pickupLocation, pickup.location || 'Loading Dock', { optional: true, select: true });
      await fill(page, SEL.pickupWeight, String(pickup.weightKg), { optional: true });
    } else {
      await click(page, SEL.pickupNo, { optional: true });
    }
  }

  /**
   * กดยืนยันจนถึงหน้า complete แล้วเอาไฟล์เอกสาร (label + invoice) ออกมาเป็น PDF
   * ใช้ปุ่มดาวน์โหลดของ DHL ก่อน ถ้าไม่มีค่อย print หน้าเป็น PDF เอง
   */
  async acceptAndCollectLabel(page, stepDir, jobId) {
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 }).catch(() => null);
    await click(page, SEL.acceptAndPrint);
    await page.waitForURL(/#\/(print|complete)/, { timeout: 120_000 }).catch(() => {});

    let download = await downloadPromise;
    if (!download) {
      const trigger = page.locator(SEL.downloadDocuments).first();
      if (await trigger.isVisible({ timeout: 20_000 }).catch(() => false)) {
        const [dl] = await Promise.all([
          page.waitForEvent('download', { timeout: 120_000 }),
          trigger.click(),
        ]);
        download = dl;
      }
    }

    if (download) {
      const file = path.join(stepDir, `${jobId}-label.pdf`);
      await download.saveAs(file);
      return { buffer: fs.readFileSync(file), ext: 'pdf' };
    }

    // สำรอง: พิมพ์หน้าเอกสารเป็น PDF (ใช้ได้เฉพาะโหมด headless ของ chromium)
    const file = path.join(stepDir, `${jobId}-label-print.pdf`);
    await page.pdf({ path: file, format: 'A4', printBackground: true });
    return { buffer: fs.readFileSync(file), ext: 'pdf' };
  }
}

function shipUrl(homeUrl) {
  try {
    const url = new URL(homeUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const locale = parts.slice(0, 2).join('/') || 'th/th';
    return `${url.origin}/${locale}/shipment.html`;
  } catch {
    return 'https://mydhl.express.dhl/th/th/shipment.html';
  }
}

async function click(page, selector, { optional = false, timeout = 30_000 } = {}) {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: 'visible', timeout });
    await el.click();
  } catch (err) {
    if (!optional) throw new Error(`กดปุ่มไม่ได้: ${selector}`);
  }
}

async function setCheckbox(page, selector, checked, { optional = false, timeout = 15_000 } = {}) {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: 'attached', timeout });
    if ((await el.isChecked()) !== checked) await el.setChecked(checked, { force: true });
  } catch (err) {
    if (!optional) throw new Error(`ติ๊ก checkbox ไม่ได้: ${selector}`);
  }
}

async function fill(page, selector, value, opts = {}) {
  const { optional = false, select = false, autocomplete = false, contains = false, nth = 0, timeout = 30_000 } = opts;
  if (value === undefined || value === null || value === '' || value === 'null') {
    if (optional) return;
    throw new Error(`ไม่มีค่าที่จะกรอกลง ${selector}`);
  }
  const el = page.locator(selector).nth(nth);
  try {
    await el.waitFor({ state: 'visible', timeout });
    const tag = await el.evaluate((node) => node.tagName.toLowerCase());
    if (tag === 'select' || select) {
      if (tag === 'select') {
        await selectOptionSmart(el, String(value), contains);
        return;
      }
    }
    await el.fill(String(value));
    if (autocomplete) {
      // ช่องแบบ autocomplete ของ DHL ต้องเลือกจากรายการที่เด้งขึ้นมา ไม่ใช่แค่พิมพ์
      await page.keyboard.press('ArrowDown').catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
    }
  } catch (err) {
    if (!optional) throw new Error(`กรอกช่อง ${selector} ไม่ได้: ${err.message}`);
  }
}

async function selectOptionSmart(select, value, contains) {
  const options = await select.locator('option').all();
  const wanted = value.toLowerCase();
  for (const option of options) {
    const label = ((await option.textContent()) || '').trim();
    const lower = label.toLowerCase();
    if (lower === wanted || (contains && lower.includes(wanted))) {
      await select.selectOption({ label });
      return;
    }
  }
  await select.selectOption(value);
}

module.exports = { MyDhlFlow, SEL, shipUrl, DryRunStop };
