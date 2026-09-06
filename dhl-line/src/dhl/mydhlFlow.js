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

  // ---- 1a. ที่อยู่ผู้ส่ง (ฝั่ง "ส่งจาก") = ช่อง name เดียวกันตัวแรกใน DOM ----
  fromName: 'input[name="fullName"]',
  fromCompany: 'input[name="companyName"]',
  fromCountry: 'input[name="countryName"]',
  fromAddress1: 'input[name="address"]',
  fromAddress2: 'input[name="address2"]',
  fromCity: 'input[name="city"]',
  fromEmail: 'input[name="fromEmail"]',
  fromPhoneCountryCode: 'input[name="phoneCode"]',
  fromPhone: 'input[name="phoneNumber"]',
  fromVatTax: 'input[name="fromVatTax"]',
  fromPostalXpath: 'xpath=(//input[@name="city"])[1]/preceding::input[1]',

  // ---- 1. ที่อยู่ผู้รับ (ฝั่ง "ส่งถึง") ----
  // ฟอร์มนี้ไม่มี id — ใช้ name และช่องชื่อซ้ำกันสองฝั่ง (ส่งจากมาก่อน ส่งถึงมาหลัง)
  // จึงหยิบตัวท้ายสุดเสมอด้วย receiverInput() ด้านล่าง
  toName: 'input[name="fullName"]',
  toCompany: 'input[name="companyName"]',
  toCountry: 'input[name="countryName"]',
  toAddress1: 'input[name="address"]',
  toAddress2: 'input[name="address2"]',
  toAddress3: 'input[name="address3"]',
  toCity: 'input[name="city"]',
  toEmail: 'input[name="toEmail"]',
  toPhoneCountryCode: 'input[name="phoneCode"]',
  toPhone: 'input[name="phoneNumber"]',
  toVatTax: 'input[name="toVatTax"]',
  // รหัสไปรษณีย์กับ State ไม่มี name — อ้างตำแหน่งจากช่องเมืองของฝั่งผู้รับ
  toPostalXpath: 'xpath=(//input[@name="city"])[last()]/preceding::input[1]',
  toStateXpath: 'xpath=(//input[@name="city"])[last()]/following::input[1]',
  saveAddress: 'input[type="checkbox"][name*="saveAddress"], label:has-text("บันทึกที่อยู่") input[type="checkbox"]',

  // ---- 2. ประเภทชิปเมนต์ + สินค้า ----
  // หน้านี้เป็น radio จริง ๆ (ไม่ใช่ปุ่ม) ค่า DOCUMENT | PACKAGE
  // เกาะ attribute ไม่ได้เลยสักตัว: DHL ตั้ง value ผ่าน JS (เป็น property) และตัว PACKAGE
  // ยังมี name="" ว่างอีกด้วย จึงกวาด radio ทั้งหน้าแล้วเทียบ el.value / ข้อความ label แทน
  shipmentTypeRadios: 'input[type="radio"]',
  // ชื่อจริงคือ shippingPurpose — โผล่มาหลังติ๊ก "บรรจุภัณฑ์" เท่านั้น (ตัวเลือกมี Commercial อยู่)
  purposeSelect: 'select[name="shippingPurpose"], select[id*="purpose"], select[name*="urpose"]',
  // ---- ชื่อช่องจริงของแถวสินค้า (แถวที่ n ใช้ nth เดียวกันทุกช่อง; id ของช่องแรกคือ itemDescription0) ----
  // ปุ่ม "สร้างรายละเอียดสินค้า" เปิด modal ช่วยแต่งคำบรรยาย — เรามีคำบรรยายจาก config อยู่แล้ว
  // ห้ามกด เพราะ modal จะบังปุ่ม/ช่องอื่นทั้งหน้า (เคยทำให้ติ๊กประกันไม่ได้)
  itemDetailsModal: 'button:has-text("ใช้รายละเอียดสินค้านี้")',
  modalCancel: 'button:has-text("ยกเลิก"), button:has-text("Cancel")',
  itemDescription: 'input[name="description"]',
  itemHsCode: 'input[name="commodityCode"]',
  itemQuantity: 'input[name="quantity"]',
  itemUnit: 'select[name="quantityUnits"]',
  itemUnitValue: 'input[name="itemValue"]',
  itemCurrency: 'select[name="currentCurrency"]',   // ดีฟอลต์เป็น THB ต้องเปลี่ยนเป็นสกุลของงานเสมอ
  itemWeight: 'input[name="weight"]',               // ช่องบังคับ ถ้าเว้นไว้หน้าจะไม่ยอมไปต่อ
  itemManufacturerCountry: 'input[name="countryName"]',
  addItemLine: 'button:has-text("เพิ่มรายการ"), a:has-text("เพิ่มรายการ")',

  // แผงค่าใช้จ่ายเพิ่ม: select กับ input ไม่มีทั้ง name และ id — อ้างจากข้อความในตัวเลือกแทน
  extraChargeToggle: 'button:has-text("ค่าใช้จ่ายอื่นๆ/เพิ่มค่าใช้จ่าย")',
  extraChargeType: 'xpath=//select[option[contains(text(), "ค่าขนส่ง/ค่าธรรมเนียม")]]',
  extraChargeAmount: 'xpath=//select[option[contains(text(), "ค่าขนส่ง/ค่าธรรมเนียม")]]/following::input[1]',
  insuranceCheckbox: 'input[type="checkbox"][name="insureShipment"]',
  insuranceValue: 'input[name="shipmentInsuredValue"]',
  // สกุลเงินของประกันไม่มี name — อ้างจากช่องมูลค่าประกันที่อยู่ติดกัน
  insuranceCurrencyXpath: 'xpath=//input[@name="shipmentInsuredValue"]/following::select[1]',

  // ---- 3. customs invoice ----
  createInvoice: 'button:has-text("สร้าง Invoice"), button:has-text("Create invoice")',
  invoiceNumber: 'input[id*="invoiceNumber"], input[name*="invoiceNumber"]',
  tradeAgreementNo: 'input[type="radio"][id*="tradeAgreement"][value="false"], label:has-text("ไม่") input[type="radio"]',

  // ---- 4. บรรจุภัณฑ์ (ชื่อช่องสั้น ๆ ซ้ำกับหน้าสินค้า แต่คนละหน้ากันจึงไม่ชนกัน) ----
  packagingSelect: 'input[name="packagingName"]',   // ช่อง autocomplete "เลือกบรรจุภัณฑ์"
  packageQuantity: 'input[name="quantity"]',
  packageWeight: 'input[name="weight"]',
  packageLength: 'input[name="length"]',
  packageWidth: 'input[name="width"]',
  packageHeight: 'input[name="height"]',

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
    this.shipper = config.shipper;
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
    // เก็บ error ของหน้าเว็บไว้ด้วย — ปุ่มที่ "กดแล้วเงียบ" มักมาจาก JS พังตอน handler ทำงาน
    const consoleLogs = [];
    const note = (line) => {
      consoleLogs.push(line.slice(0, 300));
      if (consoleLogs.length > 40) consoleLogs.shift();
    };
    page.on('pageerror', (err) => note(`[pageerror] ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') note(`[${msg.type()}] ${msg.text()}`);
    });
    const steps = [];
    let stepNo = 0;
    // ทุกขั้นเก็บทั้งภาพหน้าจอและรายการช่องกรอก เพื่อแก้ selector ได้จากการรันซ้อมรอบเดียว
    const shot = async (name, error = null) => {
      stepNo += 1;
      const prefix = path.join(stepDir, `${String(stepNo).padStart(2, '0')}-${name}`);
      await page.screenshot({ path: `${prefix}.png`, fullPage: true }).catch(() => {});
      await dumpFields(page, `${prefix}.json`, { quiet: true, error, consoleLogs });
      steps.push(`${prefix}.png`);
    };

    try {
      await page.goto(this.cfg.url, { waitUntil: 'domcontentloaded' });
      await click(page, SEL.cookieAccept, { optional: true, timeout: 5000 });
      await this.login(page);
      await context.storageState({ path: this.sessionFile });
      await shot('login');

      await page.goto(`${shipUrl(this.cfg.url)}#/address-details`, { waitUntil: 'domcontentloaded' });
      await this.fillShipper(page);
      await this.fillReceiver(page, plan.receiver);
      await shot('address-details');
      await clickNext(page, 'shipment-type');
      await expectStep(page, 'shipment-type');

      let customsFilled = await this.fillShipmentType(page, plan, shot);
      await shot('shipment-type');
      await dismissModal(page);
      await clickNext(page, 'customs-declaration');
      await expectStep(page, 'customs-declaration');

      customsFilled = await this.fillCustomsInvoice(page, plan, customsFilled);
      if (!customsFilled) {
        throw new Error('ไม่พบช่องกรอกรายการสินค้า/ศุลกากรทั้งขั้น shipment-type และ customs-declaration'
          + ' — ต้องแก้ selector ก่อน ไม่งั้นชิปเมนต์จะไม่มีข้อมูลศุลกากร');
      }
      await shot('customs-declaration');
      await clickNext(page, 'package-details');
      await expectStep(page, 'package-details');

      await this.fillPackage(page, plan.package);
      await shot('package-details');
      await clickNext(page, 'shipment-products');
      await expectStep(page, 'shipment-products');

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
      if (!(err instanceof DryRunStop)) {
        await shot('error', err.message);
        await dumpFields(page, path.join(stepDir, 'fields-on-error.json'), { error: err.message, consoleLogs });
      }
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

  /**
   * กรอกฝั่ง "ส่งจาก" จากค่าใน .env — เติมเฉพาะช่องที่ยังว่าง
   * (บางบัญชี MyDHL+ เติมให้เองจาก address book บางครั้งไม่เติม ถ้าไม่ครบหน้าจะไม่ยอมไปต่อ)
   */
  async fillShipper(page) {
    const sp = this.shipper;
    const first = (selector) => page.locator(selector).first();
    await fillIfEmpty(first(SEL.fromCountry), countryLabelFor(sp.countryCode), { page, autocomplete: true, what: 'ประเทศผู้ส่ง' });
    await fillIfEmpty(first(SEL.fromName), sp.name, { what: 'ชื่อผู้ส่ง' });
    await fillIfEmpty(first(SEL.fromCompany), sp.company, { optional: true, what: 'บริษัทผู้ส่ง' });
    await fillIfEmpty(first(SEL.fromAddress1), sp.addressLine1, { what: 'ที่อยู่ผู้ส่ง 1' });
    await page.keyboard.press('Escape').catch(() => {});
    await fillIfEmpty(first(SEL.fromAddress2), sp.addressLine2, { optional: true, what: 'ที่อยู่ผู้ส่ง 2' });
    await fillIfEmpty(page.locator(SEL.fromPostalXpath).first(), sp.postalCode, { optional: true, what: 'รหัสไปรษณีย์ผู้ส่ง' });
    await fillIfEmpty(first(SEL.fromCity), sp.city, { optional: true, what: 'เมืองผู้ส่ง' });
    await fillIfEmpty(first(SEL.fromEmail), sp.email, { what: 'อีเมลผู้ส่ง' });
    await fillIfEmpty(first(SEL.fromPhoneCountryCode), stripPlus(sp.phoneCountryCode || dialCodeFor(sp.countryCode)), { optional: true, what: 'รหัสประเทศผู้ส่ง' });
    await fillIfEmpty(first(SEL.fromPhone), sp.phoneNumber, { optional: true, what: 'เบอร์โทรผู้ส่ง' });
    await fillIfEmpty(first(SEL.fromVatTax), sp.vatTaxId, { optional: true, what: 'VAT/Tax ID ผู้ส่ง' });
  }

  async fillReceiver(page, r) {
    // 1) ประเทศต้องมาก่อน เพราะช่องที่อยู่/ไปรษณีย์/State จะ render ตามประเทศที่เลือก
    await fillLocator(receiverInput(page, SEL.toCountry), r.countryName || r.countryCode, {
      page, autocomplete: true, what: 'ประเทศผู้รับ',
    });
    await page.locator(SEL.toAddress1).nth(1)
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {});

    await fillLocator(receiverInput(page, SEL.toName), r.name, { what: 'ชื่อผู้รับ' });
    await fillLocator(receiverInput(page, SEL.toCompany), r.company || '-', { optional: true, what: 'บริษัทผู้รับ' });
    await fillLocator(receiverInput(page, SEL.toAddress1), r.addressLine1, { what: 'ที่อยู่1' });
    // ช่องที่อยู่มี dropdown แนะนำที่อยู่เด้งขึ้นมา ปิดทิ้งไม่ให้บังปุ่ม/ช่องอื่น
    await page.keyboard.press('Escape').catch(() => {});
    await fillLocator(receiverInput(page, SEL.toAddress2), r.addressLine2, { optional: true, what: 'ที่อยู่2' });
    await fillLocator(receiverInput(page, SEL.toAddress3), r.addressLine3, { optional: true, what: 'ที่อยู่3' });
    await fillLocator(page.locator(SEL.toPostalXpath).first(), r.postalCode, { optional: true, what: 'รหัสไปรษณีย์' });
    await fillLocator(receiverInput(page, SEL.toCity), r.city, { optional: true, what: 'เมือง' });
    await fillLocator(page.locator(SEL.toStateXpath).first(), r.state, { optional: true, autocomplete: true, page, what: 'State' });
    await fillLocator(page.locator(SEL.toEmail).first(), r.email, { optional: true, what: 'อีเมลผู้รับ' });
    await fillLocator(receiverInput(page, SEL.toPhoneCountryCode), r.phoneCountryCode, { optional: true, what: 'รหัสประเทศเบอร์โทร' });
    await fillLocator(receiverInput(page, SEL.toPhone), r.phoneNumber, { optional: true, what: 'เบอร์โทรผู้รับ' });
    if (r.saveToAddressBook) await setCheckbox(page, SEL.saveAddress, true, { optional: true });
  }

  async fillShipmentType(page, plan, probe = async () => {}) {
    // เลือก "บรรจุภัณฑ์" ก่อน — ช่องสินค้า/ศุลกากรทั้งหมดจะ render ออกมาหลังจากนี้เท่านั้น
    await chooseRadioByValue(page, SEL.shipmentTypeRadios, 'PACKAGE', 'บรรจุภัณฑ์', 'ประเภทชิปเมนต์');
    await page.waitForTimeout(2000);
    await probe('shipment-type-package'); // เก็บ DOM หลังเลือกบรรจุภัณฑ์ ไว้ใช้แก้ selector

    // วัตถุประสงค์ต้องเลือกให้ได้จริง ไม่งั้น DHL จะไม่ยอมไปขั้นถัดไป
    await fill(page, SEL.purposeSelect, plan.purpose, { select: true, what: 'วัตถุประสงค์การจัดส่ง' });
    await page.waitForTimeout(1500);
    await probe('shipment-type-purpose'); // เก็บ DOM อีกครั้ง เผื่อช่องสินค้าโผล่ตรงนี้

    // ช่องรายการศุลกากรอาจอยู่หน้านี้หรือไปโผล่ขั้น customs-declaration แล้วแต่บัญชี/ปลายทาง
    // จึงลองกรอกทั้งสองที่ แล้วค่อยตรวจตอนท้ายว่ากรอกไปแล้วจริงหรือยัง
    return this.fillCustomsLines(page, plan, probe);
  }

  /**
   * กรอกรายการสินค้า/ศุลกากร + ค่าขนส่ง + ประกัน เท่าที่หน้าปัจจุบันมีช่องให้กรอก
   * @returns {Promise<boolean>} true ถ้ากรอกช่อง "รายละเอียดสินค้า" ได้อย่างน้อยหนึ่งรายการ
   */
  async fillCustomsLines(page, plan, probe = async () => {}) {
    let filled = false;

    for (const [index, line] of plan.customsLines.entries()) {
      if (index > 0) await click(page, SEL.addItemLine, { optional: true });
      const nth = index;
      const row = `สินค้ารายการที่ ${index + 1}`;
      const ok = await fill(page, SEL.itemDescription, line.description, { nth, optional: true });
      if (!ok) break; // หน้านี้ไม่มีช่องสินค้า ไปกรอกที่ขั้นถัดไปแทน
      filled = true;
      // DHL เก็บรหัสเป็นตัวเลขล้วน (พิมพ์ 9401.99.90 ไปมันก็ตัดจุดออกเอง)
      // ส่งแบบไม่มีจุดตั้งแต่แรก จะได้ไม่ไปสะดุดตัวตรวจรูปแบบของหน้าเว็บ
      await fill(page, SEL.itemHsCode, String(line.hsCode).replace(/\D/g, ''), { nth, what: `HS code (${row})` });
      await fill(page, SEL.itemQuantity, String(line.quantity), { nth, what: `จำนวน (${row})` });
      await fill(page, SEL.itemUnit, line.unit, { nth, select: true, what: `หน่วย (${row})` });
      await fill(page, SEL.itemUnitValue, String(line.unitValue), { nth, what: `มูลค่าต่อชิ้น (${row})` });
      // ดีฟอลต์ของบัญชีไทยคือ THB — ถ้าไม่เปลี่ยน มูลค่าศุลกากรจะผิดสกุลทั้งใบ
      await fill(page, SEL.itemCurrency, line.currency || plan.currency, { nth, select: true, what: `สกุลเงิน (${row})` });
      await fill(page, SEL.itemWeight, String(line.netWeightKg), { nth, what: `น้ำหนักต่อชิ้น (${row})` });
      await fill(page, SEL.itemManufacturerCountry, line.manufacturerCountry, {
        nth, autocomplete: true, what: `ประเทศผู้ผลิต (${row})`,
      });
    }
    if (!filled) return false;

    // ค่าขนส่งที่เก็บลูกค้า ใส่เป็น "ค่าใช้จ่ายเพิ่ม" เพื่อให้มูลค่าชิปเมนต์รวมถูกต้อง
    if (plan.freightCharge?.amount) {
      await click(page, SEL.extraChargeToggle, { optional: true });
      await page.waitForTimeout(1200);
      await probe('shipment-type-charges');
      const typed = await fill(page, SEL.extraChargeType, 'ค่าขนส่ง', { optional: true, select: true, contains: true });
      const amount = await fill(page, SEL.extraChargeAmount, String(plan.freightCharge.amount), { optional: true });
      if (!typed || !amount) {
        console.warn(`[dhl] ยังใส่ค่าขนส่ง ${plan.freightCharge.amount} ${plan.freightCharge.currency} ไม่ได้`
          + ' — มูลค่าชิปเมนต์รวมจะขาดส่วนนี้ ต้องแก้ selector ของ "ค่าใช้จ่ายอื่นๆ/เพิ่มค่าใช้จ่าย"');
        await dismissModal(page); // ปิดแผงที่เปิดค้าง ไม่ให้บังช่องถัดไป
      }
    }

    if (plan.insurance?.enabled) {
      await dismissModal(page);
      await setCheckbox(page, SEL.insuranceCheckbox, true, { what: 'ติ๊กเพิ่มการป้องกันชิปเมนต์' });
      await page.waitForTimeout(800);
      await fill(page, SEL.insuranceValue, String(plan.insurance.value), { what: 'มูลค่าที่เอาประกัน' });
      await fill(page, SEL.insuranceCurrencyXpath, plan.currency, { select: true, optional: true, what: 'สกุลเงินประกัน' });
    }
    return true;
  }

  async fillCustomsInvoice(page, plan, alreadyFilled = false) {
    await click(page, SEL.createInvoice, { optional: true });
    await fill(page, SEL.invoiceNumber, plan.invoiceNumber, { optional: true });
    if (plan.tradeAgreement === false) await click(page, SEL.tradeAgreementNo, { optional: true });
    // ถ้าหน้า shipment-type ไม่มีช่องสินค้า ให้กรอกที่นี่แทน
    return alreadyFilled || this.fillCustomsLines(page, plan);
  }

  async fillPackage(page, pkg) {
    // ชื่อบรรจุภัณฑ์เป็นรายการที่บันทึกไว้ในบัญชี ต้องเลือกจาก dropdown ไม่ใช่พิมพ์เฉย ๆ
    await fill(page, SEL.packagingSelect, pkg.packaging, { autocomplete: true, what: 'บรรจุภัณฑ์' });
    // ช่องที่เหลือเป็นช่องบังคับทั้งหมด — ถ้าเว้นไว้หน้าจะไม่ยอมไปต่อ
    await fill(page, SEL.packageQuantity, String(pkg.quantity), { what: 'จำนวนกล่อง' });
    await fill(page, SEL.packageWeight, String(pkg.weightKg), { what: 'น้ำหนักรวมกล่อง' });
    await fill(page, SEL.packageLength, String(pkg.length), { what: 'ความยาวกล่อง' });
    await fill(page, SEL.packageWidth, String(pkg.width), { what: 'ความกว้างกล่อง' });
    await fill(page, SEL.packageHeight, String(pkg.height), { what: 'ความสูงกล่อง' });
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

/** กรอกเฉพาะช่องที่ยังว่าง — ไม่ทับค่าที่ MyDHL+ เติมมาจากบัญชีเอง */
async function fillIfEmpty(locator, value, opts = {}) {
  if (value === undefined || value === null || value === '') {
    if (opts.optional) return false;
    throw new Error(`ไม่มีค่าที่จะกรอกลง ${opts.what || 'ช่อง'} — ตรวจค่า SHIPPER_* ใน .env`);
  }
  try {
    await locator.waitFor({ state: 'visible', timeout: opts.optional ? 8000 : 20_000 });
    const current = (await locator.inputValue().catch(() => '')).trim();
    if (current && !current.includes('_')) return false; // มีค่าอยู่แล้ว (ยกเว้นช่องที่เป็น mask ว่าง)
  } catch (err) {
    if (opts.optional) return false;
    throw new Error(`หาช่อง ${opts.what || ''} ไม่เจอ: ${err.message.split('\n')[0]}`);
  }
  return fillLocator(locator, value, opts);
}

/**
 * หน้า MyDHL+ จะไปขั้นต่อไปก็ต่อเมื่อกรอกครบ — ถ้าไม่ไป ให้เก็บข้อความ error บนหน้ามาบอก
 */
async function expectStep(page, step, timeout = 45_000) {
  try {
    // URL จริงของ MyDHL+ เป็นรูป shipment.html#/#<ขั้น> (มี # สองตัว) จึงจับแค่ชื่อขั้น
    await page.waitForFunction(
      (name) => location.hash.includes(name),
      step,
      { timeout, polling: 500 },
    );
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } catch {
    const problems = await page.evaluate(() => {
      const seen = new Set();
      const messages = [];
      const nodes = document.querySelectorAll('[class*="error" i], [class*="invalid" i], [aria-invalid="true"], .field-error, .validation-message');
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) continue; // ข้อความที่ซ่อนอยู่ ไม่ใช่ error จริงบนหน้า
        const text = (node.innerText || node.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        if (text && text.length < 200 && !seen.has(text)) { seen.add(text); messages.push(text); }
      }
      return { url: location.href, messages: messages.slice(0, 15) };
    }).catch(() => ({ url: 'unknown', messages: [] }));
    throw new Error(
      `หน้าไม่ไปขั้น "${step}" (ยังอยู่ ${problems.url})`
      + (problems.messages.length ? ` — ข้อความบนหน้า: ${problems.messages.join(' / ')}` : ' — ไม่พบข้อความ error บนหน้า ให้ดูภาพหน้าจอ'),
    );
  }
}

const DIAL_CODES = { TH: '66', AU: '61', US: '1', GB: '44', JP: '81', SG: '65', DE: '49', FR: '33' };
const COUNTRY_LABELS_BY_CODE = { TH: 'Thailand', AU: 'Australia', US: 'United States of America', GB: 'United Kingdom', JP: 'Japan', SG: 'Singapore', DE: 'Germany', FR: 'France' };

function countryLabelFor(code) {
  return COUNTRY_LABELS_BY_CODE[code] || code;
}

function dialCodeFor(code) {
  return DIAL_CODES[code] || null;
}

function stripPlus(value) {
  return value ? String(value).replace(/^\+/, '') : value;
}

/** ช่องฝั่ง "ส่งถึง" = ช่อง name เดียวกันตัวท้ายสุดในหน้า (ฝั่งส่งจากมาก่อนใน DOM) */
function receiverInput(page, selector) {
  return page.locator(selector).last();
}

/** กรอกค่าลง locator ที่หามาแล้ว (รู้จัก select / ช่อง autocomplete / ช่องที่ไม่บังคับ) */
async function fillLocator(locator, value, opts = {}) {
  const { optional = false, autocomplete = false, page = null, what = 'ช่อง', timeout = 30_000, contains = false } = opts;
  if (value === undefined || value === null || value === '' || value === 'null') {
    if (optional) return false;
    throw new Error(`ไม่มีค่าที่จะกรอกลง ${what}`);
  }
  try {
    await locator.waitFor({ state: 'visible', timeout: optional ? 8000 : timeout });
    const tag = await locator.evaluate((node) => node.tagName.toLowerCase());
    if (tag === 'select') {
      await selectOptionSmart(locator, String(value), contains);
      return true;
    }
    await locator.fill(String(value));
    if (autocomplete && page) {
      // ช่องแบบ autocomplete ของ DHL ต้องเลือกจากรายการที่เด้งขึ้นมา ไม่ใช่แค่พิมพ์
      await page.waitForTimeout(600);
      await page.keyboard.press('ArrowDown').catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
    }
    return true;
  } catch (err) {
    if (optional) {
      console.warn(`[dhl] ข้าม ${what}: ${err.message.split('\n')[0]}`);
      return false;
    }
    throw new Error(`กรอก ${what} ไม่ได้: ${err.message.split('\n')[0]}`);
  }
}

/**
 * กดปุ่มแบบไล่ลอง "ทุกตัวที่มองเห็น" ไม่ใช่แค่ตัวแรก
 * หน้า MyDHL+ มีปุ่มข้อความซ้ำกันหลายตัว (บางตัวซ่อนอยู่/อยู่นอกจอ) การจับตัวแรกอย่างเดียวจึงพลาดบ่อย
 */
async function click(page, selector, { optional = false, timeout = 30_000, what = null } = {}) {
  const all = page.locator(selector);
  const deadline = Date.now() + timeout;
  do {
    const count = await all.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const el = all.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      await el.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await el.click({ timeout: 5000 });
        return true;
      } catch {
        // มีอะไรบังอยู่ ลองยิง click ผ่าน DOM ตรง ๆ เป็นทางสุดท้ายของปุ่มตัวนี้
        const clicked = await el.evaluate((node) => { node.click(); return true; }).catch(() => false);
        if (clicked) return true;
      }
    }
    await page.waitForTimeout(500);
  } while (Date.now() < deadline);
  if (!optional) throw new Error(`กดปุ่มไม่ได้: ${what || selector}`);
  return false;
}

