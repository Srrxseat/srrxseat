/** ขั้นตอนหลัก: สร้าง Shipment บน DHL -> เซฟ label -> สั่งพิมพ์ -> แจ้งกลับ LINE */
const fs = require('fs');

const { STATUS } = require('./store/jobStore');
const messages = require('./line/messages');

const MAX_ATTEMPTS = 3;

/**
 * @param {object} deps {store, dhl, printer, line, config}
 * @param {object} job งานที่ claim มาแล้ว (สถานะ processing)
 */
async function processJob(deps, job) {
  const { store, dhl, printer, line } = deps;

  let current = job;
  try {
    // 1) สร้าง shipment (ข้ามถ้ามี label อยู่แล้ว เช่นรอบก่อนพิมพ์ไม่ผ่าน)
    if (!current.labelPath || !fs.existsSync(current.labelPath)) {
      // เลขอินวอยซ์รันตามวัน — ขอเลขตอนจะยิงจริงเท่านั้น งานที่ลองใหม่ใช้เลขเดิม
      const invoiceNumber = current.invoiceNumber || current.shipment.invoiceNumber
        || (deps.invoiceSequence ? deps.invoiceSequence.next() : null);
      if (invoiceNumber && invoiceNumber !== current.invoiceNumber) {
        current = store.update(current.jobId, {
          invoiceNumber,
          shipment: { ...current.shipment, invoiceNumber },
        }, `ออกเลขอินวอยซ์ ${invoiceNumber}`);
      }

      const result = await dhl.createShipment(current.shipment, { jobId: current.jobId });
      const labelPath = store.labelPathFor(current.jobId, result.label.ext || 'pdf');
      fs.writeFileSync(labelPath, result.label.buffer);
      current = store.update(current.jobId, {
        status: STATUS.SHIPMENT_CREATED,
        trackingNumber: result.trackingNumber,
        pickupConfirmation: result.pickupConfirmation || null,
        labelPath,
      }, `สร้าง shipment สำเร็จ AWB ${result.trackingNumber}`);
    } else {
      store.update(current.jobId, {}, 'มี label อยู่แล้ว ข้ามขั้นสร้าง shipment');
    }

    // 2) สั่งพิมพ์
    const printResult = await printer.print(current.labelPath);
    current = store.update(current.jobId, {
      status: STATUS.DONE,
      printedAt: new Date().toISOString(),
      printerLabel: printResult.printer,
      printJobId: printResult.jobId,
    }, `สั่งพิมพ์แล้วที่ ${printResult.printer}`);

    // 3) แจ้งกลับ LINE
    await notify(line, current, messages.done(current));
    return current;
  } catch (err) {
    const attempts = job.attempts || 1;
    const canRetry = attempts < MAX_ATTEMPTS;
    // อ่านสถานะล่าสุดจาก store — ถ้าสร้าง shipment ไปแล้วในรอบนี้ ห้ามสร้างซ้ำตอนลองใหม่
    const latest = store.get(job.jobId) || job;
    const hasLabel = Boolean(latest.labelPath) && fs.existsSync(latest.labelPath);
    const failed = store.update(job.jobId, {
      status: canRetry ? (hasLabel ? STATUS.SHIPMENT_CREATED : STATUS.PENDING) : STATUS.FAILED,
      error: err.message,
    }, `ล้มเหลว: ${err.message}`);

    if (!canRetry) await notify(line, failed, messages.failed(failed));
    else console.warn(`[pipeline] งาน ${job.jobId} ล้มเหลว (ครั้งที่ ${attempts}/${MAX_ATTEMPTS}) จะลองใหม่: ${err.message}`);
    return failed;
  }
}

async function notify(line, job, text) {
  if (!line) return;
  try {
    // reply token ใช้ได้ครั้งเดียวและหมดอายุเร็ว จึง push เข้าห้องเดิมแทน
    await line.push(job.sourceId, text);
  } catch (err) {
    console.warn(`[pipeline] แจ้งกลับ LINE ไม่สำเร็จ: ${err.message}`);
  }
}

module.exports = { processJob, MAX_ATTEMPTS };
