"""Draw the farming circles on the minimap (mode: zones).

Usage (from the maple-bot folder, game open on the map):  bash run.sh tools/zones.py
  - Click where a circle's centre should be and drag outwards to size it.
  - u = undo last circle, c = clear all, r = take a new screenshot
  - Enter or s = save (also switches config.yaml to mode: zones), q / Esc = quit
"""
import re
import sys
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot.capture import Capture  # noqa: E402
from bot.config import CONFIG_PATH, load_config  # noqa: E402
from bot.minimap import MinimapAtlas, locate_player  # noqa: E402
from bot.zones import load_zones, save_zones  # noqa: E402

WINDOW = "zones - drag circles, Enter = save, u = undo, q = quit"


def set_mode_zones():
    text = CONFIG_PATH.read_text(encoding="utf-8")
    new, n = re.subn(r"(?m)^mode:.*$", "mode: zones", text)
    if n == 0:
        new = text.rstrip("\n") + "\nmode: zones\n"
    CONFIG_PATH.write_text(new, encoding="utf-8")


def main():
    config = load_config()
    region = config["regions"]["minimap"]
    _, _, mw, mh = region
    if not mw or not mh:
        print("ยังไม่ได้ตั้งกรอบมินิแมพ - รัน bash run.sh tools/calibrate.py ก่อน")
        return
    cap = Capture(config["window_title"])
    atlas = MinimapAtlas()
    zones = load_zones()
    scale = max(1.0, 640 / mw)
    state = {"drag": None}

    def grab():
        frame = cap.frame()
        strip = Capture.crop(frame, region)
        top = atlas.top_of(strip) if config.get("scrolling_minimap", True) else 0
        return strip, top / mh, locate_player(frame, config, atlas)

    strip, top, player = grab()

    def to_frac(x, y):
        return x / scale / mw, y / scale / mh + top

    def to_px(fx, fy):
        return int(fx * mw * scale), int((fy - top) * mh * scale)

    def on_mouse(event, x, y, flags, _):
        if event == cv2.EVENT_LBUTTONDOWN:
            state["drag"] = (x, y, x, y)
        elif event == cv2.EVENT_MOUSEMOVE and state["drag"]:
            state["drag"] = state["drag"][:2] + (x, y)
        elif event == cv2.EVENT_LBUTTONUP and state["drag"]:
            cx, cy, ex, ey = state["drag"][:2] + (x, y)
            state["drag"] = None
            r = ((ex - cx) ** 2 + (ey - cy) ** 2) ** 0.5 / scale / mw
            if r < 0.02:
                print("วงเล็กเกินไป - คลิกตรงกลางแล้วลากออกให้กว้างขึ้น")
                return
            fx, fy = to_frac(cx, cy)
            zones.append({"center": [fx, fy], "radius": r})
            print(f"เพิ่มวงที่ {len(zones)}: กลาง [{fx:.3f}, {fy:.3f}] รัศมี {r:.3f}")

    cv2.namedWindow(WINDOW)
    cv2.setMouseCallback(WINDOW, on_mouse)
    print(__doc__)
    while True:
        img = cv2.resize(strip, None, fx=scale, fy=scale, interpolation=cv2.INTER_NEAREST)
        for i, z in enumerate(zones):
            c = to_px(*z["center"])
            cv2.circle(img, c, int(z["radius"] * mw * scale), (0, 255, 255), 2)
            cv2.putText(img, str(i + 1), (c[0] - 6, c[1] + 6), cv2.FONT_HERSHEY_SIMPLEX,
                        0.7, (0, 255, 255), 2)
        if state["drag"]:
            cx, cy, ex, ey = state["drag"]
            cv2.circle(img, (cx, cy), int(((ex - cx) ** 2 + (ey - cy) ** 2) ** 0.5), (0, 200, 0), 2)
        if player:
            cv2.circle(img, to_px(*player), 6, (255, 0, 255), 2)
        cv2.imshow(WINDOW, img)
        key = cv2.waitKey(30) & 0xFF
        if key in (13, 10, ord("s")):
            save_zones(zones)
            set_mode_zones()
            print(f"บันทึก {len(zones)} วงแล้ว และตั้ง mode: zones ใน config.yaml - "
                  "รัน bash run.sh แล้วกด F9")
            break
        if key in (ord("q"), 27):
            print("ออกโดยไม่บันทึก")
            break
        if key == ord("u") and zones:
            zones.pop()
            print(f"ลบวงล่าสุดแล้ว (เหลือ {len(zones)} วง)")
        elif key == ord("c"):
            zones.clear()
            print("ลบทุกวงแล้ว")
        elif key == ord("r"):
            strip, top, player = grab()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
