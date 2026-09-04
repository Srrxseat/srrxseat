/** เลือก adapter เครื่องพิมพ์ตาม PRINT_MODE */
const { CupsPrinter } = require('./cups');
const { PrintNodePrinter } = require('./printnode');

class NoopPrinter {
  get label() { return 'none (ปิดการพิมพ์)'; }
  get available() { return true; }
  async print(filePath) {
    console.log(`[print] PRINT_MODE=none — ข้ามการพิมพ์ ไฟล์อยู่ที่ ${filePath}`);
    return { printer: this.label, jobId: null, output: 'skipped' };
  }
  async listPrinters() { return []; }
}

function createPrinter(config) {
  const mode = config.print.mode;
  if (mode === 'cups') return new CupsPrinter(config);
  if (mode === 'printnode') return new PrintNodePrinter(config);
  if (mode === 'none') return new NoopPrinter();
  throw new Error(`PRINT_MODE ไม่ถูกต้อง: ${mode} (ใช้ได้: cups, printnode, none)`);
}

module.exports = { createPrinter, NoopPrinter };
