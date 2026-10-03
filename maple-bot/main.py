"""MapleStory Worlds Classic bot - entry point.

Run as Administrator on Windows (needed for the game to receive key presses).
"""
import time

import keyboard

from bot.bot import Bot
from bot.config import load_config


def main():
    config = load_config()
    bot = Bot(config)
    hk = config["hotkeys"]

    def record():
        pos = bot.position()
        if pos is None:
            print("[record] หาตัวละครบนมินิแมพไม่เจอ - ลองรัน tools/calibrate.py")
        else:
            print(f"[record] - point: [{pos[0]:.3f}, {pos[1]:.3f}]")

    keyboard.add_hotkey(hk["toggle"], bot.toggle)
    keyboard.add_hotkey(hk["record"], record)
    print(f"พร้อม: {hk['toggle'].upper()}=เริ่ม/หยุด  {hk['record'].upper()}=บันทึกตำแหน่ง  "
          f"{hk['quit'].upper()}=ออก")

    try:
        while not keyboard.is_pressed(hk["quit"]):
            time.sleep(0.1)
    finally:
        bot.stop()


if __name__ == "__main__":
    main()
