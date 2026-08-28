# บอทแจ้งเตือน Telegram

ส่งข้อความ/ไฟล์แจ้งเตือนเข้า Telegram จากสคริปต์หรือจาก command line

## ติดตั้ง

```bash
cd telegram
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

## ตั้งค่า (ทำครั้งเดียว)

1. เปิด Telegram คุยกับ **@BotFather** → พิมพ์ `/newbot` → ตั้งชื่อบอท → จะได้ **token** มา
2. คัดลอก `.env.example` ที่รากโปรเจกต์เป็น `.env` แล้วใส่ token

   ```bash
   cp ../.env.example ../.env
   ```

3. เปิด Telegram ทักบอทที่เพิ่งสร้าง พิมพ์ `/start`
4. หา chat id:

   ```bash
   python bot.py --whoami
   ```

   เอาตัวเลขที่ได้ไปใส่ `TELEGRAM_CHAT_ID` ใน `.env`

> อยากให้แจ้งเตือนเข้ากลุ่ม: เชิญบอทเข้ากลุ่ม พิมพ์อะไรก็ได้ในกลุ่ม แล้วรัน `--whoami` ใหม่
> chat id ของกลุ่มจะเป็นเลขติดลบ (เช่น `-1001234567890`) — ใส่เครื่องหมายลบด้วย

## วิธีใช้

### จาก command line

```bash
python notify.py "อัปเดตข้อมูลธนาคารเสร็จแล้ว ✅"
python notify.py $'<b>เกิดข้อผิดพลาด</b>\nแถวที่ 42 ไม่พบชื่อบัญชี'
echo "ข้อความจาก pipe" | python notify.py
python notify.py --file screenshot.png "ภาพหน้าจอตอนพัง"
python notify.py --silent "แจ้งเตือนแบบเงียบ ไม่เด้งเสียง"
```

### เรียกจาก Python

```python
import sys
sys.path.append("telegram")
from notify import send, send_file

send("เริ่มรันงานอัปเดตธนาคาร…")
send(f"<b>สรุป</b>\nสำเร็จ {ok} รายการ\nล้มเหลว {fail} รายการ")
send_file("error.png", "หน้าจอตอนเกิด error")
```

รองรับ HTML tag: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="...">`
(ถ้าข้อความมี `<` `>` `&` ที่ไม่ใช่ tag ให้ใช้ `--plain` หรือ `parse_mode=None`)

### ต่อกับสคริปต์อัปเดตธนาคารที่มีอยู่

```bash
python ../selenium/update_bank.py && python notify.py "อัปเดตธนาคารเสร็จ ✅" \
  || python notify.py "อัปเดตธนาคารล้มเหลว ❌"
```

## รันบอทค้างไว้ (ไม่จำเป็นสำหรับการแจ้งเตือน)

```bash
python bot.py
```

ตอบคำสั่ง `/start` `/id` `/ping` — มีประโยชน์ตอนอยากเช็ก chat id ของห้องใหม่

> ⚠️ ถ้ารัน `bot.py` ค้างไว้ มันจะดูดข้อความเข้าไปหมด ทำให้ `--whoami` มองไม่เห็น
> ให้หยุด `bot.py` ก่อนแล้วค่อยรัน `--whoami`

## หมายเหตุความปลอดภัย

`.env` อยู่ใน `.gitignore` แล้ว — **อย่า commit token ลง git** ถ้าเผลอหลุดไป
ให้ไปที่ @BotFather → `/revoke` เพื่อออก token ใหม่ทันที
