/**
 * พิมพ์ผ่าน PrintNode (https://www.printnode.com) — เหมาะกับกรณีที่เครื่องพิมพ์
 * อยู่คนละเน็ตเวิร์กกับเซิร์ฟเวอร์ ติดตั้ง PrintNode Client ไว้ที่เครื่องหน้าร้าน
 */
const fs = require('fs');
const path = require('path');

const API = 'https://api.printnode.com';

class PrintNodePrinter {
  constructor(config) {
    this.cfg = config.print.printnode;
    this.copies = config.print.copies;
  }

  get label() {
    return `printnode:${this.cfg.printerId}`;
  }

  get available() {
    return Boolean(this.cfg.apiKey && this.cfg.printerId);
  }

  async print(filePath) {
    if (!this.available) throw new Error('ยังไม่ได้ตั้งค่า PRINTNODE_API_KEY / PRINTNODE_PRINTER_ID');

    const body = {
      printerId: Number(this.cfg.printerId),
      title: `DHL Label ${path.basename(filePath)}`,
      contentType: 'pdf_base64',
      content: fs.readFileSync(filePath).toString('base64'),
      source: 'dhl-line-automation',
      qty: this.copies,
    };

    const res = await fetch(`${API}/printjobs`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.cfg.apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`PrintNode ${res.status}: ${text.slice(0, 300)}`);
    return { printer: this.label, jobId: text.trim(), output: text.trim() };
  }

  async listPrinters() {
    const res = await fetch(`${API}/printers`, {
      headers: { Authorization: `Basic ${Buffer.from(`${this.cfg.apiKey}:`).toString('base64')}` },
    });
    if (!res.ok) throw new Error(`PrintNode ${res.status}: ${await res.text()}`);
    const printers = await res.json();
    return printers.map((p) => `${p.id} — ${p.name} (${p.computer?.name || '-'}) ${p.state}`);
  }
}

module.exports = { PrintNodePrinter };
