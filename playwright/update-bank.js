/**
 * FlowAccount – อัปเดตข้อมูลธนาคารของ Contacts จาก Google Sheet
 *
 * วิธีใช้:
 *   1) cd playwright && npm install
 *   2) คัดลอก .env.example -> .env แล้วใส่ email/password ของ FlowAccount
 *   3) ตรวจสอบว่า Google Sheet ตั้งค่า share = "ใครก็ตามที่มีลิงก์ดูได้"
 *   4) npx playwright install chromium  (ครั้งแรกเท่านั้น)
 *   5) node update-bank.js
 *
 * หมายเหตุ:
 *   - สคริปต์เปิด browser แบบมีหน้าจอ (headless: false) เพื่อให้ผู้ใช้
 *     ทำ 2FA / CAPTCHA ได้เอง ถ้าเจอ ให้ทำเอง แล้วสคริปต์จะรันต่อ
 *   - Selector ของ FlowAccount เป็นการเดาแบบ best-effort
 *     ถ้า UI เปลี่ยน ให้แก้ตรง section "SELECTORS" ด้านล่าง
 */

const { chromium } = require('playwright');
const https = require('https');
require('dotenv').config();

// ---------- CONFIG ----------
const SHEET_ID = '1CR5T5XnyFSIT1r2q-XKuxowOk4IiQTl_dLVM0aJe-vs';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const CONTACTS_URL = 'https://advance.flowaccount.com/N4236690/business/contacts';
const LOGIN_URL = 'https://flowaccount.com/login';

const EMAIL = process.env.FLOWACCOUNT_EMAIL;
const PASSWORD = process.env.FLOWACCOUNT_PASSWORD;

const BRANCH_CODE = '0000';
const BRANCH_NAME = '-';
const ACCOUNT_TYPE = 'ออมทรัพย์';

// ---------- SELECTORS (แก้ตรงนี้ถ้า UI FlowAccount เปลี่ยน) ----------
const SEL = {
  loginEmail: 'input[type="email"], input[name="email"], input[name="username"]',
  loginPassword: 'input[type="password"], input[name="password"]',
  loginSubmit: 'button[type="submit"], button:has-text("เข้าสู่ระบบ"), button:has-text("Login")',

  contactsSearch: 'input[type="search"], input[placeholder*="ค้นหา"], input[placeholder*="Search"]',
  contactRowByName: (name) => `tr:has-text("${name}"), [role="row"]:has-text("${name}"), a:has-text("${name}")`,

  editButton: 'button:has-text("แก้ไข"), a:has-text("แก้ไข"), button[aria-label*="แก้ไข"]',
  bankTab: 'button:has-text("ข้อมูลธนาคาร"), a:has-text("ข้อมูลธนาคาร"), [role="tab"]:has-text("ธนาคาร"), button:has-text("บัญชีธนาคาร")',
  addBankButton: 'button:has-text("เพิ่มบัญชีธนาคาร"), button:has-text("เพิ่ม")',

  bankNameField:    'input[name*="bankName"], input[placeholder*="ธนาคาร"], [aria-label*="ธนาคาร"]',
  accountNameField: 'input[name*="accountName"], input[placeholder*="ชื่อบัญชี"]',
  accountNumberField: 'input[name*="accountNumber"], input[placeholder*="เลขที่บัญชี"]',
  branchCodeField:  'input[name*="branchCode"], input[placeholder*="รหัสสาขา"]',
  branchNameField:  'input[name*="branchName"], input[placeholder*="ชื่อสาขา"]',
  accountTypeField: 'select[name*="accountType"], [aria-label*="ประเภทบัญชี"], input[placeholder*="ประเภทบัญชี"]',

  saveAndClose: 'button:has-text("บันทึกแล้วปิด")',
};

