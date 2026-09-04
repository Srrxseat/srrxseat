# ระบบทำ Shipment DHL อัตโนมัติจาก LINE

รับข้อมูล Shipment ที่พิมพ์เข้ามาใน LINE → สร้าง Shipment บน DHL → สั่งพิมพ์ label
ที่เครื่องพิมพ์ที่ตั้งค่าไว้ (remote printer) → ตอบเลขติดตามกลับไปใน LINE
ทั้งหมดไม่ต้องมีคนกรอกฟอร์มเอง

```
LINE (ห้องแชท/กลุ่ม)
      │  webhook (ตรวจลายเซ็น)
      ▼
src/index.js  ─── parse + validate ───▶  คิวงานในโฟลเดอร์ data/jobs
      │  ตอบรับ/บอกฟิลด์ที่ขาดทันที
      ▼
src/worker.js
      ├── DHL_MODE=api  → MyDHL API                (แนะนำ: เร็ว เสถียร ได้ PDF ตรง ๆ)
      ├── DHL_MODE=web  → กรอกฟอร์ม MyDHL+ ด้วย Playwright (ใช้เมื่อยังไม่มี API)
      ├── PRINT_MODE=cups      → lp -h <CUPS server> -d <คิวพิมพ์>
      ├── PRINT_MODE=printnode → printnode.com (เครื่องพิมพ์อยู่คนละเน็ตเวิร์ก)
      └── push เลขติดตาม + สถานะกลับเข้า LINE
```

## ติดตั้ง

```bash
cd dhl-line
cp .env.example .env      # แล้วกรอกค่าตามหัวข้อ "การตั้งค่า"
npm install               # จำเป็นเฉพาะโหมด web (playwright) — โหมด api ไม่ต้องลงอะไรเลย
npm test                  # ตรวจว่าตัว parser/pipeline ทำงานถูก
```

ต้องใช้ Node.js 20 ขึ้นไป (ใช้ `fetch` และ `process.loadEnvFile` ที่มีมาในตัว)

รัน 2 process:

```bash
npm start     # เซิร์ฟเวอร์รับ webhook จาก LINE (พอร์ต 3000)
npm run worker  # ตัวทำงาน: สร้าง shipment + สั่งพิมพ์
```

แยก 2 process เพราะ LINE ต้องได้ HTTP 200 ภายในไม่กี่วินาที แต่การสร้าง shipment
และสั่งพิมพ์ใช้เวลานานกว่านั้น (โหมด web ใช้เป็นนาที)

## การตั้งค่า (.env)

### 1) LINE
1. สร้าง Provider + Channel แบบ **Messaging API** ที่ https://developers.line.biz/console/
2. คัดลอก **Channel secret** → `LINE_CHANNEL_SECRET`, ออก **Channel access token** → `LINE_CHANNEL_ACCESS_TOKEN`
3. ตั้ง Webhook URL = `https://<โดเมนของคุณ>/webhook/line` แล้วกด Verify + เปิด "Use webhook"
4. ปิด "Auto-reply messages" และ "Greeting messages" ไม่ให้ตอบทับ
5. ถ้าใช้ในกลุ่ม: เชิญ Official Account เข้ากลุ่ม และเปิด "Allow bot to join group chats"
6. อยากจำกัดว่าใครสั่งได้: ใส่ userId/groupId ใน `LINE_ALLOWED_SOURCE_IDS` (ดู id ได้จาก log ของเซิร์ฟเวอร์)

ทดสอบระหว่างพัฒนาโดยเปิด tunnel เช่น `ngrok http 3000` แล้วเอา URL ไปตั้งเป็น Webhook URL

### 2) DHL — เลือกโหมดใดโหมดหนึ่ง

**โหมด `api` (แนะนำ)** — ขอ credential ของ MyDHL API ที่ https://developer.dhl.com/api-reference/dhl-express-mydhl-api
(ขอกับ Account Manager ของ DHL ที่ดูแลบัญชีคุณได้) แล้วกรอก `DHL_API_USERNAME`, `DHL_API_PASSWORD`, `DHL_ACCOUNT_NUMBER`