/**
 * เลือก radio ของ MyDHL+ จากค่า value (อ่านจาก property) หรือข้อความบน label
 * ตัว input ถูกซ่อนไว้ใต้การ์ด จึงลองกด label ก่อน แล้วค่อย check แบบ force และยืนยันผลทุกครั้ง
 */
async function chooseRadioByValue(page, groupSelector, value, labelText, what) {
  const group = page.locator(groupSelector);
  try {
    await group.first().waitFor({ state: 'attached', timeout: 30_000 });
  } catch {
    throw new Error(`หากลุ่มตัวเลือก "${what}" ไม่เจอบนหน้า (selector: ${groupSelector})`);
  }

  const count = await group.count();
  const seen = [];
  let radio = null;
  for (let i = 0; i < count; i += 1) {
    const candidate = group.nth(i);
    const info = await candidate.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        value: el.value,
        visible: rect.width > 0 && rect.height > 0,
        label: (el.closest('label')?.innerText
          || (el.id && document.querySelector(`label[for="${el.id}"]`)?.innerText)
          || el.closest('div, li')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      };
    }).catch(() => ({ value: null, visible: false, label: '' }));
    if (!info.visible) continue; // ข้าม radio ที่ซ่อนอยู่ (แบนเนอร์คุกกี้ ฯลฯ)
    seen.push(`${info.value}/${info.label}`);
    if (info.value === value || (labelText && info.label.includes(labelText))) { radio = candidate; break; }
  }
  if (!radio) {
    throw new Error(`ไม่พบตัวเลือก "${labelText || value}" ใน "${what}" — บนหน้ามีแค่: ${seen.join(', ') || '(ไม่มี)'}`);
  }
  if (await radio.isChecked().catch(() => false)) return;

  const id = await radio.getAttribute('id');
  if (id) await page.locator(`label[for="${id}"]`).first().click({ timeout: 5000 }).catch(() => {});
  if (!(await radio.isChecked().catch(() => false))) {
    await radio.locator('xpath=ancestor::label[1]').first().click({ timeout: 5000 }).catch(() => {});
  }
  if (!(await radio.isChecked().catch(() => false))) {
    await radio.check({ force: true, timeout: 10_000 }).catch(() => {});
  }
  if (!(await radio.isChecked().catch(() => false))) {
    await radio.evaluate((el) => { el.click(); el.dispatchEvent(new Event('change', { bubbles: true })); }).catch(() => {});
  }
  if (!(await radio.isChecked().catch(() => false))) {
    throw new Error(`เลือก "${labelText || value}" ใน "${what}" ไม่สำเร็จ — ดูภาพหน้าจอขั้นนี้ประกอบ`);
  }
}

