/**
 * เครื่องมือสำรวจฟอร์ม MyDHL+ — ใช้ตอนตั้งค่าครั้งแรกหรือเวลา DHL เปลี่ยน UI
 *
 * เปิดหน้าที่ต้องการ แล้วดัมพ์ทุกช่องกรอก (id / name / label / placeholder / ตำแหน่ง)
 * ออกมาเป็น JSON + ภาพหน้าจอ เพื่อเอาไปเขียน selector ให้ตรงกับของจริง
 *
 *   node src/cli.js inspect                     # หน้า address-details
 *   node src/cli.js inspect shipment-type
 */
const fs = require('fs');
const path = require('path');

async function inspectStep(config, step = 'address-details') {
  const { chromium } = require('playwright');
  const cfg = config.dhl.web;
  const outDir = path.join(config.dataDir, 'inspect');
  fs.mkdirSync(outDir, { recursive: true });

  const sessionFile = path.join(config.dataDir, 'dhl-web-session.json');
  const browser = await chromium.launch({ headless: cfg.headless });
  const context = await browser.newContext({
    locale: 'th-TH',
    viewport: { width: 1600, height: 1000 },
    storageState: fs.existsSync(sessionFile) ? sessionFile : undefined,
  });
  const page = await context.newPage();

  try {
    await page.goto(cfg.url, { waitUntil: 'domcontentloaded' });
    await page.locator('#onetrust-accept-btn-handler, button:has-text("Accept All"), button:has-text("ยอมรับ")')
      .first().click({ timeout: 5000 }).catch(() => {});

    const userField = page.locator('input#loginUsername, input[name="username"], input[type="email"]').first();
    if (await userField.isVisible({ timeout: 8000 }).catch(() => false)) {
      await userField.fill(cfg.username);
      await page.locator('input#loginPassword, input[name="password"], input[type="password"]').first().fill(cfg.password);
      await page.locator('button#loginSubmitButton, button[type="submit"], button:has-text("เข้าสู่ระบบ")').first().click().catch(() => {});
      console.log('[inspect] ส่ง login แล้ว — ถ้ามี OTP ให้กรอกในหน้าจอที่เปิดอยู่ (รอ 3 นาที)');
      await page.waitForTimeout(cfg.headless ? 15_000 : 45_000);
    }
    await context.storageState({ path: sessionFile });

    const url = new URL(cfg.url);
    const locale = url.pathname.split('/').filter(Boolean).slice(0, 2).join('/') || 'th/th';
    const target = `${url.origin}/${locale}/shipment.html#/${step}`;
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const fields = await page.evaluate(() => {
      const labelFor = (el) => {
        if (el.id) {
          const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (byFor) return byFor.innerText.trim();
        }
        const wrapping = el.closest('label');
        if (wrapping) return wrapping.innerText.trim();
        const group = el.closest('div, td, li');
        const label = group?.querySelector('label');
        return label ? label.innerText.trim() : null;
      };
      return [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => el.type !== 'hidden')
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            tag: el.tagName.toLowerCase(),
            type: el.type || null,
            id: el.id || null,
            name: el.getAttribute('name'),
            placeholder: el.getAttribute('placeholder'),
            ariaLabel: el.getAttribute('aria-label'),
            label: labelFor(el),
            value: el.value ? String(el.value).slice(0, 40) : '',
            options: el.tagName === 'SELECT'
              ? [...el.options].slice(0, 15).map((o) => o.text.trim())
              : undefined,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            visible: rect.width > 0 && rect.height > 0,
          };
        });
    });

    const buttons = await page.evaluate(() => [...document.querySelectorAll('button, a[role="button"], [role="tab"]')]
      .map((el) => ({ text: el.innerText.trim().slice(0, 60), id: el.id || null, class: el.className?.toString().slice(0, 60) }))
      .filter((b) => b.text));

    const jsonFile = path.join(outDir, `${step}.json`);
    const shotFile = path.join(outDir, `${step}.png`);
    fs.writeFileSync(jsonFile, JSON.stringify({ url: page.url(), title: await page.title(), fields, buttons }, null, 2));
    await page.screenshot({ path: shotFile, fullPage: true }).catch(() => {});

    console.log(`\n[inspect] url = ${page.url()}`);
    console.log(`[inspect] เจอ ${fields.length} ช่อง — ไฟล์: ${jsonFile}\n`);
    for (const f of fields.filter((f) => f.visible)) {
      console.log([
        `x=${String(f.x).padStart(4)}`,
        `${f.tag}${f.type ? `[${f.type}]` : ''}`,
        `id=${f.id || '-'}`,
        `name=${f.name || '-'}`,
        `label=${(f.label || '-').replace(/\s+/g, ' ').slice(0, 30)}`,
        f.value ? `value=${f.value}` : '',
      ].join('  '));
    }
    console.log(`\n[inspect] ภาพหน้าจอ: ${shotFile}`);
    console.log('[inspect] ส่งไฟล์ JSON กับภาพนี้มาให้ Claude เพื่อเขียน selector ให้ตรงกับของจริง');
    return { jsonFile, shotFile, fields };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = { inspectStep };
