/**
 * เลขอินวอยซ์แบบรันตามวัน: <พ.ศ.>-<MM>-<DD>-<ลำดับของวัน>
 *   2569-09-04-01 = 4 ก.ย. 2569 ชิปเมนต์ใบแรกของวัน
 *
 * เก็บตัวนับไว้ที่ data/sequence/<YYYY-MM-DD>.json (1 ไฟล์ต่อวัน)
 */
const fs = require('fs');
const path = require('path');

const BUDDHIST_OFFSET = 543;

class InvoiceSequence {
  /**
   * @param {string} dataDir
   * @param {{timezoneOffsetMinutes?: number, pad?: number}} [opts] ดีฟอลต์ +07:00 (เวลาไทย)
   */
  constructor(dataDir, opts = {}) {
    this.dir = path.join(dataDir, 'sequence');
    this.offsetMinutes = opts.timezoneOffsetMinutes ?? 7 * 60;
    this.pad = opts.pad ?? 2;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** วันที่ตามเวลาไทย ณ ขณะนี้ */
  localDate(now = new Date()) {
    const local = new Date(now.getTime() + this.offsetMinutes * 60_000);
    const pad = (n) => String(n).padStart(2, '0');
    return {
      year: local.getUTCFullYear(),
      month: pad(local.getUTCMonth() + 1),
      day: pad(local.getUTCDate()),
      key: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    };
  }

  /** ขอเลขใบถัดไปของวันนี้ (เพิ่มตัวนับทันที) */
  next(now = new Date()) {
    const date = this.localDate(now);
    const file = path.join(this.dir, `${date.key}.json`);
    let counter = 0;
    if (fs.existsSync(file)) {
      try { counter = JSON.parse(fs.readFileSync(file, 'utf8')).counter || 0; } catch { counter = 0; }
    }
    counter += 1;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ date: date.key, counter }, null, 2));
    fs.renameSync(tmp, file);
    return this.format(date, counter);
  }

  /** ดูเลขล่าสุดของวันนี้แบบไม่เพิ่มตัวนับ */
  peek(now = new Date()) {
    const date = this.localDate(now);
    const file = path.join(this.dir, `${date.key}.json`);
    if (!fs.existsSync(file)) return null;
    try {
      const { counter } = JSON.parse(fs.readFileSync(file, 'utf8'));
      return counter ? this.format(date, counter) : null;
    } catch {
      return null;
    }
  }

  format(date, counter) {
    const seq = String(counter).padStart(this.pad, '0');
    return `${date.year + BUDDHIST_OFFSET}-${date.month}-${date.day}-${seq}`;
  }
}

module.exports = { InvoiceSequence, BUDDHIST_OFFSET };
