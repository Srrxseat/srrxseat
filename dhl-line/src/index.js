/**
 * เซิร์ฟเวอร์รับ webhook จาก LINE
 *   POST /webhook/line   endpoint ที่ตั้งใน LINE Developers Console
 *   GET  /health         เช็คสถานะ + สรุปจำนวนงานแต่ละสถานะ
 *   GET  /jobs           ดูงานล่าสุด (ตัดข้อมูลข้อความดิบออก)
 *
 * ตัวเซิร์ฟเวอร์แค่รับข้อมูล -> ใส่คิว -> ตอบ LINE ทันที
 * งานจริง (สร้าง shipment + พิมพ์) ทำที่ src/worker.js
 */
const http = require('http');

const config = require('./config');
const { JobStore } = require('./store/jobStore');
const { LineClient, verifySignature } = require('./line/client');
const { intake } = require('./intake');

const store = new JobStore(config.dataDir);
const line = new LineClient({ accessToken: config.line.accessToken });

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, health());
    if (req.method === 'GET' && req.url.startsWith('/jobs')) return json(res, 200, jobsSummary());
    if (req.method === 'POST' && req.url === '/webhook/line') return await handleLineWebhook(req, res);
    return json(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[server] ผิดพลาด:', err);
    return json(res, 500, { error: err.message });
  }
});

async function handleLineWebhook(req, res) {
  const rawBody = await readBody(req);

  if (!verifySignature(rawBody, req.headers['x-line-signature'], config.line.channelSecret)) {
    console.warn('[server] ลายเซ็น LINE ไม่ถูกต้อง — ปฏิเสธ');
    return json(res, 401, { error: 'invalid signature' });
  }

  // ตอบ 200 ให้ LINE ก่อน แล้วค่อยประมวลผล (LINE timeout เร็ว)
  json(res, 200, { ok: true });

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    console.warn('[server] body ไม่ใช่ JSON');
    return;
  }

  for (const event of body.events || []) {
    try {
      await handleEvent(event);
    } catch (err) {
      console.error('[server] จัดการ event ไม่สำเร็จ:', err);
    }
  }
}

async function handleEvent(event) {
  if (event.type !== 'message' || event.message?.type !== 'text') return;

  const sourceId = event.source?.groupId || event.source?.roomId || event.source?.userId || null;
  const allowed = config.line.allowedSourceIds;
  if (allowed.length && !allowed.includes(sourceId)) {
    console.warn(`[server] ข้าม event จาก source ที่ไม่อนุญาต: ${sourceId}`);
    return;
  }

  const result = intake({
    store,
    config,
    text: event.message.text,
    sourceId,
    replyToken: event.replyToken,
    messageId: event.message.id,
  });

  console.log(`[server] ${result.kind}${result.job ? ` งาน ${result.job.jobId} (${result.job.status})` : ''}`);
  await line.replyOrPush({ replyToken: event.replyToken, to: sourceId }, result.reply);
}

function health() {
  const counts = {};
  for (const job of store.list()) counts[job.status] = (counts[job.status] || 0) + 1;
  return {
    ok: true,
    dhlMode: config.dhl.mode,
    printMode: config.print.mode,
    lineConfigured: Boolean(config.line.channelSecret && config.line.accessToken),
    jobs: counts,
  };
}

function jobsSummary() {
  return store.list().slice(-50).reverse().map((j) => ({
    jobId: j.jobId,
    status: j.status,
    receiver: j.shipment?.receiverName || null,
    country: j.shipment?.countryCode || null,
    trackingNumber: j.trackingNumber,
    missing: j.missing,
    error: j.error,
    createdAt: j.createdAt,
  }));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('body ใหญ่เกินไป'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, code, data) {
  if (res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

if (require.main === module) {
  server.listen(config.port, () => {
    console.log(`[server] ฟังอยู่ที่พอร์ต ${config.port} — webhook: POST /webhook/line`);
    if (!config.line.channelSecret) console.warn('[server] ยังไม่ได้ตั้ง LINE_CHANNEL_SECRET — webhook จะถูกปฏิเสธทั้งหมด');
  });
}

module.exports = { server, handleEvent };
