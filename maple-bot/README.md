# maple-bot — บอท MapleStory Worlds: Classic World (Thief)

โครงบอทเริ่มต้นที่ได้แนวคิดจาก [auto-maple](https://github.com/tanjeffreyz/auto-maple):
อ่านหน้าจอเพื่อหาตำแหน่งตัวละครบนมินิแมพ แล้วเดินตาม routine + กดสกิล/เก็บของ/กินยา/บัฟ

> ⚠️ การใช้บอทผิดเงื่อนไขการใช้งานของ Nexon / MapleStory Worlds และอาจทำให้บัญชีถูกแบน
> โปรเจกต์นี้ทำเพื่อการเรียนรู้ ใช้งานด้วยความเสี่ยงของตัวเอง

## โครงสร้าง

```
main.py              จุดเริ่ม: hotkey F9 เริ่ม/หยุด, F8 บันทึกตำแหน่ง, F10 ออก
config.yaml          ปุ่มในเกม, บัฟ, พื้นที่มินิแมพ/HP/MP, สี, ค่าการเดิน
routines/*.yaml      เส้นทางฟาร์ม (จุดบนมินิแมพ + action ที่ทำ)
bot/capture.py       หาหน้าต่างเกมและจับภาพ (mss)
bot/vision.py        หาจุดตัวละครบนมินิแมพ (สี HSV) และอ่าน % HP/MP
bot/controls.py      ส่งปุ่มด้วย DirectInput (pydirectinput)
bot/thief.py         command book ของ Thief: เดิน/ปีนเชือก/ลงพื้น/โจมตี/เก็บของ
bot/bot.py           ลูปหลัก: routine + บัฟตามเวลา + กินยา
tools/calibrate.py   ลากเลือกพื้นที่มินิแมพ/หลอด HP/MP และดูผลการจับตำแหน่ง
```

## วิธีใช้ (Windows)

1. ติดตั้ง Python 3.10+ แล้ว
   ```
   cd maple-bot
   pip install -r requirements.txt
   ```
2. เปิดเกมแบบ **windowed** แก้ `window_title` ใน `config.yaml` ให้ตรงกับชื่อหน้าต่างเกม
3. แก้ `keys` ให้ตรงกับปุ่มในเกม (โจมตี, กระโดด, เก็บของ, ยา) และ `buffs` (Haste ฯลฯ)
4. รัน `python tools/calibrate.py` (เปิด cmd แบบ **Run as administrator**)
   - ลากกรอบมินิแมพ → Enter, หลอด HP → Enter, หลอด MP → Enter (กด `c` เพื่อข้าม)
   - จะมีหน้าต่างพรีวิวขยายมินิแมพ ถ้าวงแดงตรงจุดเหลืองของตัวละครแปลว่าใช้ได้
   - ถ้าจับไม่ได้ ให้ปรับ `player_dot_hsv` ใน config
5. เขียน routine: ไปยืนตามจุดที่อยากหยุดตีมอน แล้วกด **F8** ในขณะที่ `main.py` รันอยู่
   จะได้พิกัดไปใส่ใน `routines/example.yaml`
6. รัน `python main.py` (administrator) แล้วกด **F9** เพื่อเริ่ม/หยุด, **F10** เพื่อออก

## ขยายต่อ

- อาชีพอื่น: สร้างไฟล์แบบ `bot/thief.py` แล้วเปลี่ยนใน `bot/bot.py`
- การเดินตอนนี้แบบง่าย (เดินซ้าย/ขวา, ปีนขึ้น, กดลง+กระโดดเพื่อลง) ถ้าแมพซับซ้อน
  ให้แบ่งจุดใน routine ให้ถี่ขึ้น หรือเพิ่ม pathfinding แบบ `layout.py` ของ auto-maple
- จับมอนสเตอร์บนจอด้วย template matching เพื่อตีเฉพาะตอนมีมอน
