/**
 * คิวงานแบบไฟล์ (ไม่ต้องติดตั้ง DB)
 *   data/jobs/<jobId>.json   ข้อมูลงานแต่ละใบ
 *   data/index/<key>.json    ตารางกันงานซ้ำ (idempotency)
 *   data/labels/<jobId>.pdf  ไฟล์ label ที่ได้จาก DHL
 *
 * ออกแบบให้มี worker เพียงตัวเดียวหยิบงาน (ไม่มี lock ข้าม process)
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STATUS = {
  PENDING: 'pending',
  NEEDS_INPUT: 'needs_input',
  PROCESSING: 'processing',
  SHIPMENT_CREATED: 'shipment_created',
  DONE: 'done',
  FAILED: 'failed',
};

class JobStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.jobsDir = path.join(dataDir, 'jobs');
    this.indexDir = path.join(dataDir, 'index');
    this.labelsDir = path.join(dataDir, 'labels');
    for (const dir of [this.jobsDir, this.indexDir, this.labelsDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /** คีย์กันซ้ำ: message id จาก LINE ถ้ามี ไม่มีก็ hash ของเนื้อหา + ผู้ส่ง */
  static idempotencyKey({ messageId, sourceId, text }) {
    if (messageId) return `msg-${messageId}`;
    const hash = crypto.createHash('sha256').update(`${sourceId || ''}|${text || ''}`).digest('hex');
    return `txt-${hash.slice(0, 32)}`;
  }

  findByKey(key) {
    const indexFile = path.join(this.indexDir, `${safe(key)}.json`);
    if (!fs.existsSync(indexFile)) return null;
    const { jobId } = readJson(indexFile);
    return jobId ? this.get(jobId) : null;
  }

  create({ key, sourceId, replyToken, text, shipment, status, missing = [], warnings = [] }) {
    const existing = key ? this.findByKey(key) : null;
    if (existing) return { job: existing, created: false };

    const jobId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
    const job = {
      jobId,
      key: key || null,
      status: status || STATUS.PENDING,
      sourceId: sourceId || null,
      replyToken: replyToken || null,
      text: text || '',
      shipment: shipment || null,
      missing,
      warnings,
      attempts: 0,
      trackingNumber: null,
      labelPath: null,
      printedAt: null,
      error: null,
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._write(job);
    if (key) writeJson(path.join(this.indexDir, `${safe(key)}.json`), { jobId });
    return { job, created: true };
  }

  get(jobId) {
    const file = path.join(this.jobsDir, `${safe(jobId)}.json`);
    return fs.existsSync(file) ? readJson(file) : null;
  }

  update(jobId, patch, historyNote) {
    const job = this.get(jobId);
    if (!job) throw new Error(`ไม่พบงาน ${jobId}`);
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    if (historyNote) job.history.push({ at: job.updatedAt, note: historyNote });
    this._write(job);
    return job;
  }

  list(filter = {}) {
    const jobs = fs.readdirSync(this.jobsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(this.jobsDir, f)))
      .filter(Boolean)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    if (!filter.status) return jobs;
    const wanted = Array.isArray(filter.status) ? filter.status : [filter.status];
    return jobs.filter((j) => wanted.includes(j.status));
  }

  /** งานที่ worker ต้องทำต่อ (เรียงตามเวลาสร้าง) */
  claimNext() {
    const job = this.list({ status: [STATUS.PENDING, STATUS.SHIPMENT_CREATED] })[0];
    if (!job) return null;
    return this.update(job.jobId, { status: STATUS.PROCESSING, attempts: job.attempts + 1, error: null },
      `เริ่มทำงาน (ครั้งที่ ${job.attempts + 1}) จากสถานะ ${job.status}`);
  }

  labelPathFor(jobId, ext = 'pdf') {
    return path.join(this.labelsDir, `${safe(jobId)}.${ext}`);
  }

  _write(job) {
    writeJson(path.join(this.jobsDir, `${safe(job.jobId)}.json`), job);
  }
}

function safe(name) {
  return String(name).replace(/[^A-Za-z0-9._-]/g, '_');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { JobStore, STATUS };
