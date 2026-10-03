"""Capture the images area mode looks for: your name tag and the monsters.

Usage (from the maple-bot folder):  bash run.sh tools/templates.py
  1. Drag a tight box around your character's NAME TAG (e.g. "Warriaz") -> Enter
  2. Drag a tight box around ONE monster -> Enter. Repeat for more monsters /
     poses (2-4 is good). Press c (or Esc) when done.
Run it again on a new map to add that map's monsters (old ones are kept;
delete the templates/monsters folder to start over).
"""
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot.area import template_dir  # noqa: E402
from bot.capture import Capture  # noqa: E402
from bot.config import load_config  # noqa: E402


def select(frame, title):
    x, y, w, h = cv2.selectROI(title, frame, showCrosshair=False)
    cv2.destroyAllWindows()
    if not w or not h:
        return None
    return frame[int(y):int(y + h), int(x):int(x + w)].copy()


def tighten_tag(img):
    """Crop a loosely selected name tag down to the tag itself.

    The tag is a dark box with white text; anything around it (platforms,
    background) changes as the character moves and would stop it matching."""
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    dark = (hsv[:, :, 2] < 110) & (hsv[:, :, 1] < 120)
    white = (hsv[:, :, 2] > 190) & (hsv[:, :, 1] < 60)
    mask = ((dark | white) * 255).astype("uint8")
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 3)))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask)
    if n <= 1:
        return img
    best = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_AREA])
    x, y, w, h = stats[best, :4]
    if w < img.shape[1] * 0.3 or h < 4:
        return img  # didn't find a convincing box; keep the user's selection
    return img[y:y + h, x:x + w]


def main():
    config = load_config()
    frame = Capture(config["window_title"]).frame()
    folder = template_dir()

    print("1) ลากกรอบรอบ 'ป้ายชื่อ' ใต้ตัวละคร (ป้ายดำตัวหนังสือขาว ไม่ใช่ชื่อในหน้าต่างปาร์ตี้)")
    print("   ให้พอดีป้าย แล้วกด Enter (c = ข้าม)")
    tag = select(frame, "Name tag")
    if tag is not None:
        cv2.imwrite(str(folder / "player.png"), tighten_tag(tag))
        print("   บันทึก templates/player.png แล้ว")

    mob_dir = folder / "monsters"
    n = len(list(mob_dir.glob("*.png")))
    print("2) ลากกรอบรอบมอน 1 ตัว (ให้พอดีตัว ไม่เอาพื้นหลังเยอะ) แล้วกด Enter")
    print("   ทำซ้ำได้หลายตัว/หลายท่า - เสร็จแล้วกด c")
    while True:
        mob = select(frame, f"Monster #{n + 1} (c = done)")
        if mob is None:
            break
        n += 1
        cv2.imwrite(str(mob_dir / f"mob_{n}.png"), mob)
        print(f"   บันทึก templates/monsters/mob_{n}.png แล้ว")
    print(f"เสร็จแล้ว - มีภาพมอนทั้งหมด {n} ภาพ ลองดูผลด้วย: bash run.sh tools/check.py")


if __name__ == "__main__":
    main()
