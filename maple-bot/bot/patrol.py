"""Patrol farming: loop through 6-10 loosely placed points across the map and
fight every monster met on the way (melee: walk up to it, face it, hit it).

Each tick:
  1. A monster on the character's platform within `chase_range`: walk up to
     it and attack (left or right, whichever side it is on).
  2. Otherwise take one short step towards the current point. A point counts
     as reached anywhere within `reach`; there, swing left and right once and
     move on to the next point.
  3. Knocked off a platform, or a point is out of reach: after
     `point_timeout` seconds switch to the point nearest to where we are.
"""
import math
import time

from .area import AreaFarmer


class PatrolFarmer(AreaFarmer):
    def __init__(self, bot, points):
        super().__init__(bot)
        self.pcfg = bot.config["patrol"]
        self.points = [tuple(p) for p in points]
        self.idx = 0
        self._point_since = time.time()

    def describe(self):
        mobs = len(self.monster_tpl.images) // 2
        how = f"หามอนจากภาพ {mobs} ภาพ" if mobs else "ไม่มีภาพมอน - ตีสลับซ้าย/ขวาที่แต่ละจุด"
        tag = "เจอภาพป้ายชื่อ" if self.player_tpl else "ไม่มีภาพป้ายชื่อ"
        return f"เดินวน {len(self.points)} จุด | {how} | {tag}"

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
        target = self.points[self.idx]
        if math.dist(pos, target) <= self.pcfg["reach"]:
            # Arrived: clear both sides, then head for the next point.
            for side in ("left", "right"):
                self.cmd.face(side)  # always press: jumps may have turned us around
                self._facing = side
                self.cmd.attack(times=2)
            self._next_point((self.idx + 1) % len(self.points))
            return
        if time.time() - self._point_since > self.pcfg["point_timeout"]:
            nearest = min(range(len(self.points)), key=lambda i: math.dist(pos, self.points[i]))
            if nearest == self.idx:
                nearest = (self.idx + 1) % len(self.points)
            print(f"[patrol] ไปจุดที่ {self.idx + 1} ไม่ถึง - เปลี่ยนไปจุดที่ {nearest + 1}")
            self._next_point(nearest)
            return
        # One short step towards it (jump up / drop down / walk), shared with
        # area mode's "walk back into the circle".
        self.center = target
        self._step_back(pos)

    def _next_point(self, idx):
        self.idx = idx
        self._point_since = time.time()
        self._stuck = 0
        self._last_y = None
        self._last_x = None
