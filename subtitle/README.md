# แปลซับไทเทิล .srt อังกฤษ → ไทย

สคริปต์ Python ที่แปลไฟล์ซับไทเทิล `.srt` ภาษาอังกฤษเป็นภาษาไทยด้วย Claude API
โดย **รักษา timecode เดิมทุกบรรทัด** และคืน cue ครบเท่าเดิมเสมอ

## ติดตั้ง

```bash
cd subtitle
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # แล้วใส่ ANTHROPIC_API_KEY (ขอที่ https://console.anthropic.com)
```

## ใช้งาน

```bash
# แปลพื้นฐาน -> ได้ไฟล์ movie.en.th.srt
python translate_srt.py movie.en.srt

# ตรวจไฟล์ก่อน (ไม่เรียก API ไม่เสียเงิน)
python translate_srt.py movie.en.srt --dry-run

# ตั้งชื่อไฟล์ผลลัพธ์เอง
python translate_srt.py movie.en.srt -o หนัง_ไทย.srt
```

### ซับสองภาษา

```bash
python translate_srt.py movie.en.srt --mode bilingual            # ไทยบน / อังกฤษล่าง
python translate_srt.py movie.en.srt --mode bilingual-en-first    # อังกฤษบน / ไทยล่าง
```

### เพศของผู้พูด (สรรพนาม + คำลงท้าย)

```bash
python translate_srt.py movie.en.srt --gender female   # ฉัน ... ค่ะ
python translate_srt.py movie.en.srt --gender male     # ผม ... ครับ
python translate_srt.py movie.en.srt --gender neutral  # ฉัน ไม่มีคำลงท้าย (ค่าเริ่มต้น)
```

คำลงท้ายจะใส่เฉพาะตรงที่จบประโยคจริง ๆ ไม่ใส่ทุก cue เพื่อไม่ให้ซับรก

### คุณภาพคำแปล

```bash
# บอกบริบทวิดีโอ ช่วยเรื่องสรรพนามและศัพท์เฉพาะทาง
python translate_srt.py movie.en.srt --context "สอนใช้โปรแกรมบัญชี พูดกับเจ้าของธุรกิจ SME"

# บังคับคำแปลศัพท์เฉพาะให้เหมือนกันทั้งไฟล์
cp glossary.example.txt glossary.txt   # แก้ไขตามงาน
python translate_srt.py movie.en.srt --glossary glossary.txt

# โทนการแปล: casual (ค่าเริ่มต้น) | formal | neutral
python translate_srt.py movie.en.srt --tone formal
```

## ตัวเลือกทั้งหมด

| ตัวเลือก | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `-o, --output` | `<ชื่อไฟล์>.th.srt` | ไฟล์ผลลัพธ์ |
| `--mode` | `thai` | `thai` / `bilingual` / `bilingual-en-first` |
| `--gender` | `neutral` | เพศผู้พูด: `female` (ฉัน/ค่ะ) / `male` (ผม/ครับ) / `neutral` |
| `--tone` | `casual` | `casual` / `formal` / `neutral` |
| `--context` | – | คำอธิบายวิดีโอ |
| `--glossary` | – | ไฟล์ศัพท์เฉพาะ (`english = ไทย` บรรทัดละคู่) |
| `--batch-size` | `40` | จำนวน cue ต่อการเรียก API 1 ครั้ง |
| `--context-cues` | `6` | จำนวน cue ก่อน/หลัง ที่ส่งไปเป็นบริบท |
| `--workers` | `4` | จำนวน batch ที่แปลพร้อมกัน |
| `--max-chars` | `42` | ความยาวสูงสุดต่อบรรทัดโดยประมาณ |
| `--dry-run` | – | ตรวจไฟล์ ไม่เรียก API |

## ทำงานอย่างไร

1. `srt_parse.py` อ่าน `.srt` แบบทนทาน — รับ BOM, CRLF, ตัวคั่นมิลลิวินาทีเป็นจุด,
   บล็อกที่ไม่มีเลขลำดับ, และลำดับเลขที่เพี้ยน (เขียนออกจะนับใหม่ 1..n ให้)
2. แบ่ง cue เป็นชุดละ `--batch-size` แล้วส่งไปแปลพร้อมบทก่อน/หลังอีก `--context-cues` cue
   เป็นบริบท (ส่วนบริบทไม่ถูกแปล) เพื่อให้สรรพนามและคำเรียกต่อเนื่องกันทั้งเรื่อง
3. รับคำแปลกลับเป็น JSON ตาม schema (structured outputs) จับคู่ด้วย id ไม่ใช่ลำดับ
4. ถ้าชุดใดคืนคำแปลไม่ครบ จะแบ่งครึ่งแล้วลองใหม่ (ลึกสุด 3 ชั้น)
   cue ที่ยังแปลไม่ได้จะคงข้อความอังกฤษเดิมไว้ ไม่ทำให้ไฟล์เลื่อน
5. เขียน `.srt` ใหม่ด้วย timecode เดิม (ปรับรูปแบบให้เป็นมาตรฐาน `HH:MM:SS,mmm`)

## ค่าใช้จ่ายโดยประมาณ

ใช้ `claude-opus-5` ($5 / 1M input, $25 / 1M output) หนัง 2 ชั่วโมงราว 1,500 cue
ตกประมาณ 40 ครั้งเรียก API — หลักสิบบาทต่อเรื่อง ถ้าต้องการถูกลงมาก
เปลี่ยน `MODEL` ใน `translate_srt.py` เป็น `claude-sonnet-5` หรือ `claude-haiku-4-5` ได้
