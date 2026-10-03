"""MapleStory Worlds Classic bot - entry point.

Windows: run as Administrator so the game receives key presses.
macOS:   allow your terminal app in System Settings > Privacy & Security under
         Accessibility, Input Monitoring and Screen Recording.
"""
import threading

from pynput import keyboard

from bot.bot import Bot
from bot.config import append_routine_step, clear_routine, load_config


def main():
    config = load_config()
    bot = Bot(config)
    hk = config["hotkeys"]
    hotkeys = {getattr(keyboard.Key, hk[name]): name
               for name in ("toggle", "record", "clear", "quit")}

    def record():
        if bot.running:
            print("[record] กด F9 หยุดบอทก่อนบันทึกจุด")
            return
        pos = bot.position()
        if pos is None:
            print("[record] หาตัวละครบนมินิแมพไม่เจอ - ลองรัน tools/calibrate.py")
            return
        n = append_routine_step(config["routine"], pos)
        print(f"[record] บันทึกจุดที่ {n}: [{pos[0]:.3f}, {pos[1]:.3f}] ลง {config['routine']}")

    def clear():
        if bot.running:
            print("[clear] กด F9 หยุดบอทก่อน")
            return
        clear_routine(config["routine"])
        print(f"[clear] ลบจุดทั้งหมดใน {config['routine']} แล้ว - เริ่มบันทึกใหม่ด้วย F8")

    actions = {"toggle": bot.toggle, "record": record, "clear": clear}

    def on_press(key):
        action = hotkeys.get(key)
        if action == "quit":
            return False  # stops the listener
        if action:
            # Don't block the listener thread (stopping the bot can take a moment).
            threading.Thread(target=actions[action]).start()

    print(f"พร้อม: {hk['record'].upper()}=บันทึกจุด  {hk['clear'].upper()}=ลบจุดทั้งหมด  "
          f"{hk['toggle'].upper()}=เริ่ม/หยุด  {hk['quit'].upper()}=ออก")
    try:
        with keyboard.Listener(on_press=on_press) as listener:
            listener.join()
    finally:
        bot.stop()


if __name__ == "__main__":
    main()
