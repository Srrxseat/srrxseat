"""MapleStory Worlds Classic bot - entry point.

Windows: run as Administrator so the game receives key presses.
macOS:   allow your terminal app in System Settings > Privacy & Security under
         Accessibility, Input Monitoring and Screen Recording.
"""
import threading

from pynput import keyboard

from bot.bot import Bot
from bot.config import load_config


def main():
    config = load_config()
    bot = Bot(config)
    hk = config["hotkeys"]
    hotkeys = {getattr(keyboard.Key, hk[name]): name for name in ("toggle", "record", "quit")}

    def record():
        pos = bot.position()
        if pos is None:
            print("[record] หาตัวละครบนมินิแมพไม่เจอ - ลองรัน tools/calibrate.py")
        else:
            print(f"[record] - point: [{pos[0]:.3f}, {pos[1]:.3f}]")

    def on_press(key):
        action = hotkeys.get(key)
        if action == "quit":
            return False  # stops the listener
        if action:
            # Don't block the listener thread (stopping the bot can take a moment).
            threading.Thread(target=bot.toggle if action == "toggle" else record).start()

    print(f"พร้อม: {hk['toggle'].upper()}=เริ่ม/หยุด  {hk['record'].upper()}=บันทึกตำแหน่ง  "
          f"{hk['quit'].upper()}=ออก")
    try:
        with keyboard.Listener(on_press=on_press) as listener:
            listener.join()
    finally:
        bot.stop()


if __name__ == "__main__":
    main()