- `DHL_PRODUCT_CODE`: `P` = Express Worldwide (มีสินค้า/เสียภาษี), `D` = เอกสาร, `N` = ในประเทศ
- `DHL_LABEL_TEMPLATE`: `ECOM26_84_A4_001` สำหรับกระดาษ A4, `ECOM26_84_001` สำหรับ label printer 10x15 ซม.
- `DHL_LABEL_FORMAT=ZPL` ถ้าจะยิงเข้าเครื่อง Zebra ตรง ๆ (ไฟล์ที่ได้จะเป็น .zpl ไม่ใช่ PDF)
- ระบบเลือกวันส่งเป็นวันนี้ ถ้าเลย 15:00 แล้วเลื่อนเป็นวันรุ่งขึ้น และข้ามวันอาทิตย์

**โหมด `web`** — ใช้เมื่อบัญชียังไม่ได้เปิด API: สคริปต์จะ login แล้วกรอกฟอร์มบน MyDHL+ ให้
ต้อง `npm install` (playwright) และ `npx playwright install chromium` ครั้งแรก
ครั้งแรกให้รัน worker ด้วย `DHL_WEB_HEADLESS=false` เพื่อทำ OTP/CAPTCHA เอง
session จะถูกเก็บที่ `data/dhl-web-session.json` ครั้งต่อไปไม่ต้อง login ใหม่

> โหมด web เปราะโดยธรรมชาติ เพราะ DHL เปลี่ยน UI ได้ตลอด ถ้ากรอกไม่ผ่าน
> จะมีภาพหน้าจอตอนล้มอยู่ที่ `data/labels/<jobId>-error.png` และแก้ selector ได้ที่
> ตัวแปร `SEL` ใน `src/dhl/webAutomation.js`

ข้อมูลผู้ส่ง (`SHIPPER_*`) ต้องกรอกให้ครบทั้งสองโหมด

### 3) เครื่องพิมพ์

**`PRINT_MODE=cups`** — เครื่องพิมพ์อยู่ในวง LAN เดียวกับเซิร์ฟเวอร์ หรือเสียบกับเครื่องอื่นที่เปิด CUPS sharing

```bash
node src/cli.js printers          # ดูรายชื่อคิวพิมพ์ที่มองเห็น
node src/cli.js print label.pdf   # ทดสอบพิมพ์
```

- `CUPS_PRINTER` = ชื่อคิว เช่น `DHL_Label`
- `CUPS_HOST` = ใส่เมื่อเครื่องพิมพ์อยู่กับ CUPS server อีกเครื่อง เช่น `192.168.1.50:631`
  (ที่เครื่องนั้นต้อง `cupsctl --share-printers --remote-any` และเปิดพอร์ต 631)
- `CUPS_OPTIONS` = ตัวเลือกของ `lp` เช่น `-o media=A4 -o fit-to-page` หรือ `-o media=Custom.100x150mm` สำหรับ label printer
- ถ้าใช้ label แบบ ZPL ให้ส่งเข้าคิวแบบ raw: `CUPS_OPTIONS=-o raw`

**`PRINT_MODE=printnode`** — เครื่องพิมพ์อยู่คนละเน็ตเวิร์กกับเซิร์ฟเวอร์ (เช่น เซิร์ฟเวอร์อยู่บนคลาวด์
เครื่องพิมพ์อยู่หน้าร้าน): ติดตั้ง PrintNode Client ที่เครื่องหน้าร้าน แล้วใส่ `PRINTNODE_API_KEY`
กับ `PRINTNODE_PRINTER_ID` (ดู id ได้จาก `node src/cli.js printers`)

**`PRINT_MODE=none`** — ไม่พิมพ์ เก็บไฟล์ไว้ที่ `data/labels/` เท่านั้น (ใช้ตอนเทสต์)

## วิธีใช้งานจริง

พิมพ์ในห้อง LINE ตามฟอร์มนี้ (ส่งคำว่า `ช่วยเหลือ` เพื่อให้บอทส่งฟอร์มนี้ให้):

```
ผู้รับ: Taro Yamada
บริษัท: Yamada Auto Parts
ที่อยู่: 1-2-3 Shibuya
Shibuya-ku
เมือง: Tokyo
รัฐ/จังหวัด: Tokyo
รหัสไปรษณีย์: 1500002
ประเทศ: ญี่ปุ่น
โทร: +81 3 1234 5678
อีเมล: taro@example.com
น้ำหนัก: 2.5 kg
ขนาด: 30x20x10 cm
สินค้า: Car seat cover
จำนวน: 2
มูลค่า: 4,500 บาท
อ้างอิง: SO-2026-0912
```

