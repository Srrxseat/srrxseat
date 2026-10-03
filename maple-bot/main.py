"""MapleStory Worlds Classic bot - entry point.

Windows: run as Administrator so the game receives key presses.
macOS:   allow your terminal app in System Settings > Privacy & Security under
         Accessibility, Input Monitoring and Screen Recording.
"""
import threading
import time

from pynput import keyboard

from bot.area import save_area_center
from bot.bot import Bot
from bot.config import append_routine_step, clear_routine, load_config


def wait_for_game(config):
    """Create the bot once the game window can be found, explaining what to
    check instead of crashing while it is closed, minimised or full screen."""
    warned = False
    while True:
        try:
            return Bot(config)
        except RuntimeError:
            if not warned:
                print(f"ยังหาหน้าต่างเกม '{config['window_title']}' ไม่เจอ - รอจนกว่าจะเจอ (Ctrl+C = ออก)")
                print("  - เปิดเกมไว้หรือยัง?")
                print("  - หน้าต่างเกมถูกย่อลง Dock อยู่ไหม? (คลิกที่ Dock เพื่อเปิดกลับมา)")
                print("  - เกมเป็น fullscreen แยกหน้าจอไหม? กดปุ่มเขียวมุมซ้ายบนของเกมให้ออกจาก fullscreen")
                print("    (ใช้แบบหน้าต่างขยายเต็มจอได้: กด Option ค้างแล้วคลิกปุ่มเขียว)")
                warned = True
            time.sleep(2)


def main():
    config = load_config()
    try:
        bot = wait_for_game(config)
    except KeyboardInterrupt:
        return
    print("เจอหน้าต่างเกมแล้ว")
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
        if bot.area_mode():
            save_area_center(pos)
            print(f"[record] ตั้งศูนย์กลางพื้นที่ฟาร์มที่ [{pos[0]:.3f}, {pos[1]:.3f}] "
                  f"รัศมี {config['area']['radius']} - กด F9 เพื่อเริ่ม")
            return
        n = append_routine_step(config["routine"], pos)
        print(f"[record] บันทึกจุดที่ {n}: [{pos[0]:.3f}, {pos[1]:.3f}] ลง {config['routine']}")

    def clear():
        if bot.running:
            print("[clear] กด F9 หยุดบอทก่อน")
            return
        clear_routine(config["routine"])
        bot.atlas.reset()  # new map / new start: rebuild the minimap picture
        print(f"[clear] ลบจุดทั้งหมดใน {config['routine']} แล้ว - เริ่มบันทึกใหม่ด้วย F8")

    actions = {"toggle": bot.toggle, "record": record, "clear": clear}
    last_press = {}

    def on_press(key):
        action = hotkeys.get(key)
        if action == "quit":
            return False  # stops the listener
        # Holding a key repeats it; one press should do one thing.
        now = time.time()
        if action and now - last_press.get(action, 0) < 0.6:
            return
        last_press[action] = now
        if action:
            # Don't block the listener thread (stopping the bot can take a moment).
            threading.Thread(target=actions[action]).start()

    if bot.area_mode():
        print(f"โหมดพื้นที่ (area): {hk['record'].upper()}=ตั้งศูนย์กลางพื้นที่ตรงที่ยืน  "
              f"{hk['toggle'].upper()}=เริ่ม/หยุด  {hk['quit'].upper()}=ออก")
    elif bot.patrol_mode():
        print(f"โหมดเดินวนจุด (patrol): {hk['record'].upper()}=เพิ่มจุดตรงที่ยืน (6-10 จุดทั่วแมพ)  "
              f"{hk['clear'].upper()}=ลบจุดทั้งหมด  {hk['toggle'].upper()}=เริ่ม/หยุด  "
              f"{hk['quit'].upper()}=ออก")
    else:
        print(f"โหมดเดินตามจุด (route): {hk['record'].upper()}=บันทึกจุด  "
              f"{hk['clear'].upper()}=ลบจุดทั้งหมด  {hk['toggle'].upper()}=เริ่ม/หยุด  "
              f"{hk['quit'].upper()}=ออก")
    try:
        with keyboard.Listener(on_press=on_press) as listener:
            listener.join()
    finally:
        bot.stop()


if __name__ == "__main__":
    main()
