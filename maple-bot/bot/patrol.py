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

from . import controls
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
        self._path_tries = 0
        self._align_taps = 0
        self._fails = {}  # point index -> times it timed out in a row
        # Walking along a level: hop while moving so small gaps between
        # platforms are jumped over instead of falling through.
        self.hop_on_level = True

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
        # Knocked down below the route (often where monsters gather): clear
        # every monster on this floor before climbing back.
        chase = self.pcfg["chase_range"]
        if pos is not None and self._below_route(pos):
            chase = max(chase, self.pcfg.get("fallen_chase_range", 0.5))
        near = [m for m in same_level if abs(m[0]) <= chase]
        self._log(len(mobs), len(near), tag_found, False)

        target = self.points[self.idx]
        where = f"pos=({pos[0]:.3f},{pos[1]:.3f})" if pos else "pos=?"
        if near:
            # Finish the monster in front of us before turning to one behind:
            # switching every tick (both sides in range) killed neither.
            chosen = self._choose(near, pos)
            text = f"{where} FIGHT dx={chosen[0]:+.3f} | point {self.idx + 1}/{len(self.points)}"
            self._snapshot(frame, player, mobs, chosen, text, self.points, target)
            started = time.time()
            self._melee(*chosen)
            # Time spent fighting doesn't count against reaching the point.
            self._point_since += time.time() - started
        else:
            text = (f"{where} -> point {self.idx + 1}/{len(self.points)} "
                    f"({target[0]:.3f},{target[1]:.3f}) mobs={len(mobs)}")
            self._snapshot(frame, player, mobs, None, text, self.points, target)
            self._follow_points(pos)

        if time.time() - self._last_loot > self.cfg["loot_every"]:
            self.cmd.loot(times=2)
            self._last_loot = time.time()

    def _choose(self, near, pos):
        """Monster to fight. Keep chasing the one we already went for:
        switching between far ones on both sides walked us back and forth
        (and off edges); and finish the one in front before turning around."""
        last = self._target if pos is not None else None

        def cost(m):
            side = "right" if m[0] > 0 else "left"
            in_reach = abs(m[0]) <= self.cfg["attack_range"]
            c = abs(m[0]) - (0.1 if side == self._facing and in_reach else 0)
            if last and abs(pos[0] + m[0] / self._scale - last[0]) < 0.04 \
                    and abs(m[1] - last[2]) < 0.04:
                c -= 0.15
            elif side == self._facing:
                c -= 0.03
            return c
        return min(near, key=cost)

    # ---- fighting ---------------------------------------------------------------
    def _melee(self, dx, dy):
        if self._check_stuck_target(dx, dy):
            return
        direction = "right" if dx > 0 else "left"
        if abs(dx) > self.cfg["attack_range"]:
            # Close the distance first (daggers only reach right next to us),
            # and swing once when nearly there so we hit it as it comes in.
            self.cmd.walk(direction, 0.15)
            self._facing = direction
            if abs(dx) <= self.cfg["attack_range"] * 2:
                self.cmd.attack(times=1)
            return
        # Right next to it: use the attack skill (e.g. Double Stab) - saving
        # MP for when it can actually hit.
        self._face(direction)
        self.cmd.attack(times=self.cfg["attacks_per_tick"], skill=True)

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
            self._fails.pop(self.idx, None)
            if self.idx == 0:
                self._fails.clear()  # new lap: give skipped points another chance
            nxt = (self.idx + 1) % n
            while self._fails.get(nxt, 0) >= 2 and nxt != self.idx:
                nxt = (nxt + 1) % n  # failed twice this lap: skip it
            self._next_point(nxt)
            return
        if time.time() - self._point_since > self.pcfg["point_timeout"]:
            # Lost (knocked down, fell): continue from the nearest point, i.e.
            # aim for the point after it so its recorded path can be used.
            fails = self._fails[self.idx] = self._fails.get(self.idx, 0) + 1
            nearest = min(range(n), key=lambda i: math.dist(pos, self.points[i]))
            nxt = (nearest + 1) % n
            if self._fails.get(nxt, 0) >= 2:
                # Failed that point twice already: skip it (until the next
                # lap) instead of trying forever.
                while self._fails.get(nxt, 0) >= 2 and nxt != nearest:
                    nxt = (nxt + 1) % n
                print(f"[patrol] ไปจุดที่ {self.idx + 1} ไม่ถึง - ข้ามจุดที่ไปไม่ถึงบ่อย ไปจุดที่ {nxt + 1}")
            else:
                print(f"[patrol] ไปจุดที่ {self.idx + 1} ไม่ถึง - กลับไปจุดที่ใกล้สุด ({nearest + 1}) แล้วไปต่อ")
            self._next_point(nxt)
            return

        prev = self.points[(self.idx - 1) % n]
        path = self.paths[self.idx]
        # Replay the recorded keys when the leg changes level or you jumped on
        # the way (a gap between platforms that look level on the minimap);
        # a plain walk along one platform is simpler to just walk.
        jumped = bool(path) and any(e[2] == self.keys["jump"] for e in path)
        changes_level = abs(target[1] - prev[1]) > self.level_tol
        if path and (changes_level or jumped) and self._path_tries < 2:
            d_prev = math.dist(pos, prev)
            if d_prev <= self.reach:
                # Recorded jumps only land when started where you started:
                # line up on the exact spot with short taps first.
                off = prev[0] - pos[0]
                if abs(off) > self.pcfg.get("align_tolerance", 0.01) and \
                        abs(pos[1] - prev[1]) <= self.level_tol and self._align_taps < 8:
                    self._align_taps += 1
                    side = "right" if off > 0 else "left"
                    controls.hold(side)
                    time.sleep(min(0.15, 0.04 + abs(off) * 2))
                    controls.release(side)
                    time.sleep(0.15)  # let the minimap dot settle
                    return
                # Replay the leg; if it didn't get there, come back and try once more.
                self._align_taps = 0
                self._path_tries += 1
                play_events(self.bot, path)
                return
            if d_prev < math.dist(pos, target):
                # Closer to where the recorded path starts: go there first.
                self._step_towards(pos, prev)
                return
        self._step_towards(pos, target)

    def _below_route(self, pos):
        """Clearly lower than both the point we came from and the one we head for."""
        n = len(self.points)
        lowest = max(self.points[self.idx][1], self.points[(self.idx - 1) % n][1])
        return pos[1] > lowest + 2 * self.level_tol

    def _step_towards(self, pos, goal):
        # One short step (jump up / drop down / walk), shared with area mode.
        self.center = goal
        self._step_back(pos)

    def _next_point(self, idx):
        self.idx = idx
        self._point_since = time.time()
        self._path_tries = 0
        self._align_taps = 0
        self._rope_tries = 0
        self._stuck = 0
        self._last_y = None
        self._last_x = None