- คีย์รองรับทั้งไทยและอังกฤษ (`ผู้รับ`/`Name`, `น้ำหนัก`/`Weight`, `รหัสไปรษณีย์`/`Zip` ฯลฯ)
- ที่อยู่พิมพ์หลายบรรทัดได้ บรรทัดที่ไม่มีคีย์จะถูกต่อเข้ากับฟิลด์ก่อนหน้า
- หน่วยแปลงให้เอง: `500 g`, `1 lb`, `12x8x4 inch`, `฿1,250.50`
- ถ้าข้อมูลไม่ครบ บอทจะตอบว่าขาดฟิลด์อะไร **และยังไม่สร้าง shipment** (กันค่าใช้จ่ายเสียเปล่า)
- ส่งข้อความเดิมซ้ำ (หรือ LINE ยิง webhook ซ้ำ) จะไม่สร้างงานซ้ำ
- คำสั่งอื่นในแชท: `สถานะ` ดูงาน 5 รายการล่าสุด, `ลองใหม่ <jobId>` สั่งทำงานที่ล้มเหลวอีกครั้ง

### ทดสอบจาก terminal โดยไม่ผ่าน LINE

```bash
node src/cli.js parse examples/shipment-ตัวอย่าง.txt         # ดูผล parse + ฟิลด์ที่ขาด
node src/cli.js submit examples/shipment-ตัวอย่าง.txt --run   # สร้าง shipment + พิมพ์จริง
node src/cli.js jobs                                         # ดูงานทั้งหมด
```

## สถานะงาน

| สถานะ | ความหมาย |
| --- | --- |
| `needs_input` | ข้อมูลไม่ครบ รอผู้ใช้ส่งใหม่ (worker ไม่หยิบไปทำ) |
| `pending` | ข้อมูลครบ รอ worker |
| `processing` | worker กำลังทำ |
| `shipment_created` | ได้เลข AWB + label แล้ว แต่ยังพิมพ์ไม่สำเร็จ |
| `done` | สร้าง shipment และสั่งพิมพ์เรียบร้อย |
| `failed` | ล้มเหลวครบ 3 ครั้ง แจ้งกลับ LINE แล้ว รอสั่ง `ลองใหม่` |

ถ้าสร้าง shipment สำเร็จแต่พิมพ์ไม่ผ่าน การลองใหม่จะ **พิมพ์จากไฟล์เดิม** ไม่สร้าง
shipment ใหม่ (ไม่เสียค่าขนส่งซ้ำ)

ดูภาพรวมจาก HTTP ได้ที่ `GET /health` และ `GET /jobs`

## ทำให้รันค้างไว้ (systemd)

```ini
# /etc/systemd/system/dhl-line-server.service   (อีกไฟล์เปลี่ยน ExecStart เป็น src/worker.js)
[Unit]
Description=DHL LINE automation (webhook server)
After=network.target

[Service]
WorkingDirectory=/opt/dhl-line
ExecStart=/usr/bin/node src/index.js
Restart=always
User=dhl

[Install]
WantedBy=multi-user.target
```

ให้มี worker **ตัวเดียว** เท่านั้น เพราะคิวเป็นไฟล์และไม่มี lock ข้าม process
ถ้าจะรันหลายตัวต้องเปลี่ยน `src/store/jobStore.js` ไปใช้ DB หรือ queue จริงก่อน

## ข้อควรรู้ / ข้อจำกัด

- `.env`, `data/` และไฟล์ label ไม่ถูก commit (มีข้อมูลลูกค้าและ credential)
- ระบบสร้าง shipment ทันทีเมื่อข้อมูลครบ **ไม่มีขั้นให้คนกดยืนยัน** — ถ้าต้องการให้ยืนยันก่อน
  ให้ตั้งสถานะเริ่มต้นใน `src/intake.js` เป็นสถานะรออนุมัติ แล้วปลุกด้วยคำสั่ง `ลองใหม่`
- รองรับ 1 กล่องต่อ 1 shipment ถ้าต้องหลายกล่องต้องแก้ `content.packages` ใน `src/dhl/apiClient.js`
- พิกัดศุลกากร (HS code) ยังไม่ได้ส่ง (`commodityCodes: []`) บางประเทศอาจขอเพิ่ม
- ค่า `DHL_INCOTERM` ใช้ค่าเดียวกันทุกใบ (ค่าเริ่มต้น DAP)
