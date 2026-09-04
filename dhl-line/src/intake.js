/** รับข้อความจาก LINE -> parse -> สร้าง plan -> ใส่คิวงาน */
const { parseLineShipment } = require('./parse/parseLineShipment');
const { buildShipmentPlan } = require('./plan/buildShipmentPlan');
const { JobStore, STATUS } = require('./store/jobStore');
const messages = require('./line/messages');

const HELP_WORDS = ['ช่วยเหลือ', 'help', 'ฟอร์ม', 'form', 'วิธีใช้', '?'];
const STATUS_WORDS = ['สถานะ', 'status', 'งาน', 'jobs'];
const RETRY_RE = /^(ลองใหม่|retry)\s+(\S+)/i;

/** ข้อความที่หน้าตาเป็นใบงาน: ต้องมีทั้งบรรทัดสินค้า (x2 ...) และ Ship to */
function looksLikeShipment(text) {
  return /^\s*x\s*\d+\s+\S/im.test(text) && /ship\s*to\s*:/i.test(text);
}

/**
 * @returns {{kind: 'help'|'status'|'retry'|'job'|'duplicate'|'ignored', reply: string|null, job?: object}}
 */
function intake({ store, config, text, sourceId, replyToken, messageId }) {
  const trimmed = String(text || '').trim();
  const lower = trimmed.toLowerCase();

  if (!trimmed) return { kind: 'ignored', reply: null };
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

  // ข้อความคุยกันธรรมดาในกลุ่ม — เงียบไว้ ไม่ต้องตอบ ไม่ต้องสร้างงาน
  if (!looksLikeShipment(trimmed)) return { kind: 'ignored', reply: null };

  const key = JobStore.idempotencyKey({ messageId, sourceId, text: trimmed });
  const existing = store.findByKey(key);
  if (existing) {
    return {
      kind: 'duplicate',
      reply: `ใบนี้เคยส่งเข้ามาแล้ว (งาน ${existing.jobId} สถานะ ${existing.status}) ไม่ทำซ้ำครับ`,
      job: existing,
    };
  }

  const parsed = parseLineShipment(trimmed, { boxTareKg: config.boxTareKg });
  const result = buildShipmentPlan(parsed, {
    shipperCountryCode: config.shipper.countryCode,
    customsLineMode: config.customsLineMode,
  });

  const { job } = store.create({
    key,
    sourceId,
    replyToken,
    text: trimmed,
    shipment: result.plan,
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

module.exports = { intake, looksLikeShipment };
