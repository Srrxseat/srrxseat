"""Main bot loop: farm (area or route mode), keep buffs up, drink potions."""
import threading
import time

from . import controls, vision
from .area import AreaFarmer
from .patrol import PatrolFarmer
from .macro import MacroPlayer, load_macro
from .capture import Capture
from .config import RoutineError, load_routine
from .minimap import MinimapAtlas, locate_player
from .thief import Thief


class Bot:
    def __init__(self, config):
        self.config = config
        self.capture = Capture(config["window_title"])
        self.routine = None
        self.cmd = Thief(self)
        self.running = False
        self._thread = None
        self._last_buff = {}
        self._step = 0
        self._hp_zero = 0
        self.atlas = MinimapAtlas()

    # ---- state -------------------------------------------------------------
    def position(self, frame=None):
        if frame is None:
            frame = self.capture.frame()
        return locate_player(frame, self.config, self.atlas)

    def check_health(self):
        regions = self.config["regions"]
        frame = self.capture.frame()
        for bar, key, threshold in (
            ("hp", "hp_potion", self.config["hp_threshold"]),
            ("mp", "mp_potion", self.config["mp_threshold"]),
        ):
            region = regions.get(f"{bar}_bar")
            if not region or region[2] == 0:
                continue
            ratio = vision.bar_ratio(Capture.crop(frame, region), self.config[f"{bar}_bar_hsv"])
            if bar == "hp" and ratio is not None and ratio < 0.02:
                # A single bad frame (window switching, a flash) can read as 0;
                # only stop when it stays empty.
                self._hp_zero += 1
                if self._hp_zero >= 3:
                    print("[bot] HP หมด (ตาย?) - หยุดบอท")
                    self.running = False
                    return
                continue
            if bar == "hp":
                self._hp_zero = 0
            if ratio is not None and ratio < threshold:
                controls.press(self.config["keys"][key])

    def check_buffs(self):
        now = time.time()
        for buff in self.config.get("buffs", []):
            if not buff.get("interval"):
                continue
            if now - self._last_buff.get(buff["name"], 0) >= buff["interval"]:
                controls.press(buff["key"], delay=0.6)
                self._last_buff[buff["name"]] = now

    # ---- control -----------------------------------------------------------
    def toggle(self):
        if self.running:
            self.stop()
        else:
            self.start()

    def area_mode(self):
        return self.config.get("mode", "route") == "area"

    def patrol_mode(self):
        return self.config.get("mode", "route") == "patrol"

    def replay_mode(self):
        return self.config.get("mode", "route") == "replay"

    def start(self):
        if self.running:
            return
        if self.area_mode():
            target = self._prepare_area()
        elif self.patrol_mode():
            target = self._prepare_patrol()
        elif self.replay_mode():
            target = self._prepare_replay()
        else:
            target = self._prepare_route()
        if target is None:
            return
        self.capture.refresh_window()
        # Fresh debug snapshots for this run only.
        from .area import DEBUG_DIR
        for old in DEBUG_DIR.glob("*.jpg") if DEBUG_DIR.exists() else []:
            old.unlink()
        # The in-game cursor (a white glove) can look like a monster; park the
        # mouse on the window's title bar so it is not drawn over the game.
        cap = self.capture
        controls.move_mouse(cap.left + cap.width // 2, cap.top + 5)
        cap.activate()
        time.sleep(0.5)
        self.running = True
        self._thread = threading.Thread(target=self._run, args=(target,), daemon=True)
        self._thread.start()
        print("[bot] เริ่มทำงาน")

    def _prepare_area(self):
        farmer = AreaFarmer(self)
        if farmer.center is None:
            print("[bot] ยังไม่ได้ตั้งพื้นที่ - ยืนกลางพื้นที่ที่จะฟาร์มแล้วกด F8 ก่อน")
            return None
        print(f"[area] {farmer.describe()}")
        return farmer.tick

    def _prepare_patrol(self):
        try:
            routine = load_routine(self.config["routine"])
            steps = routine["steps"]
        except RoutineError as e:
            print(f"[bot] {e} - กด F7 เพื่อล้างไฟล์ แล้วบันทึกจุดใหม่ด้วย F8")
            return None
        if len(steps) < 2:
            print("[bot] ต้องมีอย่างน้อย 2 จุด - เดินไปรอบแมพแล้วกด F8 ทีละจุด (แนะนำ 6-10 จุด)")
            return None
        points = [s["point"] for s in steps]
        ys = [p[1] for p in points]
        if len(points) > 40:
            print(f"[bot] คำเตือน: มี {len(points)} จุด เยอะผิดปกติ (อาจมีจุดเก่าค้าง) - "
                  "แนะนำกด F7 ลบแล้วบันทึกใหม่ 6-10 จุด")
        if len(points) >= 4 and max(ys) - min(ys) < 0.02:
            print("[bot] คำเตือน: ทุกจุดอยู่ความสูงเดียวกัน บอทจะไม่ขึ้น/ลงชั้น - "
                  "ถ้าตั้งใจให้เดินหลายชั้น กด F7 แล้วบันทึกใหม่ (เวอร์ชันนี้วัดความสูงบนมินิแมพที่เลื่อนได้แล้ว)")
        farmer = PatrolFarmer(self, points, [s.get("path") for s in steps],
                              routine.get("closing_path"))
        print(f"[patrol] {farmer.describe()}")
        return farmer.tick

    def _prepare_replay(self):
        macro = load_macro()
        if macro is None:
            print("[bot] ยังไม่มีการอัดปุ่ม - กด F6 แล้วเล่นตามปกติ แล้วกด F6 อีกครั้งเพื่อหยุดอัด")
            return None
        player = MacroPlayer(self, macro)
        print(f"[replay] {player.describe()}")
        return player.tick

    def _prepare_route(self):
        # Reload every start so points just recorded with F8 are picked up.
        try:
            self.routine = load_routine(self.config["routine"])
        except RoutineError as e:
            print(f"[bot] {e} - กด F7 เพื่อล้างไฟล์ แล้วบันทึกจุดใหม่ด้วย F8")
            return None
        if not self.routine.get("steps"):
            print("[bot] ยังไม่มีจุดใน routine - ไปยืนตรงจุดที่จะฟาร์มแล้วกด F8 ก่อน")
            return None
        self._step = 0
        return self._route_step

    def stop(self):
        self.running = False
        if self._thread:
            self._thread.join(timeout=3)
        controls.release_all()
        print("[bot] หยุด")

    def _run(self, tick):
        last_warn = 0.0
        try:
            while self.running:
                if not self.capture.is_foreground():
                    # Keys would go to another app (e.g. typing zzz into the
                    # Terminal) and that window may cover the HP bar; wait.
                    controls.release_all()
                    if time.time() - last_warn > 5:
                        print("[bot] เกมไม่ได้อยู่หน้าสุด - พักไว้ก่อน (คลิกหน้าต่างเกมเพื่อทำต่อ)")
                        last_warn = time.time()
                    time.sleep(0.3)
                    continue
                self.check_buffs()
                self.check_health()
                if self.running:
                    tick()
        except Exception as e:  # keep the hotkey thread alive and keys released
            print(f"[bot] error: {e}")
            self.running = False
        finally:
            controls.release_all()

    def _route_step(self):
        steps = self.routine["steps"]
        step = steps[self._step]
        if not self.cmd.move_to(step["point"]):
            print(f"[bot] ไปไม่ถึงจุด {self._step} {step['point']} - ข้าม")
        for action in step.get("actions", []):
            if not self.running:
                break
            self.cmd.run_action(action)

        self._step += 1
        if self._step >= len(steps):
            if not self.routine.get("loop", True):
                self.running = False
            self._step = 0
