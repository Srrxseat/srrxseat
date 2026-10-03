"""Select the minimap / HP bar / MP bar regions and preview player detection.

Usage (from the maple-bot folder):  python tools/calibrate.py
"""
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot import vision  # noqa: E402
from bot.capture import Capture  # noqa: E402
from bot.config import load_config, save_regions  # noqa: E402


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

    save_regions(regions)
    print("บันทึกลง config.yaml แล้ว:", regions)

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
