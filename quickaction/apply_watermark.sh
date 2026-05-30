#!/bin/bash
# SRRXSEAT Watermark v3 - trims watermark padding, centers on image, fixed visual size.
# Usage:  apply_watermark.sh <image1> [image2] ...
# Output: writes "<name>_wm.<ext>" next to each input image.

SRRXSEAT_VERSION="4.0"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATERMARK="${SRRXSEAT_WATERMARK:-$HOME/.srrxseat/watermark.png}"
OPACITY="${SRRXSEAT_OPACITY:-0.99}"
SUFFIX="${SRRXSEAT_SUFFIX:-_wm}"
TRIM="${SRRXSEAT_TRIM:-1}"        # 1 = trim transparent/white padding around watermark
TRIM_FUZZ="${SRRXSEAT_TRIM_FUZZ:-5%}"
# Watermark target width. Default is a FIXED pixel width so the watermark is
# the same absolute size on every output image, regardless of orientation
# (landscape/portrait/square) or source dimensions. Accepts:
#   "1500"   -> fixed 1500px wide (default)
#   "1500px" -> same as above
#   "90%"    -> 90% of the SHORTEST side of the source image
#   "90%l"   -> 90% of the LONGEST side
#   "90%w"   -> 90% of the source WIDTH
#   "90%h"   -> 90% of the source HEIGHT
WIDTH_SPEC="${SRRXSEAT_WIDTH:-1500}"

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

if [[ "$#" -eq 1 && "$1" == "--version" ]]; then
  echo "SRRXSEAT Watermark v${SRRXSEAT_VERSION}"
  echo "  width:    $WIDTH_SPEC"
  echo "  opacity:  $OPACITY"
  echo "  trim:     $TRIM (fuzz $TRIM_FUZZ)"
  echo "  magick:   $MAGICK"
  exit 0
fi

if [[ "$#" -eq 0 ]]; then
  echo "Usage: $0 <image> [image ...]" >&2
  echo "       $0 --version" >&2
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

  # Build watermark pipeline:
  #  1. (optional) -trim cuts off transparent/white padding so the SRRXSEAT
  #     text itself reaches the target width, not the padded canvas.
  #  2. -resize ${target}x sets a fixed pixel width based on WIDTH_SPEC.
  #  3. alpha multiply applies opacity.
  local trim_args=()
  if [[ "$TRIM" == "1" ]]; then
    trim_args=(-bordercolor none -border 1 -fuzz "$TRIM_FUZZ" -trim +repage)
  fi

  "$MAGICK" "$input" \
    \( "$WATERMARK" "${trim_args[@]}" -resize "${target}x" -alpha set -channel A -evaluate multiply "$OPACITY" +channel \) \
    -gravity center -compose over -composite \
    "$output"

  echo "$output  (watermark ${target}px wide on ${width}x${height})"
}

for f in "$@"; do
  process_one "$f"
done
