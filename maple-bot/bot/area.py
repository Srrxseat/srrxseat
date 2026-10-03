"""Area farming: stay inside a circle on the minimap and attack nearby monsters.

Each tick:
  1. If knocked back outside the circle, walk back to its centre.
  2. Find the player (name tag) and monsters (templates) on screen.
  3. Face the nearest monster on the same level and attack; if it is a bit
     further away, step towards it (only while well inside the circle).
  4. With no monster templates, or none in sight, attack left and right.
"""
import math
import time
from pathlib import Path

import yaml

from . import controls
from .config import ROOT
from .vision import Templates

AREA_FILE = ROOT / "routines" / "area.yaml"
TEMPLATE_DIR = ROOT / "templates"


def load_area_center():
    if not AREA_FILE.exists():
        return None
    data = yaml.safe_load(AREA_FILE.read_text(encoding="utf-8")) or {}
    return data.get("center")


def save_area_center(pos):
    AREA_FILE.write_text(f"center: [{pos[0]:.3f}, {pos[1]:.3f}]\n", encoding="utf-8")


def load_templates():
    player = Templates(sorted(TEMPLATE_DIR.glob("player*.png")))
    monsters = Templates(sorted((TEMPLATE_DIR / "monsters").glob("*.png")), flip=True)
    return player, monsters


class AreaFarmer:
    def __init__(self, bot):
        self.bot = bot
        self.cfg = bot.config["area"]
        self.keys = bot.config["keys"]
        self.cmd = bot.cmd
        self.center = load_area_center()
        self.player_tpl, self.monster_tpl = load_templates()
        self._facing = "right"
        self._last_loot = 0.0

    def describe(self):
        mobs = len(self.monster_tpl.images) // 2
        how = f"หามอนจากภาพ {mobs} ภาพ" if mobs else "ไม่มีภาพมอน - ตีสลับซ้าย/ขวา"
        tag = "เจอภาพป้ายชื่อ" if self.player_tpl else "ไม่มีภาพป้ายชื่อ - ถือว่าตัวละครอยู่กลางจอ"
        return f"ศูนย์กลาง {self.center} รัศมี {self.cfg['radius']} | {how} | {tag}"

    # ---- one iteration ------------------------------------------------------
    def tick(self):
        if self._outside_area():
            print("[area] ออกนอกพื้นที่ - เดินกลับ")
            self.cmd.move_to(self.center)
            return

        frame = self.bot.capture.frame()
        target = self._nearest_monster(frame) if self.monster_tpl else None
        if target is None:
            self._attack_blind()
        else:
            self._engage(*target)

        if time.time() - self._last_loot > self.cfg["loot_every"]:
            self.cmd.loot(times=2)
            self._last_loot = time.time()

    # ---- helpers --------------------------------------------------------------
    def _distance_from_center(self):
        pos = self.bot.position()
        if pos is None:
            return None
        return math.hypot(pos[0] - self.center[0], pos[1] - self.center[1])

    def _outside_area(self):
        d = self._distance_from_center()
        return d is not None and d > self.cfg["radius"]

    def _player_on_screen(self, frame):
        h, w = frame.shape[:2]
        if self.player_tpl:
            tags = self.player_tpl.find(frame, self.cfg["player_threshold"])
            if tags:
                x, y, _ = tags[0]
                # The name tag sits under the character's feet; aim at the body.
                return x, y - h * 0.05
        return w / 2, h * 0.6

    def _nearest_monster(self, frame):
        h, w = frame.shape[:2]
        px, py = self._player_on_screen(frame)
        best = None
        for mx, my, _ in self.monster_tpl.find(frame, self.cfg["monster_threshold"]):
            if my > h * 0.88:  # bottom HUD (HP/MP/quickslots)
                continue
            dx, dy = mx - px, my - py
            # Lucky Seven / basic attacks hit roughly on the same level only.
            if abs(dy) > h * self.cfg["vertical_range"]:
                continue
            if best is None or abs(dx) < abs(best[0]):
                best = (dx, dy)
        if best is None:
            return None
        return best[0] / w, best[1] / h  # as fractions of the screen

    def _engage(self, dx, _dy):
        direction = "right" if dx > 0 else "left"
        if abs(dx) > self.cfg["attack_range"]:
            # Too far: step towards it, but only while comfortably inside the area.
            d = self._distance_from_center()
            if d is not None and d < self.cfg["radius"] * 0.8:
                controls.hold(direction)
                time.sleep(0.25)
                controls.release(direction)
                return
        self._face(direction)
        self.cmd.attack(times=self.cfg["attacks_per_tick"])

    def _attack_blind(self):
        self._face("left" if self._facing == "right" else "right")
        self.cmd.attack(times=self.cfg["attacks_per_tick"])

    def _face(self, direction):
        if direction != self._facing:
            self.cmd.face(direction)
            self._facing = direction


def template_dir():
    TEMPLATE_DIR.mkdir(exist_ok=True)
    (TEMPLATE_DIR / "monsters").mkdir(exist_ok=True)
    return Path(TEMPLATE_DIR)