async function setCheckbox(page, selector, checked, { optional = false, timeout = 15_000, what = null } = {}) {
  const el = page.locator(selector).first();
  try {
    await el.waitFor({ state: 'attached', timeout });
    if ((await el.isChecked()) !== checked) await el.setChecked(checked, { force: true });
  } catch (err) {
    if (!optional) throw new Error(`ติ๊ก checkbox ไม่ได้: ${what || selector}`);
  }
}

/** @returns {Promise<boolean>} กรอกสำเร็จหรือไม่ — ใช้ตัดสินใจว่าหน้านี้มีช่องนั้นจริงไหม */
async function fill(page, selector, value, opts = {}) {
  const {
    optional = false, select = false, autocomplete = false, contains = false,
    nth = 0, timeout = 30_000, label = null, labelNth = 0, what = null,
  } = opts;
  const name = what || selector;
  if (value === undefined || value === null || value === '' || value === 'null') {
    if (optional) return false;
    throw new Error(`ไม่มีค่าที่จะกรอกลง ${name}`);
  }
  const el = await resolveField(page, selector, { nth, label, labelNth, timeout: optional ? 8000 : timeout });
  if (!el) {
    if (optional) return false;
    throw new Error(`หาช่องไม่เจอ: ${name}${label ? ` (label "${label}")` : ''}`);
  }
  try {
    const tag = await el.evaluate((node) => node.tagName.toLowerCase());
    if (tag === 'select') {
      await selectOptionSmart(el, String(value), contains);
      return true;
    }
    await el.fill(String(value));
    if (autocomplete) {
      // ช่องแบบ autocomplete ของ DHL ต้องเลือกจากรายการที่เด้งขึ้นมา ไม่ใช่แค่พิมพ์
      await page.keyboard.press('ArrowDown').catch(() => {});
      await page.keyboard.press('Enter').catch(() => {});
    }
    return true;
  } catch (err) {
    if (!optional) throw new Error(`กรอกช่อง ${name} ไม่ได้: ${err.message.split('\n')[0]}`);
    return false;
  }
}

