#!/bin/bash
# SRRXSEAT Watermark - applies a centered watermark at 80% opacity, scaled to image width.
# Usage:  apply_watermark.sh <image1> [image2] ...
# Output: writes "<name>_wm.<ext>" next to each input image.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATERMARK="${SRRXSEAT_WATERMARK:-$HOME/.srrxseat/watermark.png}"
OPACITY="${SRRXSEAT_OPACITY:-0.8}"
SUFFIX="${SRRXSEAT_SUFFIX:-_wm}"

# Locate ImageMagick (Homebrew on Apple Silicon / Intel / MacPorts / system).
find_magick() {
  for c in \
    /opt/homebrew/bin/magick \
    /usr/local/bin/magick \
    /opt/local/bin/magick \
    "$(command -v magick 2>/dev/null || true)" \
    /opt/homebrew/bin/convert \
    /usr/local/bin/convert \
    "$(command -v convert 2>/dev/null || true)"; do
    if [[ -n "$c" && -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

MAGICK="$(find_magick || true)"
if [[ -z "$MAGICK" ]]; then
  /usr/bin/osascript -e 'display alert "SRRXSEAT Watermark" message "ไม่พบ ImageMagick กรุณาติดตั้งด้วยคำสั่ง:\n\n  brew install imagemagick"'
  exit 1
fi

if [[ ! -f "$WATERMARK" ]]; then
  /usr/bin/osascript -e "display alert \"SRRXSEAT Watermark\" message \"ไม่พบไฟล์ watermark ที่:\n$WATERMARK\n\nกรุณาบันทึก watermark.png ไปยังตำแหน่งดังกล่าวก่อน\""
  exit 1
fi

if [[ "$#" -eq 0 ]]; then
  echo "Usage: $0 <image> [image ...]" >&2
  exit 64
fi

process_one() {
  local input="$1"

  if [[ ! -f "$input" ]]; then
    echo "skip (not a file): $input" >&2
    return 0
  fi

  local dir base name ext output width
  dir="$(dirname "$input")"
  base="$(basename "$input")"
  name="${base%.*}"
  ext="${base##*.}"
  if [[ "$name" == "$ext" ]]; then ext="png"; fi
  output="${dir}/${name}${SUFFIX}.${ext}"

  width="$("$MAGICK" identify -format "%w" "$input[0]")"
  if [[ -z "$width" || "$width" -le 0 ]]; then
    echo "skip (cannot read dimensions): $input" >&2
    return 0
  fi

  # Resize watermark to the image width (height auto, keeps aspect ratio),
  # set 80% opacity on the alpha channel, then composite centered onto the source.
  "$MAGICK" "$input" \
    \( "$WATERMARK" -resize "${width}x" -alpha set -channel A -evaluate multiply "$OPACITY" +channel \) \
    -gravity center -compose over -composite \
    "$output"

  echo "$output"
}

for f in "$@"; do
  process_one "$f"
done
