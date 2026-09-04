# ระบบทำ Shipment DHL อัตโนมัติจากใบงานใน LINE

รับใบงานที่พิมพ์เข้ามาในกลุ่ม LINE → กรอกฟอร์มทำ Shipment บน MyDHL+ ครบทั้ง 7 ขั้น
→ สั่งพิมพ์ label ที่เครื่องพิมพ์ที่ตั้งไว้ → ตอบเลข Tracking + เลขนัดรับกลับเข้ากลุ่ม
ทั้งหมดไม่ต้องมีคนกรอกฟอร์มเอง (flow เดียวกับที่ทำมืออยู่ทุกวัน)

```
กลุ่ม LINE  ──webhook──▶  src/index.js
                            │ parse ใบงาน + สร้าง "plan" (ค่าที่จะกรอกทุกช่อง)
                            │ ไม่ครบ → ตอบว่าขาดอะไร แล้วหยุด (ไม่เสียเงินเปล่า)
                            ▼
                       คิวงาน data/jobs
                            │
                            ▼
                       src/worker.js
                            ├── ออกเลขอินวอยซ์รันตามวัน  2569-09-04-01
                            ├── DHL_MODE=web → กรอก MyDHL+ 7 ขั้นด้วย Playwright
                            ├── DHL_MODE=api → MyDHL API (ถ้าเปิดใช้ API แล้ว)
                            ├── PRINT_MODE=cups / printnode → พิมพ์ label
                            └── push Tracking + เลขนัดรับกลับเข้ากลุ่ม LINE
```

## ฟอร์แมตใบงานใน LINE

```
Item:
x2 FISHNET HEADREST BLACK AVUS [280 USD]
Place, Payment: [EBAY]
Courier: [DHL] / [Commercial]
Shipping cost: [50 USD]
HS Code: 9401.99.90
Export terms: [DAP] / @nut
Box: 35x25x7 cm / 1 kg
*******
Ship to: Chris Konstantaras
9 Narani Crescent
Earlwood
Earlwood, NSW 2206
Australia
+61 418 219 809
0122fa03cddd447bc8c9@members.ebay.com
```

กติกาที่ระบบใช้ตีความ:

| บรรทัดใน LINE | ไปลงที่ไหนบน DHL |
| --- | --- |
| `x<จำนวน> <ชื่อสินค้า> [<ราคา> USD]` | รายการศุลกากร (1 บรรทัด = 1 Boxes, มูลค่า = ราคารวมของรายการนั้น) |
| `Courier: [DHL] / [Commercial]` | ลักษณะการจัดส่ง = Commercial |
| `Shipping cost: [50 USD]` | ค่าใช้จ่ายเพิ่มในหน้ามูลค่าชิปเมนต์ (280 + 50 = 330 USD) |
| `HS Code: ...` | รหัสสินค้าโภคภัณฑ์ — ไม่ใส่ก็ได้ ระบบเลือกตามชนิดสินค้าให้ |
| `Export terms: [DAP]` | DAP/อื่น ๆ = ภาษีจ่ายโดยผู้รับ, DDP = ผู้ส่งจ่าย |
| `Box: 35x25x7 cm / 1 kg` | ขนาดกล่อง + **น้ำหนักของ ไม่รวมกล่อง** (ใช้ในบรรทัดศุลกากร) |
| — | น้ำหนักที่กรอกในขั้นบรรจุภัณฑ์ = น้ำหนักของ + `BOX_TARE_KG` (1+1 = 2 กก.) |
| `Ship to:` + บรรทัดถัดไป | ที่อยู่ผู้รับ (เมือง/รัฐ/ไปรษณีย์/ประเทศ/เบอร์/อีเมล แยกให้เอง) |

- ประกันสินค้า: ติ๊กให้อัตโนมัติ มูลค่า = มูลค่าสินค้า (ไม่รวมค่าขนส่ง)
- บริการเสริม: GoGreen Plus + Direct Signature ติ๊กให้ทุกใบ
- นัดรับ: "ใช่" + Loading Dock + น้ำหนักรวม
- บริการขนส่ง: EXPRESS WORLDWIDE (ถ้าไม่เจอ จะเลือกตัวที่ถูกที่สุดในหน้านั้น)
- ช่องบริษัทของผู้รับ: ใส่ `-` เมื่อไม่มีชื่อบริษัท (เหมือนที่ทำมือ)
- อยากกำหนดน้ำหนักเองก็เพิ่มบรรทัด `Net: 1.5 kg` / `Gross: 2 kg` / `Invoice: 2569-09-04-05` ได้