/**
 * หาช่องกรอกจาก selector ก่อน ถ้าไม่เจอค่อยหาจากข้อความ label ที่มองเห็น
 * (ฟอร์ม DHL มี label ซ้ำกันสองฝั่ง ส่งจาก/ส่งถึง — labelNth=1 คือฝั่งผู้รับ)
 */
/** isVisible() ไม่รอ (Playwright เมิน timeout ที่ส่งให้) — ต้องใช้ waitFor ถึงจะรอช่องที่ render ช้าจริง */
async function waitVisible(locator, timeout) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function resolveField(page, selector, { nth = 0, label = null, labelNth = 0, timeout = 30_000 } = {}) {
  const bySelector = page.locator(selector).nth(nth);
  if (await waitVisible(bySelector, timeout)) return bySelector;
  if (!label) return null;
  for (const candidate of [
    page.getByLabel(label, { exact: false }).nth(labelNth),
    page.locator(`input[aria-label*="${label}"], select[aria-label*="${label}"]`).nth(labelNth),
    page.locator(`xpath=(//label[contains(normalize-space(.), "${label}")]/following::input[1])[${labelNth + 1}]`),
  ]) {
    if (await waitVisible(candidate, 5000)) {
      console.warn(`[dhl] ใช้ label "${label}" แทน selector ${selector}`);
      return candidate;
    }
  }
  return null;
}

