#!/bin/bash
# SRRXSEAT Watermark - applies a centered watermark at fixed pixel width, 80% opacity.
# Usage:  apply_watermark.sh <image1> [image2] ...
# Output: writes "<name>_wm.<ext>" next to each input image.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATERMARK="${SRRXSEAT_WATERMARK:-$HOME/.srrxseat/watermark.png}"
OPACITY="${SRRXSEAT_OPACITY:-0.8}"
SUFFIX="${SRRXSEAT_SUFFIX:-_wm}"
# Watermark target width. Accepts:
#   "90%"    -> 90% of the SHORTEST side of the source image (default).
#               Gives an identical pixel-size watermark across landscape /
#               portrait / square crops of the same camera, while staying
#               visually prominent (close to the original "full width" look
#               on portrait and square images).
#   "90%l"   -> 90% of the LONGEST side
#   "90%w"   -> 90% of the source WIDTH
#   "90%h"   -> 90% of the source HEIGHT
#   "1200"   -> fixed 1200px wide
#   "1200px" -> same as above
WIDTH_SPEC="${SRRXSEAT_WIDTH:-90%}"

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

  local dims width height
  dims="$("$MAGICK" identify -format "%w %h" "$input[0]")"
  width="${dims% *}"
  height="${dims#* }"
  if [[ -z "$width" || "$width" -le 0 || -z "$height" || "$height" -le 0 ]]; then
    echo "skip (cannot read dimensions): $input" >&2
    return 0
  fi

  # Pick reference dimension based on suffix in WIDTH_SPEC.
  local target spec="$WIDTH_SPEC" ref
  if [[ "$spec" == *%w ]]; then
    ref=$width
    target=$(( ref * ${spec%\%w} / 100 ))
  elif [[ "$spec" == *%h ]]; then
    ref=$height
    target=$(( ref * ${spec%\%h} / 100 ))
  elif [[ "$spec" == *%l ]]; then
    if (( width > height )); then ref=$width; else ref=$height; fi
    target=$(( ref * ${spec%\%l} / 100 ))
  elif [[ "$spec" == *% ]]; then
    # Percentage of the SHORTEST side - identical pixel watermark size on
    # landscape/portrait/square from the same camera, while staying prominent.
    if (( width < height )); then ref=$width; else ref=$height; fi
    target=$(( ref * ${spec%\%} / 100 ))
  else
    target="${spec%px}"
  fi

  # Safety cap: do not exceed source image width.
  if (( target > width )); then
    target=$width
  fi
  if (( target < 1 )); then
    target=1
  fi

  # Resize watermark to the fixed target width (height auto, keeps aspect ratio),
  # set opacity on alpha channel, then composite centered onto the source.
  "$MAGICK" "$input" \
    \( "$WATERMARK" -resize "${target}x" -alpha set -channel A -evaluate multiply "$OPACITY" +channel \) \
    -gravity center -compose over -composite \
    "$output"

  echo "$output"
}

for f in "$@"; do
  process_one "$f"
done
