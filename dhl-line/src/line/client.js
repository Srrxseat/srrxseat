/** เรียก LINE Messaging API (reply / push) + ตรวจลายเซ็น webhook */
const crypto = require('crypto');

const API = 'https://api.line.me/v2/bot';

/** ตรวจ X-Line-Signature กับ raw body — ต้องใช้ body ดิบ ไม่ใช่ JSON ที่ parse แล้ว */
function verifySignature(rawBody, signature, channelSecret) {
  if (!channelSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

class LineClient {
  constructor({ accessToken }) {
    this.accessToken = accessToken;
  }

  async reply(replyToken, text) {
    if (!replyToken) return null;
    return this._post('/message/reply', { replyToken, messages: toMessages(text) });
  }

  async push(to, text) {
    if (!to) return null;
    return this._post('/message/push', { to, messages: toMessages(text) });
  }

  /** ตอบด้วย reply token ก่อน (ฟรี) ถ้าหมดอายุแล้วค่อย push */
  async replyOrPush({ replyToken, to }, text) {
    try {
      if (replyToken) return await this.reply(replyToken, text);
    } catch (err) {
      if (!to) throw err;
    }
    return this.push(to, text);
  }

  async _post(pathname, body) {
    if (!this.accessToken) {
      console.warn('[line] ไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN — ข้อความที่จะส่ง:\n', body.messages?.[0]?.text);
      return null;
    }
    const res = await fetch(`${API}${pathname}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LINE API ${pathname} ${res.status}: ${await res.text()}`);
    }
    return res.json().catch(() => ({}));
  }
}

function toMessages(text) {
  // LINE จำกัดข้อความละ 5000 ตัวอักษร และไม่เกิน 5 ข้อความต่อครั้ง
  const chunks = String(text).match(/[\s\S]{1,4900}/g) || [''];
  return chunks.slice(0, 5).map((chunk) => ({ type: 'text', text: chunk }));
}

module.exports = { LineClient, verifySignature };
