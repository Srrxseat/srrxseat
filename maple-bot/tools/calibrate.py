"""Select the minimap / HP bar / MP bar regions, pick their colours by clicking,
and preview player detection.

Usage (from the maple-bot folder):  python tools/calibrate.py
"""
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot import vision  # noqa: E402
from bot.capture import Capture  # noqa: E402
from bot.config import load_config, save_block  # noqa: E402

ZOOM = 4


def hsv_range_from_click(img, title):
    """Show `img` enlarged and return an HSV range around the pixel the user
    clicks, or None if they press Esc / c."""
    big = cv2.resize(img, None, fx=ZOOM, fy=ZOOM, interpolation=cv2.INTER_NEAREST)
    clicked = []

    def on_mouse(event, x, y, *_):
        if event == cv2.EVENT_LBUTTONDOWN:
            clicked.append((x // ZOOM, y // ZOOM))

    cv2.imshow(title, big)
    cv2.setMouseCallback(title, on_mouse)
    while not clicked:
        if cv2.waitKey(50) & 0xFF in (27, ord("c")):
            break
    cv2.destroyAllWindows()
    if not clicked:
        return None

    x, y = clicked[0]
    patch = img[max(y - 1, 0):y + 2, max(x - 1, 0):x + 2]
    h, s, v = np.median(cv2.cvtColor(patch, cv2.COLOR_BGR2HSV).reshape(-1, 3), axis=0)
    return {
        # Hue is circular (0-179); a lower hue above the upper one means "wraps".
        "lower": [(h - 8) % 180, max(s - 70, 40), max(v - 70, 40)],
        "upper": [(h + 8) % 180, 255, 255],
    }


def main():
    config = load_config()
    cap = Capture(config["window_title"])
    frame = cap.frame()
    regions = dict(config["regions"])

    for name, label in (("minimap", "Minimap"), ("hp_bar", "HP bar"), ("mp_bar", "MP bar")):
        print(f"ลากกรอบ {label} แล้วกด Enter (กด c เพื่อข้าม)")
        x, y, w, h = cv2.selectROI(f"Select {label}", frame, showCrosshair=False)
        cv2.destroyAllWindows()
        if w and h:
            regions[name] = [int(x), int(y), int(w), int(h)]
    save_block("regions", regions)
    print("บันทึกพื้นที่แล้ว:", regions)

    for region, key, label in (
        ("minimap", "player_dot_hsv", "จุดตัวละครบนมินิแมพ"),
        ("hp_bar", "hp_bar_hsv", "ส่วนที่มีสีของหลอด HP"),
        ("mp_bar", "mp_bar_hsv", "ส่วนที่มีสีของหลอด MP"),
    ):
        if not regions.get(region) or regions[region][2] == 0:
            continue
        print(f"คลิกที่{label} (Esc/c เพื่อข้าม)")
        hsv = hsv_range_from_click(Capture.crop(frame, regions[region]), f"Click: {label}")
        if hsv:
            config[key] = hsv
            save_block(key, hsv)
            print(f"  {key} = {hsv}")

    print("แสดงผลการจับตำแหน่งตัวละคร (กด q เพื่อปิด)")
    while True:
        minimap = Capture.crop(cap.frame(), regions["minimap"]).copy()
        pos = vision.player_position(minimap, config["player_dot_hsv"])
        if pos:
            h, w = minimap.shape[:2]
            cv2.circle(minimap, (int(pos[0] * w), int(pos[1] * h)), 4, (0, 0, 255), 1)
            cv2.putText(minimap, f"{pos[0]:.2f},{pos[1]:.2f}", (2, 12),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
        preview = cv2.resize(minimap, None, fx=3, fy=3, interpolation=cv2.INTER_NEAREST)
        cv2.imshow("Minimap preview", preview)
        if cv2.waitKey(100) & 0xFF == ord("q"):
            break
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
