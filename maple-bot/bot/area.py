"""Area farming: stay inside a circle on the minimap and attack nearby monsters.

Each tick:
  1. If knocked back outside the circle, walk back to its centre.
  2. Find the player (name tag) and monsters (templates) on screen.
  3. Face the nearest monster on the same level and attack; if it is a bit
     further away, step towards it (only while well inside the circle).
  4. If every visible monster is on another platform, jump up / drop down
     towards the nearest one (multi-level maps like the Ellinia tree).
  5. With no monster templates, or none in sight, attack left and right.
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
        self._last_log = 0.0

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
        (px, py), tag_found = self._player_on_screen(frame)
        mobs = self._monsters(frame, px, py) if self.monster_tpl else []
        same_level = [m for m in mobs if abs(m[1]) <= self.cfg["vertical_range"]]
        self._log(len(mobs), len(same_level), tag_found)

        if same_level:
            self._engage(*min(same_level, key=lambda m: abs(m[0])))
        elif mobs and self.cfg.get("chase_levels", True) and self._well_inside():
            self._change_level(*min(mobs, key=lambda m: math.hypot(*m)))
        else:
            self._attack_blind()

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

    def _well_inside(self):
        d = self._distance_from_center()
        return d is not None and d < self.cfg["radius"] * 0.8

    def _player_on_screen(self, frame):
        """((x, y) of the character's body in frame pixels, name tag found?)"""
        h, w = frame.shape[:2]
        if self.player_tpl:
            tags = self.player_tpl.find(frame, self.cfg["player_threshold"])
            if tags:
                x, y, _ = tags[0]
                # The name tag sits under the character's feet; aim at the body.
                return (x, y - h * 0.05), True
        return (w / 2, h * 0.6), False

    def _monsters(self, frame, px, py):
        """Visible monsters as (dx, dy) from the player, in fractions of the screen."""
        h, w = frame.shape[:2]
        out = []
        for mx, my, _ in self.monster_tpl.find(frame, self.cfg["monster_threshold"]):
            if my > h * 0.88:  # bottom HUD (HP/MP/quickslots)
                continue
            out.append(((mx - px) / w, (my - py) / h))
        return out

    def _log(self, n_mobs, n_same, tag_found):
        if time.time() - self._last_log < 3:
            return
        self._last_log = time.time()
        tag = "เจอ" if tag_found else "ไม่เจอ (ใช้กลางจอแทน)"
        print(f"[area] เห็นมอน {n_mobs} ตัว (ระดับเดียวกัน {n_same}) | ป้ายชื่อตัวละคร: {tag}")

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

    def _change_level(self, dx, dy):
        """Every visible monster is on another platform: jump up or drop down to it."""
        direction = "right" if dx > 0 else "left"
        if dy < 0:
            # Platforms can be jumped through from below. Plain jump (no up
            # arrow) so we never enter a portal by accident.
            if abs(dx) > 0.05:
                controls.hold(direction)
            controls.press(self.keys["jump"], delay=0.5)
            controls.release(direction)
        elif abs(dx) > 0.15:
            # Far to the side and below: walk that way and fall off the edge.
            controls.hold(direction)
            time.sleep(0.35)
            controls.release(direction)
        else:
            controls.hold("down")
            controls.press(self.keys["jump"], delay=0.4)
            controls.release("down")
        self._facing = direction if abs(dx) > 0.05 else self._facing

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
