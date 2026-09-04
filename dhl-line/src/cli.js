/**
 * เครื่องมือทดสอบจาก terminal (ไม่ต้องมี LINE)
 *
 *   node src/cli.js parse ตัวอย่าง.txt          ดูผลการอ่านข้อความ + ฟิลด์ที่ขาด
 *   node src/cli.js submit ตัวอย่าง.txt --run    ใส่คิวแล้วสั่งทำเลย (สร้าง shipment + พิมพ์)
 *   node src/cli.js jobs                        ดูรายการงาน
 *   node src/cli.js printers                    ดูรายชื่อเครื่องพิมพ์ที่มองเห็น
 *   node src/cli.js print label.pdf             ทดสอบพิมพ์ไฟล์เดียว
 */
const fs = require('fs');

const config = require('./config');
const { parseShipment } = require('./parse/parseShipment');
const { validateShipment } = require('./parse/schema');
const { JobStore } = require('./store/jobStore');
const { createDhlClient } = require('./dhl');
const { createPrinter } = require('./print');
const { intake } = require('./intake');
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
      const { shipment, unknownLines } = parseShipment(readInput(args[0]));
      const result = validateShipment(shipment, { shipperCountryCode: config.shipper.countryCode });
      console.log(JSON.stringify({ ...result, unknownLines }, null, 2));
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
        }, claimed);
        console.log(JSON.stringify(done, null, 2));
      }
      break;
    }

    case 'jobs': {
      for (const j of store.list()) {
        console.log([j.jobId, j.status, j.shipment?.receiverName || '-', j.trackingNumber || '-', j.error || ''].join(' | '));
      }
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
