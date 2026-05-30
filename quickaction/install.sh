#!/bin/bash
# SRRXSEAT Watermark Quick Action installer (macOS)
# - Copies the script to ~/.srrxseat/
# - Installs the Quick Action to ~/Library/Services/
# - Optionally installs ImageMagick via Homebrew

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$HOME/.srrxseat"
SERVICES_DIR="$HOME/Library/Services"
WORKFLOW_SRC="$SCRIPT_DIR/SRRXSEAT Watermark.workflow"
WORKFLOW_DST="$SERVICES_DIR/SRRXSEAT Watermark.workflow"

echo "==> Installing SRRXSEAT Watermark Quick Action"

# 1. ImageMagick
if ! command -v magick >/dev/null 2>&1 && ! command -v convert >/dev/null 2>&1; then
  echo "==> ImageMagick not found"
  if command -v brew >/dev/null 2>&1; then
    read -r -p "Install ImageMagick via Homebrew now? [Y/n] " ans
    ans=${ans:-Y}
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      brew install imagemagick
    else
      echo "Please install ImageMagick manually: brew install imagemagick"
      exit 1
    fi
  else
    echo "Homebrew not found. Install Homebrew from https://brew.sh then run:"
    echo "  brew install imagemagick"
    exit 1
  fi
fi

# 2. Script + watermark
mkdir -p "$TARGET_DIR"
cp "$SCRIPT_DIR/apply_watermark.sh" "$TARGET_DIR/apply_watermark.sh"
chmod +x "$TARGET_DIR/apply_watermark.sh"
echo "   installed: $TARGET_DIR/apply_watermark.sh"

if [[ -f "$SCRIPT_DIR/watermark-assets/watermark.png" ]]; then
  cp "$SCRIPT_DIR/watermark-assets/watermark.png" "$TARGET_DIR/watermark.png"
  echo "   installed: $TARGET_DIR/watermark.png"
else
  echo "   NOTE: watermark not found at watermark-assets/watermark.png"
  echo "         Please save your watermark.png to: $TARGET_DIR/watermark.png"
fi

# 3. Quick Action
mkdir -p "$SERVICES_DIR"
if [[ -d "$WORKFLOW_DST" ]]; then
  rm -rf "$WORKFLOW_DST"
fi
cp -R "$WORKFLOW_SRC" "$WORKFLOW_DST"
echo "   installed: $WORKFLOW_DST"

# 4. Refresh services menu (best-effort)
/System/Library/CoreServices/pbs -flush >/dev/null 2>&1 || true

echo
echo "==> Done"
echo
echo "วิธีใช้งาน:"
echo "  1. เปิด Finder -> เลือกไฟล์รูปภาพ (1 ไฟล์หรือมากกว่า)"
echo "  2. คลิกขวา -> Quick Actions (หรือ Services) -> 'SRRXSEAT Watermark'"
echo "  3. ไฟล์ผลลัพธ์ '<ชื่อเดิม>_wm.<ext>' จะปรากฏข้างไฟล์ต้นฉบับ"
echo
echo "ตั้งค่าเพิ่มเติม (ทางเลือก) ผ่าน environment variables:"
echo "  SRRXSEAT_WATERMARK   path to watermark.png  (default: ~/.srrxseat/watermark.png)"
echo "  SRRXSEAT_OPACITY     0.0-1.0                (default: 0.8)"
echo "  SRRXSEAT_SUFFIX      output suffix          (default: _wm)"
