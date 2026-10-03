"""Check the setup step by step: game window, screen capture, minimap, HP/MP.
Saves what the bot sees to check.png so you can look at it.

Usage (from the maple-bot folder):
    python tools/check.py          check window / capture / minimap / HP / MP
    python tools/check.py keys     also test that key presses reach the game
"""
import sys
import time
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from bot import vision  # noqa: E402
from bot.capture import Capture  # noqa: E402
from bot.config import load_config  # noqa: E402


def main():
    config = load_config()

    try:
        cap = Capture(config["window_title"])
    except Exception as e:
        print(f"✗ หาหน้าต่างเกมไม่เจอ: {e}")
        print("  - เปิดเกมไว้หรือยัง? / ให้สิทธิ์ Screen Recording กับ Terminal หรือยัง?")
        return
    print(f"✓ เจอหน้าต่างเกม ตำแหน่ง {cap.left},{cap.top} ขนาด {cap.width}x{cap.height}")

    frame = cap.frame()
    out = ROOT / "check.png"
    cv2.imwrite(str(out), frame)
    if frame.mean() < 3:
        print(f"✗ ภาพที่จับได้เป็นสีดำ - ยังไม่ได้ให้สิทธิ์ Screen Recording (ดูภาพที่ {out})")
        return
    print(f"✓ จับภาพได้ ขนาด {frame.shape[1]}x{frame.shape[0]} (บันทึกไว้ที่ {out})")

    regions = config["regions"]
    pos = vision.player_position(Capture.crop(frame, regions["minimap"]), config["player_dot_hsv"])
    if pos is None:
        print("✗ หาจุดตัวละครบนมินิแมพไม่เจอ - รัน python tools/calibrate.py ก่อน")
    else:
        print(f"✓ ตำแหน่งตัวละครบนมินิแมพ: x={pos[0]:.3f} y={pos[1]:.3f}")

    for bar in ("hp", "mp"):
        region = regions.get(f"{bar}_bar")
        if not region or region[2] == 0:
            print(f"- ยังไม่ได้ตั้งกรอบหลอด {bar.upper()} (บอทจะไม่กินยา {bar.upper()})")
            continue
        ratio = vision.bar_ratio(Capture.crop(frame, region), config[f"{bar}_bar_hsv"])
        print(f"✓ {bar.upper()} เหลือประมาณ {ratio * 100:.0f}% (เทียบกับตัวเลขในเกมดูว่าใกล้กันไหม)")


def test_keys():
    from bot import controls

    config = load_config()
    print("\nทดสอบปุ่ม: คลิกที่หน้าต่างเกมภายใน 5 วินาที")
    for i in range(5, 0, -1):
        print(f"  {i}...")
        time.sleep(1)
    print("→ เดินขวา 1 วินาที")
    controls.hold("right")
    time.sleep(1)
    controls.release_all()
    print("→ เดินซ้าย 1 วินาที")
    controls.hold("left")
    time.sleep(1)
    controls.release_all()
    print(f"→ กระโดด ({config['keys']['jump']})")
    controls.press(config["keys"]["jump"])
    time.sleep(0.8)
    print(f"→ โจมตี ({config['keys']['attack']})")
    controls.press(config["keys"]["attack"])
    print("ถ้าตัวละครเดินขวา-ซ้าย กระโดด และตี แปลว่าส่งปุ่มได้แล้ว")


if __name__ == "__main__":
    main()
    if "keys" in sys.argv[1:]:
        test_keys()
