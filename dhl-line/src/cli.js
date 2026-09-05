/**
 * เครื่องมือทดสอบจาก terminal (ไม่ต้องมี LINE)
 *
 *   node src/cli.js parse ใบงาน.txt            ดูผลการอ่านข้อความจาก LINE
 *   node src/cli.js plan ใบงาน.txt             ดูค่าที่จะกรอกลงฟอร์ม DHL ทุกช่อง + ฟิลด์ที่ขาด
 *   node src/cli.js submit ใบงาน.txt --run      ใส่คิวแล้วสั่งทำเลย (สร้าง shipment + พิมพ์)
 *   node src/cli.js jobs                        ดูรายการงาน
 *   node src/cli.js inspect [ขั้น]              ดัมพ์ช่องกรอกจริงบนฟอร์ม DHL (แก้ selector)
 *   node src/cli.js fields [jobId]              อ่าน DOM ที่เก็บไว้ตอนรันซ้อมแบบย่อ
 *   node src/cli.js printers                    ดูรายชื่อเครื่องพิมพ์ที่มองเห็น
 *   node src/cli.js print label.pdf             ทดสอบพิมพ์ไฟล์เดียว
 */
const fs = require('fs');
const path = require('path');

const config = require('./config');
const { parseLineShipment } = require('./parse/parseLineShipment');
const { buildShipmentPlan } = require('./plan/buildShipmentPlan');
const { JobStore } = require('./store/jobStore');
const { InvoiceSequence } = require('./store/invoiceSequence');
const { createDhlClient } = require('./dhl');
const { createPrinter } = require('./print');
const { intake } = require('./intake');
const { inspectStep } = require('./dhl/inspect');
const { processJob } = require('./pipeline');

function readInput(arg) {
  if (!arg) throw new Error('ต้องระบุไฟล์หรือข้อความ');
  return fs.existsSync(arg) ? fs.readFileSync(arg, 'utf8') : arg;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const store = new JobStore(config.dataDir);

  switch (command) {
    case 'parse': {
      const parsed = parseLineShipment(readInput(args[0]), { boxTareKg: config.boxTareKg });
      console.log(JSON.stringify(parsed, null, 2));
      break;
    }

    case 'plan': {
      const parsed = parseLineShipment(readInput(args[0]), { boxTareKg: config.boxTareKg });
      const result = buildShipmentPlan(parsed, {
        shipperCountryCode: config.shipper.countryCode,
        customsLineMode: config.customsLineMode,
        invoiceNumber: new InvoiceSequence(config.dataDir).peek() || '(ยังไม่ออกเลข)',
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'submit': {
      const text = readInput(args.find((a) => !a.startsWith('--')));
      const result = intake({ store, config, text, sourceId: 'cli' });
      console.log(result.reply);
      if (args.includes('--run') && result.job && result.job.status === 'pending') {
        const claimed = store.claimNext();
        const done = await processJob({
          store,
          config,
          dhl: createDhlClient(config),
          printer: createPrinter(config),
          line: null,
          invoiceSequence: new InvoiceSequence(config.dataDir),
        }, claimed);
        console.log(JSON.stringify(done, null, 2));
      }
      break;
    }

    case 'jobs': {
      for (const j of store.list()) {
        console.log([j.jobId, j.status, j.invoiceNumber || '-', j.shipment?.receiver?.name || '-', j.trackingNumber || '-', j.error || ''].join(' | '));
      }
      break;
    }

    case 'fields': {
      // อ่านไฟล์ DOM ที่เก็บไว้ตอนรันซ้อม (data/steps/<jobId>/*.json) มาแสดงแบบย่อ
      const stepsDir = path.join(config.dataDir, 'steps');
      let dir = args[0] ? path.resolve(args[0]) : null;
      if (dir && !fs.existsSync(dir)) dir = path.join(stepsDir, args[0]);
      if (!dir) {
        const jobs = fs.existsSync(stepsDir)
          ? fs.readdirSync(stepsDir).map((d) => path.join(stepsDir, d)).sort()
          : [];
        dir = jobs[jobs.length - 1];
      }
      if (!dir || !fs.existsSync(dir)) {
        console.log(`ไม่พบโฟลเดอร์ที่เก็บ DOM (ลองรันซ้อมก่อน) — มองหาใน ${stepsDir}`);
        break;
      }
      console.log(`# ${dir}\n`);
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
        const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        console.log(`=== ${file} — ${data.url}`);
        for (const f of (data.fields || []).filter((f) => f.visible)) {
          console.log([
            `x=${String(f.x).padStart(4)}`,
            `${f.tag}${f.type ? `[${f.type}]` : ''}`,
            `name=${f.name || '-'}`,
            `id=${f.id || '-'}`,
            `label=${(f.label || '-').replace(/\s+/g, ' ').slice(0, 34)}`,
            f.options ? `options=${f.options.slice(0, 6).join('|')}` : '',
            f.value ? `value=${f.value}` : '',
          ].join('  '));
        }
        const buttons = (data.buttons || []).map((b) => (typeof b === 'string' ? b : b.text))
          .filter(Boolean).map((t) => t.replace(/\s+/g, ' ')).slice(0, 25);
        if (buttons.length) console.log(`ปุ่ม: ${buttons.join(' | ')}`);
        console.log('');
      }
      break;
    }

    case 'inspect': {
      await inspectStep(config, args[0] || 'address-details');
      break;
    }

    case 'printers': {
      const printer = createPrinter(config);
      const list = await printer.listPrinters();
      console.log(list.length ? list.join('\n') : 'ไม่พบเครื่องพิมพ์');
      break;
    }

    case 'print': {
      const printer = createPrinter(config);
      console.log(await printer.print(args[0]));
      break;
    }

    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('ผิดพลาด:', err.message);
    process.exit(1);
  });
}
