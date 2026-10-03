"""Main bot loop: run the routine, keep buffs up, drink potions."""
import threading
import time

from . import controls, vision
from .capture import Capture
from .config import load_routine
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

    # ---- state -------------------------------------------------------------
    def position(self):
        frame = self.capture.frame()
        minimap = Capture.crop(frame, self.config["regions"]["minimap"])
        return vision.player_position(minimap, self.config["player_dot_hsv"])

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
                print("[bot] HP หมด (ตาย?) - หยุดบอท")
                self.running = False
                return
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

    def start(self):
        if self.running:
            return
        # Reload every start so points just recorded with F8 are picked up.
        self.routine = load_routine(self.config["routine"])
        if not self.routine.get("steps"):
            print("[bot] ยังไม่มีจุดใน routine - ไปยืนตรงจุดที่จะฟาร์มแล้วกด F8 ก่อน")
            return
        self._step = 0
        self.capture.refresh_window()
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        print("[bot] เริ่มทำงาน")

    def stop(self):
        self.running = False
        if self._thread:
            self._thread.join(timeout=3)
        controls.release_all()
        print("[bot] หยุด")

    def _loop(self):
        steps = self.routine["steps"]
        try:
            while self.running:
                self.check_buffs()
                self.check_health()
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
        except Exception as e:  # keep the hotkey thread alive and keys released
            print(f"[bot] error: {e}")
            self.running = False
        finally:
            controls.release_all()