/**
 * เลือกตัวเลือกใน <select> โดยเทียบข้อความ แล้ว "ตรวจซ้ำ" ว่าค่าเปลี่ยนจริง
 * บางหน้าของ DHL ผูกกับ JS framework ที่ไม่ยอมรับค่าจนกว่าจะมี event change — จึงมีทางสำรองไว้
 */
async function selectOptionSmart(select, value, contains) {
  const options = await select.locator('option').all();
  const wanted = value.toLowerCase();
  const texts = [];
  let target = null;
  for (const option of options) {
    const label = ((await option.textContent()) || '').trim();
    texts.push(label);
    const lower = label.toLowerCase();
    if (lower === wanted || (contains && lower.includes(wanted))) { target = label; break; }
  }

  if (target) await select.selectOption({ label: target }).catch(() => {});
  else await select.selectOption(value).catch(() => {});

  if (await selectedTextMatches(select, wanted, contains)) return;

  // ทางสำรอง: ตั้งค่าเองแล้วยิง event ให้หน้าเว็บรู้ตัว
  await select.evaluate((el, wantedText) => {
    const match = [...el.options].find((o) => o.text.trim().toLowerCase() === wantedText);
    if (!match) return;
    el.value = match.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, wanted).catch(() => {});

  if (!(await selectedTextMatches(select, wanted, contains))) {
    throw new Error(`เลือก "${value}" ไม่สำเร็จ — ตัวเลือกที่มีคือ: ${texts.join(' | ')}`);
  }
}

/**
 * ตรวจจาก "ข้อความ" ของตัวเลือกที่ถูกเลือก ไม่ใช่ค่า value
 * เพราะ DHL แจก value ใหม่ทุกครั้งที่ render (รอบหนึ่ง Boxes เป็น "8" อีกรอบเป็น "0")
 */
async function selectedTextMatches(select, wantedLower, contains) {
  const text = await select.evaluate((el) => {
    const option = el.options[el.selectedIndex];
    return option ? option.text.trim().toLowerCase() : '';
  }).catch(() => '');
  if (!text) return false;
  return text === wantedLower || (contains && text.includes(wantedLower));
}

/**
 * กด "ถัดไป" แล้วรอให้ hash เปลี่ยนจริง ถ้าไม่เปลี่ยนค่อยเปลี่ยนวิธีกด
 * หน้านี้มีแถบ header ของ DHL ลอยติดขอบบน ทำให้ปุ่มที่เลื่อนไปชิดขอบถูกบังจนคลิกไม่โดน
 */
async function clickNext(page, expectedStep) {
  const button = page.locator(SEL.next).filter({ visible: true }).last();
  const strategies = [
    async () => {
      await button.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(400);
      await button.click({ timeout: 8000 });
    },
    async () => { await button.focus(); await page.keyboard.press('Enter'); },
    async () => { await button.evaluate((el) => el.click()); },
    async () => { await button.click({ force: true, timeout: 8000 }); },
  ];

  for (const [index, attempt] of strategies.entries()) {
    const before = await page.evaluate(() => location.hash);
    await attempt().catch((err) => console.warn(`[dhl] กดถัดไปวิธีที่ ${index + 1} ไม่ผ่าน: ${err.message.split('\n')[0]}`));
    const moved = await page.waitForFunction(
      ([step, prev]) => location.hash.includes(step) || location.hash !== prev,
      [expectedStep, before],
      { timeout: 8000, polling: 300 },
    ).then(() => true).catch(() => false);
    if (moved) return;
  }
  // ไม่ throw ที่นี่ — ปล่อยให้ expectStep เป็นคนรายงาน พร้อมข้อความบนหน้าและ DOM ที่เก็บไว้
  console.warn('[dhl] กดปุ่มถัดไปครบทุกวิธีแล้วหน้ายังไม่เปลี่ยน');
}

/** ปิด modal ที่เปิดค้าง (เช่น ตัวช่วยเขียนรายละเอียดสินค้า) ไม่ให้บังช่องอื่นบนหน้า */
async function dismissModal(page) {
  if (!(await page.locator(SEL.itemDetailsModal).first().isVisible().catch(() => false))
    && !(await page.locator(SEL.modalCancel).first().isVisible().catch(() => false))) return;
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await click(page, SEL.modalCancel, { optional: true, timeout: 3000 });
  await page.waitForTimeout(500);
}

/** เก็บรายการช่องกรอกของหน้าปัจจุบันไว้ตอนล้มเหลว เพื่อแก้ selector ได้โดยไม่ต้องรันซ้ำ */
async function dumpFields(page, file, { quiet = false, error = null, consoleLogs = null } = {}) {
  try {
    const data = await page.evaluate(() => ({
      url: location.href,
      fields: [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => el.type !== 'hidden')
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const label = el.closest('div, td, li')?.querySelector('label')?.innerText?.trim() || null;
          return {
            tag: el.tagName.toLowerCase(), type: el.type || null, name: el.getAttribute('name'),
            id: el.id || null, label, placeholder: el.getAttribute('placeholder'),
            value: el.value ? String(el.value).slice(0, 40) : '',
            options: el.tagName === 'SELECT' ? [...el.options].slice(0, 15).map((o) => o.text.trim()) : undefined,
            x: Math.round(rect.x), y: Math.round(rect.y), visible: rect.width > 0 && rect.height > 0,
          };
        }),
      buttons: [...document.querySelectorAll('button, [role="tab"], a[role="button"]')]
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const text = el.innerText.trim().slice(0, 60);
          if (!text) return null;
          const flags = [rect.width && rect.height ? null : 'ซ่อน', el.disabled ? 'กดไม่ได้' : null]
            .filter(Boolean).join(',');
          return flags ? `${text} [${flags}]` : text;
        }).filter(Boolean),
      // ช่องที่ตัวฟอร์มเองถือว่ายังไม่ผ่าน — ตัวนี้บอกได้ตรงที่สุดว่าทำไมหน้าไม่ยอมไปต่อ
      invalidFields: [...document.querySelectorAll('.ng-invalid, [aria-invalid="true"], .is-invalid, .has-error')]
        .filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && el.tagName !== 'FORM';
        })
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          name: el.getAttribute('name'),
          id: el.id || null,
          className: (el.className || '').toString().slice(0, 120),
          near: (el.closest('div, td, li')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        }))
        .slice(0, 20),
      // ข้อความทั้งหน้าแบบย่อ — ใช้หาข้อความ validation ที่ไม่ได้อยู่ใน element ที่มี class ว่า error
      pageText: document.body.innerText.replace(/\n{2,}/g, '\n').trim().slice(0, 4000),
    }));
    // ใส่ข้อความ error ลงไฟล์ด้วย จะได้ดูไฟล์เดียวจบ ไม่ต้องไล่หาใน terminal
    const payload = { ...(error ? { error } : {}), ...(consoleLogs?.length ? { consoleLogs } : {}), ...data };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    if (!quiet) console.warn(`[dhl] เก็บรายการช่องของหน้าที่ค้างไว้ที่ ${file} — ส่งไฟล์นี้มาแก้ selector ได้เลย`);
  } catch {
    // ไม่ต้องทำอะไร ถ้าหน้าปิดไปแล้ว
  }
}

module.exports = { MyDhlFlow, SEL, shipUrl, DryRunStop, receiverInput, dumpFields, expectStep, countryLabelFor };
