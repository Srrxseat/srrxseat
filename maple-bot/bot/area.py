"""Area farming: stay inside a circle on the minimap and attack nearby monsters.

Each tick:
  1. If outside the circle (knocked back, fell), step back towards its centre
     a little each tick, still hitting monsters on the way.
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

import cv2
import yaml

from . import controls
from .config import ROOT
from .vision import Templates

AREA_FILE = ROOT / "routines" / "area.yaml"
DEBUG_DIR = ROOT / "debug"
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
        self.mv = bot.config["movement"]
        self.level_tol = self.mv["tolerance_y"]
        self._last_y = None
        self._last_x = None
        self._stuck = 0
        self._climb_dir = "right"
        self._last_player = None
        self._target = None          # last attacked (dx, dy)
        self._target_rounds = 0      # ticks spent on it without it moving/dying
        self._ignored = []           # (dx, dy, since) spots that never die
        self._ignored_at = None      # minimap position when they were ignored
        self._ignored_pos = None
        self._last_snap = 0.0
        self._snap_n = 0

    # ---- debug snapshots ----------------------------------------------------------
    def _snapshot(self, frame, player, mobs, chosen, text, points=(), target=None):
        """Every second save what the bot saw and decided to debug/NNN.jpg
        (last 300 kept, numbered in order): purple = character, red = monster, green = monster on
        our platform, yellow = the one acted on; points drawn on the minimap."""
        if not self.bot.config.get("debug_snapshots", True):
            return
        now = time.time()
        if now - self._last_snap < 1.0:
            return
        self._last_snap = now
        img = frame.copy()
        h, w = img.shape[:2]
        th = max(1, w // 800)
        if player:
            px, py = player
            cv2.circle(img, (int(px), int(py)), 18 * th, (255, 0, 255), 2 * th)
            for dx, dy in mobs:
                same = abs(dy) <= self.cfg["vertical_range"]
                cv2.circle(img, (int(px + dx * w), int(py + dy * h)), 14 * th,
                           (0, 200, 0) if same else (0, 0, 255), 2 * th)
            if chosen:
                cx, cy = int(px + chosen[0] * w), int(py + chosen[1] * h)
                cv2.rectangle(img, (cx - 22 * th, cy - 22 * th), (cx + 22 * th, cy + 22 * th),
                              (0, 255, 255), 3 * th)
        mx, my, mw, mh = self.bot.config["regions"]["minimap"]
        top = self.bot.atlas.last_top / mh if mh else 0
        for i, (ax, ay) in enumerate(points):
            vx, vy = int(mx + ax * mw), int(my + (ay - top) * mh)
            if my <= vy <= my + mh:
                big = target is not None and (ax, ay) == tuple(target)
                cv2.circle(img, (vx, vy), (6 if big else 3) * th,
                           (0, 255, 255) if big else (255, 255, 0), -1 if big else 1)
                cv2.putText(img, str(i + 1), (vx + 4 * th, vy), cv2.FONT_HERSHEY_SIMPLEX,
                            0.35 * th, (255, 255, 255), 1)
        cv2.rectangle(img, (0, h - 34 * th), (w, h), (0, 0, 0), -1)
        cv2.putText(img, text, (8, h - 10 * th), cv2.FONT_HERSHEY_SIMPLEX, 0.6 * th,
                    (255, 255, 255), th)
        if w > 1600:
            img = cv2.resize(img, (1600, int(h * 1600 / w)), interpolation=cv2.INTER_AREA)
        DEBUG_DIR.mkdir(exist_ok=True)
        cv2.imwrite(str(DEBUG_DIR / f"{self._snap_n:04d}.jpg"), img,
                    [cv2.IMWRITE_JPEG_QUALITY, 70])
        self._snap_n += 1
        stale = DEBUG_DIR / f"{self._snap_n - 300:04d}.jpg"  # keep the last 300 (5 minutes)
        if stale.exists():
            stale.unlink()

    def describe(self):
        mobs = len(self.monster_tpl.images) // 2
        how = f"หามอนจากภาพ {mobs} ภาพ" if mobs else "ไม่มีภาพมอน - ตีสลับซ้าย/ขวา"
        tag = "เจอภาพป้ายชื่อ" if self.player_tpl else "ไม่มีภาพป้ายชื่อ - ตีสลับซ้าย/ขวาอย่างเดียว"
        return f"ศูนย์กลาง {self.center} รัศมี {self.cfg['radius']} | {how} | {tag}"

    # ---- one iteration ------------------------------------------------------
    def tick(self):
        frame = self.bot.capture.frame()
        pos = self.bot.position(frame)
        outside = pos is not None and self._dist(pos) > self.cfg["radius"]

        player, tag_found = self._player_on_screen(frame)
        # Without knowing where the character is on screen we can't tell which
        # monsters are on its platform, so just swing both ways.
        mobs = self._monsters(frame, *player) if self.monster_tpl and player else []
        mobs = self._drop_ignored(mobs, pos)
        same_level = [m for m in mobs if abs(m[1]) <= self.cfg["vertical_range"]]
        self._log(len(mobs), len(same_level), tag_found, outside)

        if same_level:
            # Always hit a monster on our own platform, even on the way back.
            self._engage(*min(same_level, key=lambda m: abs(m[0])))
        elif outside:
            self._step_back(pos)
        else:
            reachable = self._chaseable(mobs, pos)
            if reachable and self.cfg.get("chase_levels", True) and self._well_inside():
                self._change_level(*min(reachable, key=lambda m: math.hypot(*m)))
            else:
                self._attack_blind()

        if time.time() - self._last_loot > self.cfg["loot_every"]:
            self.cmd.loot(times=2)
            self._last_loot = time.time()

    # ---- helpers --------------------------------------------------------------
    def _dist(self, pos):
        return math.hypot(pos[0] - self.center[0], pos[1] - self.center[1])

    def _distance_from_center(self):
        pos = self.bot.position()
        return None if pos is None else self._dist(pos)

    def _chaseable(self, mobs, pos):
        """Monsters worth changing level for: don't climb further up when
        already in the upper half of the area, or drop further down when
        already in the lower half, so chasing never leads out of the circle."""
        if pos is None:
            return mobs
        half = self.cfg["radius"] * 0.5
        too_high = pos[1] < self.center[1] - half
        too_low = pos[1] > self.center[1] + half
        return [m for m in mobs if not (m[1] < 0 and too_high) and not (m[1] > 0 and too_low)]

    def _step_back(self, pos):
        """One short move towards the centre (called every tick while outside).

        No up-arrow (portals). When the centre is above, jump towards it; if two
        jumps in a row gain no height there is no platform overhead, so try the
        other side."""
        dx, dy = self.center[0] - pos[0], self.center[1] - pos[1]
        toward = "right" if dx > 0 else "left"
        if dy < -self.level_tol:  # centre is above
            if self._last_y is not None and pos[1] >= self._last_y - 0.005:
                self._stuck += 1
            else:
                self._stuck = 0
            self._last_y = pos[1]
            if self._stuck >= 2:
                self._climb_dir = "left" if self._climb_dir == "right" else "right"
                self._stuck = 0
            direction = toward if abs(dx) > 0.1 else self._climb_dir
            controls.hold(direction)
            controls.press(self.keys["jump"], delay=0.55)
            controls.release(direction)
        elif dy > self.level_tol and abs(dx) <= 0.1:  # centre is below us
            controls.hold("down")
            controls.press(self.keys["jump"], delay=0.45)
            controls.release("down")
        else:  # mostly sideways (or below and off to the side: walk off the edge)
            # Walking into a ledge or a gap between platforms makes no
            # progress; then jump while walking to get over it.
            blocked = self._last_x is not None and abs(pos[0] - self._last_x) < 0.005
            self._last_x = pos[0]
            controls.hold(toward)
            if blocked:
                controls.press(self.keys["jump"], delay=0.4)
            else:
                time.sleep(0.3)
            controls.release(toward)
        self._facing = toward

    def _well_inside(self):
        d = self._distance_from_center()
        return d is not None and d < self.cfg["radius"] * 0.8

    def _player_on_screen(self, frame):
        """((x, y) of the character's body in frame pixels or None, tag found now?)

        Falls back to where the tag was last seen (up to 3 s ago)."""
        h, w = frame.shape[:2]
        if self.player_tpl:
            # Name tags are grey/white, so skip the colour check used for monsters.
            tags = self.player_tpl.find(frame, self.cfg["player_threshold"],
                                        max_width=1600, max_color_diff=999)
            if tags:
                x, y, _ = tags[0]
                # The name tag sits under the character's feet; aim at the body.
                self._last_player = ((x, y - h * 0.05), time.time())
                return self._last_player[0], True
        if self._last_player and time.time() - self._last_player[1] < 3:
            return self._last_player[0], False
        return None, False

    def _monsters(self, frame, px, py):
        """Visible monsters as (dx, dy) from the player, in fractions of the screen."""
        h, w = frame.shape[:2]
        out = []
        for mx, my, _ in self.monster_tpl.find(frame, self.cfg["monster_threshold"]):
            if my > h * 0.88:  # bottom HUD (HP/MP/quickslots)
                continue
            out.append(((mx - px) / w, (my - py) / h))
        return out

    def _log(self, n_mobs, n_same, tag_found, outside):
        if time.time() - self._last_log < 3:
            return
        self._last_log = time.time()
        tag = "เจอ" if tag_found else "ไม่เจอ (จับภาพป้ายชื่อใหม่: bash run.sh tools/templates.py)"
        where = " | ออกนอกพื้นที่ - กำลังกลับ" if outside else ""
        print(f"[area] เห็นมอน {n_mobs} ตัว (ระดับเดียวกัน {n_same}) | ป้ายชื่อตัวละคร: {tag}{where}")

    def _drop_ignored(self, mobs, pos):
        """Forget ignored spots once the character has moved or after a while,
        then filter out monsters sitting on an ignored spot."""
        now = time.time()
        if self._ignored and pos is not None and self._ignored_at is not None and \
                math.hypot(pos[0] - self._ignored_at[0], pos[1] - self._ignored_at[1]) > 0.02:
            self._ignored = []
        self._ignored = [(x, y, t) for x, y, t in self._ignored if now - t < 30]
        self._ignored_pos = pos
        return [m for m in mobs
                if all(abs(m[0] - x) > 0.03 or abs(m[1] - y) > 0.03 for x, y, _ in self._ignored)]

    def _check_stuck_target(self, dx, dy):
        """A real monster dies or moves while being hit. Something that stays
        put for several rounds of attacks (a dropped item, a background detail
        that looks like a monster) gets ignored so the bot moves on."""
        last = self._target
        if last and abs(dx - last[0]) < 0.02 and abs(dy - last[1]) < 0.02:
            self._target_rounds += 1
        else:
            self._target_rounds = 0
        self._target = (dx, dy)
        if self._target_rounds >= self.cfg.get("give_up_rounds", 5):
            print("[area] ตีเป้าเดิมนานแล้วไม่ตาย - น่าจะเป็นของดรอป: เดินไปเก็บแล้วข้ามไป")
            # Most often it is a drop that looks like a small monster: walk
            # onto it and pick it up, then stop treating that spot as a target.
            direction = "right" if dx > 0 else "left"
            self.cmd.walk(direction, min(0.8, abs(dx) * 4 + 0.1))
            self.cmd.loot(times=3)
            self._facing = direction
            self._ignored.append((dx, dy, time.time()))
            self._ignored_at = self._ignored_pos
            self._target, self._target_rounds = None, 0
            return True
        return False

    def _engage(self, dx, dy):
        if self._check_stuck_target(dx, dy):
            return
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
