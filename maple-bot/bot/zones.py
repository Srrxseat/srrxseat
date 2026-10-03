"""Zone farming: a few circles marked on the minimap (tools/zones.py, or F8
where you stand). The bot goes to a circle, fights every monster standing
inside it until none is left, then moves on to the next circle.

Each tick:
  1. Inside the current circle: attack the monsters on our platform whose
     position is inside the circle (walk up to them, melee). When none has
     been seen for `zones.idle` seconds (or `zones.max_stay` passed), swing
     left/right once and go to the next circle.
  2. Outside it (travelling, or knocked out): hit anything right next to us,
     otherwise take a short step towards the circle's centre. Not there
     after `zones.travel_timeout` seconds: try the next circle.
"""
import math
import time

import yaml

from .config import ROOT
from .patrol import PatrolFarmer

ZONES_FILE = ROOT / "routines" / "zones.yaml"


def load_zones(path=ZONES_FILE):
    """[{"center": [x, y], "radius": r}, ...] in minimap fractions (radius in
    units of the minimap width)."""
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except (OSError, yaml.YAMLError):
        return []
    zones = []
    for z in data.get("zones") or []:
        try:
            zones.append({"center": [float(z["center"][0]), float(z["center"][1])],
                          "radius": float(z["radius"])})
        except (KeyError, TypeError, ValueError, IndexError):
            continue
    return zones


def save_zones(zones, path=ZONES_FILE):
    path.parent.mkdir(exist_ok=True)
    rows = [{"center": [round(z["center"][0], 4), round(z["center"][1], 4)],
             "radius": round(z["radius"], 4)} for z in zones]
    path.write_text("# วงกลมฟาร์ม (สร้างด้วย tools/zones.py หรือ F8 ในโหมด zones)\n"
                    + yaml.safe_dump({"zones": rows}, allow_unicode=True, sort_keys=False),
                    encoding="utf-8")


class ZoneFarmer(PatrolFarmer):
    def __init__(self, bot, zones):
        super().__init__(bot, [z["center"] for z in zones])
        self.zones = zones
        self.zcfg = bot.config.get("zones", {})
        _, _, mw, mh = bot.config["regions"]["minimap"]
        self.aspect = mh / mw if mw else 1.0  # minimap y units -> x units
        self._zone_since = time.time()
        self._last_mob = time.time()
        self._inside = False

    def describe(self):
        mobs = len(self.monster_tpl.images) // 2
        how = f"หามอนจากภาพ {mobs} ภาพ" if mobs else "ไม่มีภาพมอน - ตีสลับซ้าย/ขวาในวง"
        return f"ฟาร์ม {len(self.zones)} วง | {how}"

    def _dist(self, p, z):
        """Distance from p to the zone centre in units of the radius."""
        c = z["center"]
        return math.hypot(p[0] - c[0], (p[1] - c[1]) * self.aspect) / z["radius"]

    def tick(self):
        frame = self.bot.capture.frame()
        pos = self.bot.position(frame)
        player, tag_found = self._player_on_screen(frame)
        mobs = self._monsters(frame, *player) if self.monster_tpl and player else []
        mobs = self._drop_ignored(mobs, pos)
        same_level = [m for m in mobs if abs(m[1]) <= self.cfg["vertical_range"]]
        zone = self.zones[self.idx]
        inside = pos is not None and self._dist(pos, zone) <= 1.0
        if inside and not self._inside:
            self._zone_since = self._last_mob = time.time()
        self._inside = inside
        now = time.time()

        if inside:
            # Monsters on our platform whose map position is in the circle.
            mine = [m for m in same_level
                    if self._dist((pos[0] + m[0] / self._scale, pos[1]), zone) <= 1.0]
        else:
            # Travelling: only deal with what is in our way.
            mine = [m for m in same_level if abs(m[0]) <= self.cfg["attack_range"] * 1.5]
        self._log(len(mobs), len(mine), tag_found, False)

        where = f"pos=({pos[0]:.3f},{pos[1]:.3f})" if pos else "pos=?"
        label = f"zone {self.idx + 1}/{len(self.zones)}"
        radii = [z["radius"] for z in self.zones]
        if mine:
            chosen = self._choose(mine, pos)
            text = f"{where} FIGHT dx={chosen[0]:+.3f} | {label}"
            self._snapshot(frame, player, mobs, chosen, text, self.points, zone["center"], radii)
            started = time.time()
            self._melee(*chosen)
            self._last_mob = time.time()
            self._point_since += time.time() - started  # fighting isn't travel time
        elif pos is None:
            self._snapshot(frame, player, mobs, None, f"{where} | {label}", self.points,
                           zone["center"], radii)
            self._attack_blind()
        elif inside:
            idle = now - self._last_mob
            text = f"{where} IN {label} idle={idle:.0f}s mobs={len(mobs)}"
            self._snapshot(frame, player, mobs, None, text, self.points, zone["center"], radii)
            if idle > self.zcfg.get("idle", 4) or now - self._zone_since > self.zcfg.get("max_stay", 90):
                self._sweep()
                if len(self.zones) > 1:
                    self._next_zone((self.idx + 1) % len(self.zones))
                else:
                    self._last_mob = time.time()  # one circle: wait for respawns
            elif self._dist(pos, zone) > 0.5:
                self._step_towards(pos, zone["center"])  # drift back to the middle
        else:
            text = f"{where} -> {label} ({zone['center'][0]:.3f},{zone['center'][1]:.3f})"
            self._snapshot(frame, player, mobs, None, text, self.points, zone["center"], radii)
            if now - self._point_since > self.zcfg.get("travel_timeout", 25):
                nxt = (self.idx + 1) % len(self.zones)
                print(f"[zones] ไปวงที่ {self.idx + 1} ไม่ถึง - ไปวงที่ {nxt + 1} แทน")
                self._next_zone(nxt)
            else:
                self._step_towards(pos, zone["center"])

        if time.time() - self._last_loot > self.cfg["loot_every"]:
            self.cmd.loot(times=2)
            self._last_loot = time.time()

    def _sweep(self):
        for side in ("left", "right"):
            self.cmd.face(side)
            self._facing = side
            self.cmd.attack(times=2)

    def _next_zone(self, idx):
        self._next_point(idx)
        self._inside = False