### เลขอินวอยซ์
รันตามวันแบบ พ.ศ.: `2569-09-04-01` = 4 ก.ย. 2569 ใบแรกของวัน ตัวนับเก็บที่
`data/sequence/<YYYY-MM-DD>.json` และจะขอเลขตอนกำลังยิงเข้า DHL จริงเท่านั้น
(งานที่ล้มแล้วสั่งลองใหม่จะใช้เลขเดิม ไม่กินเลขซ้ำ)

### ตารางสินค้า → ศุลกากร (`config/products.json`)
| หมวด | HS Code | บรรจุภัณฑ์ที่เลือก |
| --- | --- | --- |
| ที่พักหัว (headrest) | 9401.99.90 | HEADREST |
| เบาะ (LX/LS, SR, seat) | 9401.99.90 | LX, LS seats / SR seats |
| webbing mat | 9401.99.90 | WEBBING MAT |
| อุปกรณ์เสริมรถ | 9401.99.90 | SEAT COVERS |
| ผ้า / upholstery kits / seat covers | 9401.99.1020 | UPHOLSTERY KITS |

คำอธิบายสินค้าที่พิมพ์ลงใบขนก็อยู่ในไฟล์นี้ (เช่น headrest ใช้
`REPLACEMENT SEAT HEADREST (NON-LEATHER) / SYNTHETIC FOAM / NON-WOVEN FABRIC`)
**ควรแก้ข้อความของหมวดอื่นให้ตรงกับที่ใช้จริงก่อนเปิดใช้งานเต็มรูปแบบ**

## ติดตั้ง

```bash
cd dhl-line
cp .env.example .env        # กรอกค่าตามหัวข้อ "การตั้งค่า"
npm install                 # playwright (จำเป็นสำหรับ DHL_MODE=web)
npx playwright install chromium
npm test                    # 30 เทสต์ ตรวจ parser/plan/คิวงาน/เลขอินวอยซ์
```

ต้องใช้ Node.js 20 ขึ้นไป รัน 2 process:

```bash
npm start        # เซิร์ฟเวอร์รับ webhook จาก LINE (พอร์ต 3000)
npm run worker   # ตัวทำงาน: กรอกฟอร์ม DHL + สั่งพิมพ์
```

แยกกันเพราะ LINE ต้องได้ HTTP 200 ในไม่กี่วินาที แต่การกรอกฟอร์ม MyDHL+ ใช้เวลาเป็นนาที

## การตั้งค่า (.env)

### 1) LINE
1. สร้าง Channel แบบ **Messaging API** ที่ https://developers.line.biz/console/
2. `LINE_CHANNEL_SECRET` + `LINE_CHANNEL_ACCESS_TOKEN`
3. Webhook URL = `https://<โดเมน>/webhook/line` → Verify + เปิด Use webhook
4. ปิด Auto-reply / Greeting message
5. เชิญ Official Account เข้ากลุ่ม และเปิด "Allow bot to join group chats"
6. `LINE_ALLOWED_SOURCE_IDS` = groupId ของกลุ่มที่อนุญาต (ดู id ได้จาก log)

ข้อความในกลุ่มที่ไม่ใช่ใบงาน (ไม่มีทั้งบรรทัด `x2 ...` และ `Ship to:`) ระบบจะเงียบ ไม่ตอบ

### 2) DHL
**`DHL_MODE=web` (ค่าเริ่มต้น — flow เดียวกับที่ทำมือ)**
- `DHL_WEB_USERNAME` / `DHL_WEB_PASSWORD` = บัญชี MyDHL+
- ครั้งแรกให้รัน worker ด้วย `DHL_WEB_HEADLESS=false` เพื่อทำ OTP เอง
  session เก็บที่ `data/dhl-web-session.json` ครั้งต่อไปไม่ต้อง login
- ทุกขั้นเซฟภาพหน้าจอไว้ที่ `data/steps/<jobId>/01-login.png … 09-complete.png`
  ถ้ากรอกไม่ผ่านจะมี `error.png` ให้ดูว่าค้างที่ช่องไหน
- selector ทั้งหมดรวมไว้ที่ตัวแปร `SEL` ใน `src/dhl/mydhlFlow.js` (DHL เปลี่ยน UI = แก้ที่นี่)

**`DHL_MODE=api`** — ถ้าขอ MyDHL API ได้แล้วจะเสถียรกว่ามาก ใส่
`DHL_API_USERNAME` / `DHL_API_PASSWORD` / `DHL_ACCOUNT_NUMBER` แล้วสลับโหมด
โดยข้อมูลใบงานและกติกาทั้งหมดใช้ร่วมกัน (plan เดียวกัน)

