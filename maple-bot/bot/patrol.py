"""Patrol farming: loop through 6-10 loosely placed points across the map and
fight every monster met on the way (melee: walk up to it, face it, hit it).

Each tick:
  1. A monster on the character's platform within `chase_range`: walk up to
     it and attack (left or right, whichever side it is on).
  2. Otherwise travel to the current point. If the keys you pressed walking
     there while recording (F8) are known and we stand at the previous point,
     replay them: on staggered platforms that is far more reliable than
     guessing jumps. Otherwise take one short step towards it. A point counts
     as reached within `arrive_reach`; there, swing left and right once and
     move on to the next point.
  3. Knocked off a platform, or a point is out of reach: after
     `point_timeout` seconds go to the point nearest to where we are and
     continue from there.
"""
import math
import time

from .area import AreaFarmer
from .macro import play_events


class PatrolFarmer(AreaFarmer):
    def __init__(self, bot, points, paths=None, closing_path=None):
        super().__init__(bot)
        self.pcfg = bot.config["patrol"]
        self.points = [tuple(p) for p in points]
        # paths[i] = keys recorded walking from point i-1 to point i;
        # closing_path = from the last point back to the first.
        self.paths = list(paths or [None] * len(self.points))
        self.paths[0] = closing_path
        self.reach = self.pcfg.get("arrive_reach", 0.035)
        # Platforms on tall maps are ~0.04 apart: "same level" must be tighter.
        self.level_tol = self.pcfg.get("level_tolerance", 0.015)
        self.idx = 0
        self._point_since = time.time()
        self._path_tried = False

    def describe(self):
        mobs = len(self.monster_tpl.images) // 2
        how = f"หามอนจากภาพ {mobs} ภาพ" if mobs else "ไม่มีภาพมอน - ตีสลับซ้าย/ขวาที่แต่ละจุด"
        tag = "เจอภาพป้ายชื่อ" if self.player_tpl else "ไม่มีภาพป้ายชื่อ"
        known = sum(1 for p in self.paths if p)
        return (f"เดินวน {len(self.points)} จุด (จำเส้นทางได้ {known}/{len(self.points)} ช่วง) "
                f"| {how} | {tag}")

    def tick(self):
        # One screenshot per tick so position and monsters describe the same moment.
        frame = self.bot.capture.frame()
        pos = self.bot.position(frame)
        player, tag_found = self._player_on_screen(frame)
        mobs = self._monsters(frame, *player) if self.monster_tpl and player else []
        mobs = self._drop_ignored(mobs, pos)
        same_level = [m for m in mobs if abs(m[1]) <= self.cfg["vertical_range"]]
        near = [m for m in same_level if abs(m[0]) <= self.pcfg["chase_range"]]
        self._log(len(mobs), len(near), tag_found, False)

        target = self.points[self.idx]
        where = f"pos=({pos[0]:.3f},{pos[1]:.3f})" if pos else "pos=?"
        if near:
            chosen = min(near, key=lambda m: abs(m[0]))
            text = f"{where} FIGHT dx={chosen[0]:+.3f} | point {self.idx + 1}/{len(self.points)}"
            self._snapshot(frame, player, mobs, chosen, text, self.points, target)
            self._melee(*chosen)
        else:
            text = (f"{where} -> point {self.idx + 1}/{len(self.points)} "
                    f"({target[0]:.3f},{target[1]:.3f}) mobs={len(mobs)}")
            self._snapshot(frame, player, mobs, None, text, self.points, target)
            self._follow_points(pos)

        if time.time() - self._last_loot > self.cfg["loot_every"]:
            self.cmd.loot(times=2)
            self._last_loot = time.time()

    # ---- fighting ---------------------------------------------------------------
    def _melee(self, dx, dy):
        if self._check_stuck_target(dx, dy):
            return
        direction = "right" if dx > 0 else "left"
        if abs(dx) > self.cfg["attack_range"]:
            # Close the distance first (daggers only reach right next to us).
            self.cmd.walk(direction, 0.15)
            self._facing = direction
            return
        self._face(direction)
        self.cmd.attack(times=self.cfg["attacks_per_tick"])

    # ---- moving between points --------------------------------------------------
    def _follow_points(self, pos):
        if pos is None:
            self._attack_blind()
            return
        n = len(self.points)
        target = self.points[self.idx]
        if math.dist(pos, target) <= self.reach:
            # Arrived: clear both sides, then head for the next point.
            for side in ("left", "right"):
                self.cmd.face(side)  # always press: jumps may have turned us around
                self._facing = side
                self.cmd.attack(times=2)
            self._next_point((self.idx + 1) % n)
            return
        if time.time() - self._point_since > self.pcfg["point_timeout"]:
            # Lost (knocked down, fell): continue from the nearest point, i.e.
            # aim for the point after it so its recorded path can be used.
            nearest = min(range(n), key=lambda i: math.dist(pos, self.points[i]))
            print(f"[patrol] ไปจุดที่ {self.idx + 1} ไม่ถึง - กลับไปจุดที่ใกล้สุด ({nearest + 1}) แล้วไปต่อ")
            self._next_point((nearest + 1) % n)
            return

        prev = self.points[(self.idx - 1) % n]
        path = self.paths[self.idx]
        if path and not self._path_tried:
            d_prev = math.dist(pos, prev)
            if d_prev <= self.reach:
                self._path_tried = True  # one replay per leg; then fall back to stepping
                play_events(self.bot, path)
                return
            if d_prev < math.dist(pos, target):
                # Closer to where the recorded path starts: go there first.
                self._step_towards(pos, prev)
                return
        self._step_towards(pos, target)

    def _step_towards(self, pos, goal):
        # One short step (jump up / drop down / walk), shared with area mode.
        self.center = goal
        self._step_back(pos)

    def _next_point(self, idx):
        self.idx = idx
        self._point_since = time.time()
        self._path_tried = False
        self._stuck = 0
        self._last_y = None
        self._last_x = None