// ---------- HELPERS ----------
function fetchCsv(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('Too many redirects'));
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchCsv(res.headers.location, redirects + 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} – ตรวจสอบว่า Sheet share = Anyone with the link`));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuote = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch === '\r') { /* skip */ }
      else cur += ch;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

async function safeFill(page, selector, value) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 8000 });
  await el.fill('');
  await el.fill(value);
}

async function safePickBank(page, bankName) {
  // ฟิลด์ธนาคารใน FlowAccount มักเป็น combobox/dropdown
  const field = page.locator(SEL.bankNameField).first();
  await field.waitFor({ state: 'visible', timeout: 8000 });
  await field.click();
  await field.fill(bankName);
  await page.waitForTimeout(800);
  // เลือกตัวเลือกที่ตรงในเมนู
  const option = page.locator(`[role="option"]:has-text("${bankName}"), li:has-text("${bankName}")`).first();
  if (await option.count()) await option.click();
}

async function safePickAccountType(page, label) {
  const field = page.locator(SEL.accountTypeField).first();
  await field.waitFor({ state: 'visible', timeout: 8000 });
  const tag = await field.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    await field.selectOption({ label });
  } else {
    await field.click();
    await page.waitForTimeout(400);
    const opt = page.locator(`[role="option"]:has-text("${label}"), li:has-text("${label}")`).first();
    if (await opt.count()) await opt.click();
    else await field.fill(label);
  }
}

// ---------- MAIN ----------
(async () => {
  if (!EMAIL || !PASSWORD) {
    console.error('ERROR: ตั้งค่า FLOWACCOUNT_EMAIL และ FLOWACCOUNT_PASSWORD ใน .env');
    process.exit(1);
  }

  console.log('โหลด Google Sheet...');
  const csv = await fetchCsv(CSV_URL);
  const rows = parseCsv(csv);
  if (rows.length < 2) {
    console.error('Sheet ว่างหรืออ่านไม่ได้');
    process.exit(1);
  }

  // skip header row
  const records = rows.slice(1).map((r) => ({
    accountName:   (r[0]  || '').trim(),  // Column A
    bankName:      (r[17] || '').trim(),  // Column R
    accountNumber: (r[18] || '').trim(),  // Column S
  })).filter((x) => x.accountName && x.bankName && x.accountNumber);

  console.log(`เจอ ${records.length} รายการที่มีข้อมูลธนาคารครบ`);

  const browser = await chromium.launch({ headless: false, slowMo: 80 });
  const context = await browser.newContext({ locale: 'th-TH' });
  const page = await context.newPage();

  // -- LOGIN --
  console.log('กำลัง login FlowAccount...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  try {
    await safeFill(page, SEL.loginEmail, EMAIL);
    await safeFill(page, SEL.loginPassword, PASSWORD);
    await page.locator(SEL.loginSubmit).first().click();
  } catch (e) {
    console.warn('Auto-login อาจไม่สำเร็จ — กรุณา login เอง แล้วสคริปต์จะรันต่อ');
  }

  // รอจน URL เข้าหน้าหลัก (เผื่อ 2FA)
  console.log('รอเข้าสู่ระบบเสร็จ (รวม 2FA ถ้ามี)... สูงสุด 3 นาที');
  await page.waitForURL(/flowaccount\.com\/N\d+/, { timeout: 180000 }).catch(() => {});

  const results = { ok: [], failed: [] };

  for (const rec of records) {
    console.log(`\n→ ${rec.accountName} | ${rec.bankName} | ${rec.accountNumber}`);
    try {
      await page.goto(CONTACTS_URL, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});

      // ค้นหา contact
      const search = page.locator(SEL.contactsSearch).first();
      await search.waitFor({ state: 'visible', timeout: 15000 });
      await search.fill('');
      await search.fill(rec.accountName);
      await page.waitForTimeout(1500);

      // คลิกผลลัพธ์แรกที่ตรง
      const target = page.locator(SEL.contactRowByName(rec.accountName)).first();
      await target.waitFor({ state: 'visible', timeout: 10000 });
      await target.click();
      await page.waitForLoadState('networkidle').catch(() => {});

      // กดปุ่ม "แก้ไข"
      const editBtn = page.locator(SEL.editButton).first();
      if (await editBtn.count()) {
        await editBtn.click();
        await page.waitForLoadState('networkidle').catch(() => {});
      }

      // ไป tab/section "ข้อมูลธนาคาร"
      const bankTab = page.locator(SEL.bankTab).first();
      if (await bankTab.count()) {
        await bankTab.click();
        await page.waitForTimeout(500);
      }

      // ถ้ามีปุ่ม "เพิ่มบัญชีธนาคาร" ให้กด
      const addBtn = page.locator(SEL.addBankButton).first();
      if (await addBtn.count()) {
        await addBtn.click().catch(() => {});
        await page.waitForTimeout(500);
      }

      // กรอกข้อมูล
      await safePickBank(page, rec.bankName);
      await safeFill(page, SEL.accountNameField, rec.accountName);
      await safeFill(page, SEL.accountNumberField, rec.accountNumber);
      await safeFill(page, SEL.branchCodeField, BRANCH_CODE);
      await safeFill(page, SEL.branchNameField, BRANCH_NAME);
      await safePickAccountType(page, ACCOUNT_TYPE);

      // กดบันทึกแล้วปิด
      await page.locator(SEL.saveAndClose).first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      console.log('  ✓ บันทึกแล้ว');
      results.ok.push(rec.accountName);
    } catch (e) {
      console.error(`  ✗ ล้มเหลว: ${e.message}`);
      results.failed.push({ name: rec.accountName, error: e.message });
      // ถ่ายภาพหน้าจอเก็บไว้ debug
      await page.screenshot({ path: `error_${Date.now()}.png`, fullPage: true }).catch(() => {});
    }
  }

  console.log('\n========== สรุป ==========');
  console.log(`สำเร็จ: ${results.ok.length}`);
  console.log(`ล้มเหลว: ${results.failed.length}`);
  if (results.failed.length) console.log(JSON.stringify(results.failed, null, 2));

  await browser.close();
})();