ข้อมูลผู้ส่ง `SHIPPER_*` ต้องกรอกให้ครบทั้งสองโหมด

### 3) เครื่องพิมพ์
- `PRINT_MODE=cups` + `CUPS_PRINTER` (+ `CUPS_HOST=192.168.1.50:631` ถ้าอยู่เครื่องอื่น)
- `PRINT_MODE=printnode` + `PRINTNODE_API_KEY` / `PRINTNODE_PRINTER_ID` (คนละเน็ตเวิร์ก)
- `PRINT_MODE=none` เก็บไฟล์ไว้ที่ `data/labels/` เฉย ๆ (ใช้ตอนเทสต์)

```bash
node src/cli.js printers          # ดูคิวพิมพ์ที่มองเห็น
node src/cli.js print label.pdf   # ทดสอบพิมพ์
```

## ทดสอบจาก terminal (ไม่ต้องผ่าน LINE)

```bash
node src/cli.js parse examples/ใบงาน-ตัวอย่าง.txt   # ผลการอ่านใบงาน
node src/cli.js plan  examples/ใบงาน-ตัวอย่าง.txt   # ค่าที่จะกรอกลง DHL ทุกช่อง + ฟิลด์ที่ขาด
node src/cli.js submit examples/ใบงาน-ตัวอย่าง.txt --run   # ทำจริง (สร้าง shipment + พิมพ์)
node src/cli.js jobs
```

แนะนำให้เริ่มด้วย `plan` ก่อนทุกครั้งที่แก้ `config/products.json` — จะเห็นทุกค่าที่จะถูกกรอก
โดยไม่ต้องแตะเว็บ DHL

## สถานะงาน

| สถานะ | ความหมาย |
| --- | --- |
| `needs_input` | ใบงานไม่ครบ รอส่งใหม่ (worker ไม่หยิบไปทำ) |
| `pending` | ครบแล้ว รอ worker |
| `processing` | กำลังกรอกฟอร์ม DHL |
| `shipment_created` | ได้ Tracking + label แล้ว แต่พิมพ์ไม่สำเร็จ |
| `done` | เรียบร้อย |
| `failed` | ล้มเหลวครบ 3 ครั้ง แจ้งกลับ LINE แล้ว รอสั่ง `ลองใหม่ <รหัสงาน>` |

ถ้าสร้าง Shipment สำเร็จแต่พิมพ์ไม่ผ่าน การลองใหม่จะพิมพ์จาก label เดิม
ไม่สร้าง Shipment ใหม่ (ไม่เสียค่าขนส่งซ้ำ ไม่กินเลขอินวอยซ์เพิ่ม)

ดูภาพรวมได้ที่ `GET /health` และ `GET /jobs`

## ทำให้รันค้างไว้ (systemd)

```ini
# /etc/systemd/system/dhl-line-server.service  (อีกไฟล์เปลี่ยนเป็น src/worker.js)
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

ให้มี worker **ตัวเดียว** เพราะคิวเป็นไฟล์และไม่มี lock ข้าม process

## ข้อจำกัด / สิ่งที่ควรรู้

- `.env`, `data/` (รวม label กับภาพหน้าจอ) ไม่ถูก commit — มีข้อมูลลูกค้าและ credential
- ระบบยิงเข้า DHL ทันทีที่ใบงานครบ **ไม่มีขั้นให้คนกดยืนยัน** ถ้าอยากให้ยืนยันก่อน
  เปลี่ยนสถานะเริ่มต้นใน `src/intake.js` เป็น `needs_input` แล้วปลุกด้วย `ลองใหม่ <รหัสงาน>`
- รองรับ 1 กล่องต่อ 1 ชิปเมนต์ (ตามที่ทำอยู่) หลายกล่องต้องแก้ `plan.package`
- คำอธิบายศุลกากรของหมวดที่ยังไม่ยืนยัน (ผ้า/ชุดหุ้ม/เบาะ/webbing) เป็นข้อความที่ผมร่างไว้
  ให้แก้ใน `config/products.json` ให้ตรงกับที่ใช้จริง
- น้ำหนักในบรรทัดศุลกากรใช้น้ำหนักของจาก LINE (ไม่รวมกล่อง) เกลี่ยตามจำนวนรายการ
  ถ้าต้องการเป๊ะให้ระบุ `Net:` ในใบงาน
- selector ของ MyDHL+ เป็น best-effort ครั้งแรกที่ใช้งานจริงควรรัน
  `DHL_WEB_HEADLESS=false` แล้วดูภาพในโฟลเดอร์ `data/steps/` เพื่อจับ selector ที่เพี้ยน
