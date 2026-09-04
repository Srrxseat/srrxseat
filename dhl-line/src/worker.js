/**
 * Worker: หยิบงานจากคิวมาทำทีละใบ (รันเป็น process แยกจากเซิร์ฟเวอร์ webhook)
 *   node src/worker.js          รันวนไปเรื่อย ๆ
 *   node src/worker.js --once   ทำงานที่ค้างให้หมดแล้วออก
 */
const config = require('./config');
const { JobStore } = require('./store/jobStore');
const { createDhlClient } = require('./dhl');
const { createPrinter } = require('./print');
const { LineClient } = require('./line/client');
const { processJob } = require('./pipeline');

const POLL_MS = Number(process.env.WORKER_POLL_MS || 5000);

async function main() {
  const once = process.argv.includes('--once');
  const store = new JobStore(config.dataDir);
  const deps = {
    store,
    config,
    dhl: createDhlClient(config),
    printer: createPrinter(config),
    line: new LineClient({ accessToken: config.line.accessToken }),
  };

  console.log(`[worker] เริ่มทำงาน — DHL_MODE=${config.dhl.mode}, PRINT_MODE=${config.print.mode}`);
  let running = true;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { console.log(`[worker] ได้รับ ${signal} กำลังปิด...`); running = false; });
  }

  while (running) {
    const job = store.claimNext();
    if (job) {
      console.log(`[worker] ทำงาน ${job.jobId}`);
      const result = await processJob(deps, job);
      console.log(`[worker] งาน ${job.jobId} -> ${result.status}${result.trackingNumber ? ` (${result.trackingNumber})` : ''}`);
      continue;
    }
    if (once) break;
    await sleep(POLL_MS);
  }
  console.log('[worker] จบการทำงาน');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[worker] ผิดพลาด:', err);
    process.exit(1);
  });
}

module.exports = { main };
