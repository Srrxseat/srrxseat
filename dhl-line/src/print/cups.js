/**
 * พิมพ์ผ่าน CUPS (คำสั่ง lp) — ใช้ได้ทั้งเครื่องพิมพ์ที่ต่อกับเครื่องนี้
 * และเครื่องพิมพ์ที่อยู่กับ CUPS server อีกเครื่อง (ตั้ง CUPS_HOST=ip:631)
 */
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

class CupsPrinter {
  constructor(config) {
    this.cfg = config.print.cups;
    this.copies = config.print.copies;
  }

  get label() {
    return this.cfg.host ? `${this.cfg.printer}@${this.cfg.host}` : this.cfg.printer;
  }

  get available() {
    return Boolean(this.cfg.printer);
  }

  async print(filePath) {
    if (!this.available) throw new Error('ยังไม่ได้ตั้งค่า CUPS_PRINTER');

    const args = [];
    if (this.cfg.host) args.push('-h', this.cfg.host);
    args.push('-d', this.cfg.printer);
    if (this.copies > 1) args.push('-n', String(this.copies));
    if (this.cfg.options) args.push(...this.cfg.options.split(/\s+/).filter(Boolean));
    args.push(filePath);

    try {
      const { stdout } = await execFileAsync('lp', args, { timeout: 60_000 });
      // ตัวอย่างผลลัพธ์: request id is DHL_Label-42 (1 file(s))
      const m = String(stdout).match(/request id is (\S+)/);
      return { printer: this.label, jobId: m ? m[1] : null, output: String(stdout).trim() };
    } catch (err) {
      const detail = [err.stderr, err.stdout, err.message].filter(Boolean).join(' ').trim();
      throw new Error(`สั่งพิมพ์ผ่าน lp ไม่สำเร็จ (${this.label}): ${detail}`);
    }
  }

  /** ดูรายชื่อคิวพิมพ์ที่มองเห็น ใช้ตอนตั้งค่า */
  async listPrinters() {
    const args = this.cfg.host ? ['-h', this.cfg.host, '-a'] : ['-a'];
    const { stdout } = await execFileAsync('lpstat', args, { timeout: 30_000 });
    return String(stdout).trim().split('\n').filter(Boolean);
  }
}

module.exports = { CupsPrinter };
