/** รับข้อความดิบ -> parse -> validate -> สร้างงานในคิว */
const { parseShipment } = require('./parse/parseShipment');
const { validateShipment } = require('./parse/schema');
const { JobStore, STATUS } = require('./store/jobStore');
const messages = require('./line/messages');

const HELP_WORDS = ['ช่วยเหลือ', 'help', 'ฟอร์ม', 'form', 'วิธีใช้', '?'];
const STATUS_WORDS = ['สถานะ', 'status', 'งาน', 'jobs'];
const RETRY_RE = /^(ลองใหม่|retry)\s+(\S+)/i;

/**
 * @returns {{kind: 'help'|'status'|'retry'|'job'|'duplicate', reply: string, job?: object}}
 */
function intake({ store, config, text, sourceId, replyToken, messageId }) {
  const trimmed = String(text || '').trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) return { kind: 'help', reply: messages.help() };
  if (HELP_WORDS.includes(lower)) return { kind: 'help', reply: messages.help() };
  if (STATUS_WORDS.includes(lower)) {
    return { kind: 'status', reply: messages.status(store.list().slice(-5).reverse()) };
  }

  const retry = trimmed.match(RETRY_RE);
  if (retry) {
    const job = store.get(retry[2]);
    if (!job) return { kind: 'status', reply: `ไม่พบงาน ${retry[2]}` };
    const next = job.trackingNumber ? STATUS.SHIPMENT_CREATED : STATUS.PENDING;
    const updated = store.update(job.jobId, { status: next, error: null }, 'สั่งลองใหม่จาก LINE');
    return { kind: 'retry', reply: `จะลองงาน ${updated.jobId} อีกครั้งครับ`, job: updated };
  }

  const key = JobStore.idempotencyKey({ messageId, sourceId, text: trimmed });
  const existing = store.findByKey(key);
  if (existing) {
    return {
      kind: 'duplicate',
      reply: `ข้อความนี้เคยส่งเข้ามาแล้ว (งาน ${existing.jobId} สถานะ ${existing.status}) ไม่สร้างซ้ำครับ`,
      job: existing,
    };
  }

  const { shipment } = parseShipment(trimmed);
  const result = validateShipment(shipment, {
    shipperCountryCode: config.shipper.countryCode,
    defaultCurrency: 'THB',
  });

  // ไม่มีฟิลด์ที่รู้จักเลย = ไม่ใช่ข้อความสั่งงาน ตอบวิธีใช้ไปแทน
  const filled = Object.values(shipment).filter((v) => v !== null && v !== 1).length;
  if (filled === 0) return { kind: 'help', reply: messages.help() };

  const { job } = store.create({
    key,
    sourceId,
    replyToken,
    text: trimmed,
    shipment: result.shipment,
    status: result.ok ? STATUS.PENDING : STATUS.NEEDS_INPUT,
    missing: result.missing,
    warnings: result.warnings,
  });

  return {
    kind: 'job',
    reply: result.ok ? messages.accepted(job) : messages.needsInput(job),
    job,
  };
}

module.exports = { intake };
