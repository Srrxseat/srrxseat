# SRRXSEAT Watermark — macOS Quick Action

Quick Action สำหรับ macOS ที่ใส่ลายน้ำ SRRXSEAT ลงบนรูปภาพแบบ:

- **ตำแหน่ง:** กึ่งกลางภาพเสมอ (gravity = center)
- **ขนาด:** ขยายให้กว้างเท่าภาพต้นฉบับ คงสัดส่วน watermark
- **Opacity:** 80%
- **รองรับ:** PNG, JPG, HEIC, TIFF และไฟล์ที่ ImageMagick อ่านได้

## โครงสร้างไฟล์

```
quickaction/
├── apply_watermark.sh                       สคริปต์หลักทำ watermark
├── install.sh                               ตัวติดตั้งอัตโนมัติ
├── watermark-assets/
│   └── watermark.png                        วาง watermark ที่นี่ (ผู้ใช้บันทึกเอง)
├── SRRXSEAT Watermark.workflow/             Automator Quick Action bundle
└── README.md
```

## ขั้นตอนติดตั้ง

### 1. เตรียมไฟล์ watermark

บันทึกรูป watermark (SRRXSEAT) ที่จะใช้ ไปไว้ที่:

```
quickaction/watermark-assets/watermark.png
```

หรือไปวางตรงๆ ที่ `~/.srrxseat/watermark.png` ก็ได้

### 2. รันตัวติดตั้ง

```bash
cd quickaction
./install.sh
```

ตัวติดตั้งจะ:

1. ตรวจสอบ/ติดตั้ง ImageMagick ผ่าน Homebrew
2. คัดลอก `apply_watermark.sh` และ `watermark.png` ไปยัง `~/.srrxseat/`
3. ติดตั้ง Quick Action ไปยัง `~/Library/Services/`
4. รีเฟรช Services menu

### 3. ใช้งาน

- เลือกไฟล์รูปภาพใน Finder (เลือกได้หลายไฟล์)
- คลิกขวา → **Quick Actions** → **SRRXSEAT Watermark**
- ไฟล์ผลลัพธ์ชื่อ `<ชื่อเดิม>_wm.<นามสกุล>` จะถูกสร้างข้างไฟล์ต้นฉบับ

## วิธีปรับแต่ง

ปรับค่าผ่าน environment variables ในไฟล์ `~/.srrxseat/apply_watermark.sh` (หรือเซ็ตก่อนเรียก):

| ตัวแปร | ค่าเริ่มต้น | คำอธิบาย |
| --- | --- | --- |
| `SRRXSEAT_WATERMARK` | `~/.srrxseat/watermark.png` | ตำแหน่งไฟล์ watermark |
| `SRRXSEAT_OPACITY` | `0.8` | ความโปร่งใส 0.0–1.0 |
| `SRRXSEAT_SUFFIX` | `_wm` | คำต่อท้ายชื่อไฟล์ผลลัพธ์ |

## ทดสอบจาก command line

```bash
~/.srrxseat/apply_watermark.sh /path/to/image1.jpg /path/to/image2.png
```

## กลไกการทำงาน (ImageMagick)

```
magick INPUT \
  \( WATERMARK -resize {WIDTH}x -alpha set -channel A -evaluate multiply 0.8 +channel \) \
  -gravity center -compose over -composite \
  OUTPUT
```

- `-resize ${WIDTH}x` ขยาย/ย่อ watermark ให้กว้างเท่าภาพต้นฉบับ (สูง auto, คงสัดส่วน)
- `-evaluate multiply 0.8` ปรับ alpha channel เป็น 80%
- `-gravity center -composite` วางกึ่งกลางภาพ ไม่ว่า ratio หรือ resolution จะเป็นเท่าใด

## ทางเลือก: สร้าง Quick Action เองด้วย Automator GUI

ถ้า workflow bundle ที่ให้มาไม่โหลด ให้สร้างเองได้ใน 30 วินาที:

1. เปิดแอป **Automator** → **New Document** → **Quick Action**
2. ตั้งค่า:
   - **Workflow receives current:** `image files`
   - **in:** `Finder`
3. ลาก action **Run Shell Script** เข้ามา
4. ตั้ง **Shell:** `/bin/bash`, **Pass input:** `as arguments`
5. ใส่โค้ดนี้:

   ```bash
   export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
   "$HOME/.srrxseat/apply_watermark.sh" "$@"
   ```

6. **File → Save…** ตั้งชื่อว่า `SRRXSEAT Watermark`

## ถอนการติดตั้ง

```bash
rm -rf ~/.srrxseat
rm -rf "$HOME/Library/Services/SRRXSEAT Watermark.workflow"
/System/Library/CoreServices/pbs -flush
```
