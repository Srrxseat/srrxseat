/** ข้อความที่ตอบกลับใน LINE */
const { FIELD_ALIASES } = require('../parse/parseShipment');

const TEMPLATE = [
  'ผู้รับ: ',
  'บริษัท: ',
  'ที่อยู่: ',
  'เมือง: ',
  'รัฐ/จังหวัด: ',
  'รหัสไปรษณีย์: ',
  'ประเทศ: ',
  'โทร: ',
  'อีเมล: ',
  'น้ำหนัก: 1 kg',
  'ขนาด: 30x20x15 cm',
  'สินค้า: ',
  'มูลค่า: 1000 บาท',
  'อ้างอิง: ',
].join('\n');

function help() {
  return [
    'วิธีใช้: พิมพ์ข้อมูล Shipment ตามฟอร์มนี้ (คัดลอกไปแก้ได้เลย)',
    '',
    TEMPLATE,
    '',
    'คำสั่งอื่น: "สถานะ" ดูงานล่าสุด, "ช่วยเหลือ" ดูฟอร์มนี้',
  ].join('\n');
}

function needsInput(job) {
  return [
    `รับข้อมูลแล้ว (งาน ${job.jobId}) แต่ยังขาดข้อมูลต่อไปนี้:`,
    ...job.missing.map((m) => `• ${m}`),
    '',
    'ส่งข้อมูลใหม่ทั้งชุดพร้อมฟิลด์ที่ขาดอีกครั้งครับ',
  ].join('\n');
}

function accepted(job) {
  const s = job.shipment;
  const lines = [
    `รับงาน ${job.jobId} แล้ว กำลังสร้าง Shipment บน DHL`,
    `ผู้รับ: ${s.receiverName} (${s.countryCode})`,
    `ที่อยู่: ${[s.addressLine1, s.city, s.state, s.postalCode].filter(Boolean).join(' ')}`,
    `น้ำหนัก: ${s.weightKg} กก. | ขนาด: ${s.dimensions.length}x${s.dimensions.width}x${s.dimensions.height} ซม.`,
  ];
  if (job.warnings.length) lines.push('', 'หมายเหตุ:', ...job.warnings.map((w) => `• ${w}`));
  return lines.join('\n');
}

function done(job) {
  return [
    `เสร็จแล้ว งาน ${job.jobId}`,
    `เลขติดตาม (AWB): ${job.trackingNumber || '-'}`,
    job.printedAt ? `พิมพ์ label แล้วที่ ${job.printerLabel || 'เครื่องพิมพ์ที่ตั้งไว้'}` : 'ยังไม่ได้พิมพ์ (ปิดการพิมพ์ไว้)',
    job.trackingNumber ? `ติดตาม: https://www.dhl.com/th-en/home/tracking.html?tracking-id=${job.trackingNumber}` : '',
  ].filter(Boolean).join('\n');
}

function failed(job) {
  return [
    `งาน ${job.jobId} ไม่สำเร็จ`,
    `สาเหตุ: ${job.error || 'ไม่ทราบสาเหตุ'}`,
    'แก้ข้อมูลแล้วส่งใหม่ หรือสั่ง "ลองใหม่ ' + job.jobId + '" ได้ครับ',
  ].join('\n');
}

function status(jobs) {
  if (!jobs.length) return 'ยังไม่มีงานในระบบ';
  return ['งานล่าสุด:', ...jobs.map((j) => `• ${j.jobId} — ${j.status}${j.trackingNumber ? ` (${j.trackingNumber})` : ''}`)].join('\n');
}

function knownFields() {
  return Object.entries(FIELD_ALIASES).map(([field, aliases]) => `${field}: ${aliases.join(', ')}`).join('\n');
}

module.exports = { help, needsInput, accepted, done, failed, status, knownFields, TEMPLATE };
