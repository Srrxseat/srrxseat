/** ข้อความที่บอทตอบกลับในกลุ่ม LINE */

const TEMPLATE = [
  'Item:',
  'x2 FISHNET HEADREST BLACK AVUS [280 USD]',
  'Place, Payment: [EBAY]',
  'Courier: [DHL] / [Commercial]',
  'Shipping cost: [50 USD]',
  'HS Code: 9401.99.90',
  'Export terms: [DAP] / @ผู้ดูแล',
  'Box: 35x25x7 cm / 1 kg',
  '*******',
  'Ship to: Chris Konstantaras',
  '9 Narani Crescent',
  'Earlwood, NSW 2206',
  'Australia',
  '+61 418 219 809',
  'buyer@members.ebay.com',
].join('\n');

function help() {
  return [
    'ส่งใบงานตามฟอร์แมตนี้ในกลุ่ม ระบบจะทำ Shipment บน DHL และสั่งพิมพ์ให้เอง',
    '',
    TEMPLATE,
    '',
    'กติกาที่ระบบใช้:',
    '• Box: <กxยxส> cm / <น้ำหนักของ ไม่รวมกล่อง>',
    '• HS Code ไม่ใส่ก็ได้ ระบบเลือกให้ตามชนิดสินค้า (เบาะ/ที่พักหัว/webbing = 9401.99.90, ผ้า/ชุดหุ้ม = 9401.99.1020)',
    '• เลขอินวอยซ์รันอัตโนมัติตามวัน เช่น 2569-09-04-01',
    '',
    'คำสั่งอื่น: "สถานะ" ดูงานล่าสุด | "ลองใหม่ <รหัสงาน>" สั่งทำซ้ำ',
  ].join('\n');
}

function needsInput(job) {
  return [
    `อ่านใบงานแล้ว (${job.jobId}) แต่ยังขาดข้อมูล:`,
    ...job.missing.map((m) => `• ${m}`),
    '',
    'แก้แล้วส่งใบงานใหม่ทั้งใบอีกครั้งครับ',
  ].join('\n');
}

function accepted(job) {
  const p = job.shipment;
  const r = p.receiver;
  const lines = [
    `รับใบงาน ${job.jobId} — กำลังทำ Shipment บน DHL`,
    `ผู้รับ: ${r.name} (${r.countryCode}) ${[r.city, r.state, r.postalCode].filter(Boolean).join(' ')}`,
    `สินค้า: ${p.source.items.map((i) => `x${i.quantity} ${i.name}`).join(', ')}`,
    `ศุลกากร: ${p.customsLines[0]?.description} | HS ${p.customsLines[0]?.hsCode}`,
    `มูลค่า: สินค้า ${p.goodsValue} ${p.currency}${p.freightCharge ? ` + ค่าขนส่ง ${p.freightCharge.amount} ${p.freightCharge.currency}` : ''} = ${p.totalShipmentValue} ${p.currency}`,
    `กล่อง: ${p.package.packaging} ${p.package.length}x${p.package.width}x${p.package.height} ซม. | ของ ${p.source.netWeightKg} กก. → ชั่งรวมกล่อง ${p.package.weightKg} กก.`,
    `เงื่อนไข: ${p.incoterm} (ภาษีจ่ายโดย${p.dutiesPaidBy === 'shipper' ? 'ผู้ส่ง' : 'ผู้รับ'}) | ประกัน ${p.insurance.enabled ? `${p.insurance.value} ${p.currency}` : 'ไม่ทำ'}`,
  ];
  if (job.warnings?.length) lines.push('', 'หมายเหตุ:', ...job.warnings.map((w) => `• ${w}`));
  return lines.join('\n');
}

function done(job) {
  return [
    `เสร็จแล้ว ${job.jobId}`,
    `Tracking: ${job.trackingNumber || '-'}`,
    job.invoiceNumber ? `Invoice: ${job.invoiceNumber}` : '',
    job.pickupConfirmation ? `เลขนัดรับ: ${job.pickupConfirmation}` : '',
    job.printedAt ? `พิมพ์แล้วที่ ${job.printerLabel || 'เครื่องพิมพ์ที่ตั้งไว้'}` : 'ยังไม่ได้พิมพ์ (ปิดการพิมพ์ไว้)',
    job.trackingNumber ? `ติดตาม: https://www.dhl.com/th-en/home/tracking.html?tracking-id=${job.trackingNumber}` : '',
  ].filter(Boolean).join('\n');
}

function failed(job) {
  return [
    `งาน ${job.jobId} ไม่สำเร็จ`,
    `สาเหตุ: ${job.error || 'ไม่ทราบสาเหตุ'}`,
    job.trackingNumber ? `หมายเหตุ: Shipment ถูกสร้างแล้ว (${job.trackingNumber}) ปัญหาอยู่ที่ขั้นพิมพ์` : '',
    `สั่ง "ลองใหม่ ${job.jobId}" เพื่อทำต่อจากจุดที่ค้าง`,
  ].filter(Boolean).join('\n');
}

function status(jobs) {
  if (!jobs.length) return 'ยังไม่มีงานในระบบ';
  return ['งานล่าสุด:', ...jobs.map((j) => {
    const who = j.shipment?.receiver?.name || '-';
    return `• ${j.jobId} — ${j.status} — ${who}${j.trackingNumber ? ` (${j.trackingNumber})` : ''}`;
  })].join('\n');
}

module.exports = { help, needsInput, accepted, done, failed, status, TEMPLATE };
