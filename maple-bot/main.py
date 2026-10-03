"""MapleStory Worlds Classic bot - entry point.

Windows: run as Administrator so the game receives key presses.
macOS:   allow your terminal app in System Settings > Privacy & Security under
         Accessibility, Input Monitoring and Screen Recording.
"""
import threading
import time

from pynput import keyboard

import math

from bot.area import save_area_center
from bot.bot import Bot
from bot.config import (append_routine_step, clear_routine, load_config, load_routine,
                        set_closing_path)
from bot.zones import load_zones, save_zones
from bot.macro import MacroRecorder, key_name, split_events, waypoints_from_samples


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
               for name in ("toggle", "record", "clear", "quit", "macro") if name in hk}
    recorder = MacroRecorder()
    # Patrol: remember the keys pressed between F8 presses so the bot can walk
    # each leg the way you did.
    path_rec = MacroRecorder()
    path_rec.start(None)
    # Where the character was while you walked (sampled 4x a second), used to
    # add in-between points on long legs automatically.
    samples = []

    def sample_positions():
        while True:
            if bot.patrol_mode() and not bot.running:
                try:
                    samples.append((time.time(), bot.position()))
                    del samples[:-2400]  # keep the last ~10 minutes
                except Exception:
                    pass
            time.sleep(0.25)

    threading.Thread(target=sample_positions, daemon=True).start()

    def record():
        if bot.running:
            print("[record] กด F9 หยุดบอทก่อนบันทึกจุด")
            return
        pos = bot.position()
        if pos is None:
            print("[record] หาตัวละครบนมินิแมพไม่เจอ - ลองรัน tools/calibrate.py")
            return
        if bot.zones_mode():
            zones = load_zones()
            r = config.get("zones", {}).get("radius", 0.08)
            zones.append({"center": list(pos), "radius": r})
            save_zones(zones)
            print(f"[record] เพิ่มวงที่ {len(zones)} ที่ [{pos[0]:.3f}, {pos[1]:.3f}] รัศมี {r} "
                  "(ปรับขนาดวงได้ด้วย tools/zones.py) - กด F9 เพื่อเริ่ม")
            return
        if bot.area_mode():
            save_area_center(pos)
            print(f"[record] ตั้งศูนย์กลางพื้นที่ฟาร์มที่ [{pos[0]:.3f}, {pos[1]:.3f}] "
                  f"รัศมี {config['area']['radius']} - กด F9 เพื่อเริ่ม")
            return
        leg_start = path_rec._t0
        keys = path_rec.cut()
        if bot.patrol_mode():
            steps = load_routine(config["routine"])["steps"]
            reach = config["patrol"].get("arrive_reach", 0.035)
            closing = len(steps) >= 3 and math.dist(pos, steps[0]["point"]) <= reach * 1.5
            if steps:
                # Long legs are hard to replay exactly; split them where you
                # stood still on the way, roughly every one or two platforms.
                leg = [(t - leg_start, p) for t, p in samples if t >= leg_start]
                picks = waypoints_from_samples(leg, steps[-1]["point"], pos,
                                               config["patrol"].get("auto_spacing", 0.06))
                pieces = split_events(keys, [t for t, _ in picks])
                for (_, p), piece in zip(picks, pieces):
                    n = append_routine_step(config["routine"], p, keys=piece)
                    print(f"[record]   + จุดย่อย {n}: [{p[0]:.3f}, {p[1]:.3f}] (ระหว่างทาง)")
                keys = pieces[-1]
            if closing:
                set_closing_path(config["routine"], keys)
                n = len(load_routine(config["routine"])["steps"])
                print(f"[record] กลับมาถึงจุดที่ 1 แล้ว - จำเส้นทางกลับไว้ ปิดวงครบ {n} จุด "
                      f"กด {hk['toggle'].upper()} เพื่อเริ่ม")
                return
            if not steps:
                keys = None  # first point: nothing walked yet
        n = append_routine_step(config["routine"], pos, keys=keys)
        walked = f" (จำเส้นทางมา {len(keys)} การกดปุ่ม)" if keys else ""
        print(f"[record] บันทึกจุดที่ {n}: [{pos[0]:.3f}, {pos[1]:.3f}]{walked}")

    def clear():
        if bot.running:
            print("[clear] กด F9 หยุดบอทก่อน")
            return
        if bot.zones_mode():
            save_zones([])
            print("[clear] ลบวงกลมทั้งหมดแล้ว - วาดใหม่ด้วย tools/zones.py หรือยืนแล้วกด F8")
            return
        clear_routine(config["routine"])
        bot.atlas.reset()  # new map / new start: rebuild the minimap picture
        path_rec.start(None)
        print(f"[clear] ลบจุดทั้งหมดใน {config['routine']} แล้ว - เริ่มบันทึกใหม่ด้วย F8")

    def macro():
        if bot.running:
            print("[macro] กด F9 หยุดบอทก่อนอัด")
            return
        if not recorder.recording:
            recorder.start(bot.position())
            print(f"[macro] เริ่มอัดปุ่ม (จุดเริ่ม {recorder.start_pos}) - เล่นตามปกติ แล้วกด "
                  f"{hk['macro'].upper()} อีกครั้งเพื่อหยุด")
        else:
            n, secs = recorder.stop()
            print(f"[macro] บันทึกแล้ว {n} การกดปุ่ม ยาว {secs:.0f} วินาที "
                  f"- ตั้ง mode: replay ใน config.yaml แล้วกด {hk['toggle'].upper()} เพื่อเล่นซ้ำ")

    def toggle():
        bot.toggle()
        path_rec.start(None)  # don't count the bot's own run as a walked path

    actions = {"toggle": toggle, "record": record, "clear": clear, "macro": macro}
    last_press = {}

    def on_press(key):
        action = hotkeys.get(key)
        if action is None and not bot.running:
            recorder.add("down", key_name(key))
            path_rec.add("down", key_name(key))
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
    elif bot.zones_mode():
        print(f"โหมดวงกลม (zones): วาดวงด้วย bash run.sh tools/zones.py หรือ {hk['record'].upper()}=เพิ่มวงตรงที่ยืน  "
              f"{hk['clear'].upper()}=ลบวงทั้งหมด  {hk['toggle'].upper()}=เริ่ม/หยุด  {hk['quit'].upper()}=ออก")
    elif bot.replay_mode():
        print(f"โหมดเล่นซ้ำ (replay): {hk.get('macro', 'f6').upper()}=เริ่ม/หยุดอัดปุ่ม  "
              f"{hk['toggle'].upper()}=เริ่ม/หยุดเล่นซ้ำ  {hk['quit'].upper()}=ออก")
    elif bot.patrol_mode():
        print("  วิธีตั้ง: F7 ลบของเก่า -> เดินไปจุดแรก F8 -> เดินไปจุดถัดไป F8 ... -> เดินกลับจุดแรก F8 (ปิดวง)")
        print("  บอทจะจำทางที่คุณเดินระหว่างจุด แล้วเดินตามแบบเดียวกัน")
        print(f"โหมดเดินวนจุด (patrol): {hk['record'].upper()}=เพิ่มจุดตรงที่ยืน (6-10 จุดทั่วแมพ)  "
              f"{hk['clear'].upper()}=ลบจุดทั้งหมด  {hk['toggle'].upper()}=เริ่ม/หยุด  "
              f"{hk['quit'].upper()}=ออก")
    else:
        print(f"โหมดเดินตามจุด (route): {hk['record'].upper()}=บันทึกจุด  "
              f"{hk['clear'].upper()}=ลบจุดทั้งหมด  {hk['toggle'].upper()}=เริ่ม/หยุด  "
              f"{hk['quit'].upper()}=ออก")

    def on_release(key):
        if hotkeys.get(key) is None and not bot.running:
            recorder.add("up", key_name(key))
            path_rec.add("up", key_name(key))

    if "macro" in hk:
        print(f"{hk['macro'].upper()} = อัดปุ่มที่คุณเล่น (โหมด replay จะเล่นซ้ำ)")
    try:
        with keyboard.Listener(on_press=on_press, on_release=on_release) as listener:
            listener.join()
    finally:
        bot.stop()


if __name__ == "__main__":
    main()
