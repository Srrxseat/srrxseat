# maple-bot — บอท MapleStory Worlds: Old School Maple (Thief)

รองรับ **macOS** (แอป MapleStory Worlds ตัว native) และ Windows (Python 3.10+)
ตั้งค่าไว้สำหรับ world **Old School Maple** (pre-Big Bang, มี 4th job)

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
bot/controls.py      ส่งปุ่ม: macOS ใช้ pynput (Quartz), Windows ใช้ pydirectinput
bot/thief.py         command book ของ Thief: เดิน/ปีนเชือก/ลงพื้น/โจมตี/เก็บของ
bot/bot.py           ลูปหลัก: routine + บัฟตามเวลา + กินยา
tools/calibrate.py   ลากเลือกพื้นที่มินิแมพ/หลอด HP/MP และดูผลการจับตำแหน่ง
tools/check.py       ตรวจว่าหาหน้าต่าง/จับภาพ/อ่านค่าได้ไหม (+ `keys` ทดสอบส่งปุ่ม)
```

## วิธีใช้บน macOS

1. ติดตั้ง
   ```
   cd maple-bot
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```
2. **ให้สิทธิ์แอป Terminal** (หรือ iTerm / VS Code ที่ใช้รัน) ใน
   System Settings → Privacy & Security:
   - **Screen Recording** — ไม่งั้นจับภาพได้แต่จอดำ/หาชื่อหน้าต่างไม่เจอ
   - **Accessibility** — ไม่งั้นส่งปุ่มเข้าเกมไม่ได้
   - **Input Monitoring** — ไม่งั้น hotkey F8/F9/F10 ไม่ทำงาน

   ให้สิทธิ์แล้วต้องปิด-เปิด Terminal ใหม่
3. ปุ่ม F: เปิด System Settings → Keyboard → "Use F1, F2, etc. keys as standard
   function keys" หรือกด `fn`+F9 แทน
4. **ระวัง Ctrl+ลูกศร**: macOS ใช้สลับ Desktop (Mission Control)
   ถ้าตั้งโจมตีเป็น ctrl ให้ปิด shortcut นี้ใน Keyboard → Keyboard Shortcuts → Mission Control
   หรือเปลี่ยนปุ่มโจมตีในเกมเป็นปุ่มอื่น
5. เปิดแอป MapleStory Worlds แล้วเข้า Old School Maple (เปิดแบบหน้าต่างหรือขยายเต็มก็ได้ แต่อย่าใช้ fullscreen แบบแยก Space)
   `window_title: "MapleStory Worlds"` ตรงกับชื่อแอปอยู่แล้ว ไม่ต้องแก้
   แก้ `keys` / `buffs` ให้ตรงกับ key config ในเกม ถ้าได้ Flash Jump แล้วตั้ง `movement.flash_jump: true`
6. เข้าแมพที่จะฟาร์มแล้วรัน `python tools/calibrate.py`
   - ลากกรอบมินิแมพ → Enter, หลอด HP → Enter, หลอด MP → Enter (กด `c` เพื่อข้าม)
   - จะมีภาพขยายขึ้นมา **คลิกที่จุดตัวละครบนมินิแมพ** แล้วคลิกที่ส่วนที่มีสีของหลอด HP / MP
     โปรแกรมจะบันทึกสีลง `config.yaml` ให้เอง (UI ของ Old School Maple ไม่ใช่ของเกมจริง จึงต้องเลือกสีเอง)
   - ดูพรีวิวว่าวงแดงตามจุดตัวละครตอนเดินไหม กด `q` เพื่อปิด
6.5 ตรวจระบบ: `python tools/check.py` (ต้องขึ้น ✓ ทุกบรรทัด) แล้ว `python tools/check.py keys`
   แล้วรีบคลิกหน้าต่างเกม — ตัวละครต้องเดินขวา/ซ้าย กระโดด และตี
7. `python main.py` → ยืนตรงจุดที่จะตีมอนแล้วกด **F8** (บันทึกลง `routines/my_route.yaml` ให้เอง)
   เดินไปจุดถัดไปแล้วกด F8 อีก — บันทึกผิดกด **F7** ลบทั้งหมดแล้วเริ่มใหม่
8. คลิกหน้าต่างเกมให้ active แล้วกด **F9** เริ่ม/หยุด, **F10** ออก

> หน้าต่างเกมต้อง active (อยู่หน้าสุด) ตอนบอทกดปุ่ม เพราะปุ่มจะถูกส่งไปที่แอปที่ focus อยู่

## วิธีใช้บน Windows

เหมือนข้างบน แต่ไม่ต้องตั้งสิทธิ์ macOS ให้เปิด cmd แบบ **Run as administrator** แทน

## ขยายต่อ

- อาชีพอื่น: สร้างไฟล์แบบ `bot/thief.py` แล้วเปลี่ยนใน `bot/bot.py`
- การเดินตอนนี้แบบง่าย (เดินซ้าย/ขวา, ปีนขึ้น, กดลง+กระโดดเพื่อลง) ถ้าแมพซับซ้อน
  ให้แบ่งจุดใน routine ให้ถี่ขึ้น หรือเพิ่ม pathfinding แบบ `layout.py` ของ auto-maple
- จับมอนสเตอร์บนจอด้วย template matching เพื่อตีเฉพาะตอนมีมอน
