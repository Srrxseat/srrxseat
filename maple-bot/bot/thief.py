"""Thief command book: movement and actions used by routines.

Movement is driven by the minimap: hold left/right until x is close enough,
climb ropes by holding up, and drop through platforms with down+jump.
"""
import time

from . import controls


class Thief:
    def __init__(self, bot):
        self.bot = bot
        self.keys = bot.config["keys"]
        self.mv = bot.config["movement"]

    # ---- movement ----------------------------------------------------------
    def move_to(self, target):
        tx, ty = target
        deadline = time.time() + self.mv["timeout"]
        try:
            while self.bot.running and time.time() < deadline:
                pos = self.bot.position()
                if pos is None:
                    time.sleep(0.05)
                    continue
                dx, dy = tx - pos[0], ty - pos[1]
                close_x = abs(dx) <= self.mv["tolerance_x"]
                close_y = abs(dy) <= self.mv["tolerance_y"]
                if close_x and close_y:
                    return True

                if not close_x:
                    self._walk("right" if dx > 0 else "left")
                    # Jump while walking to cover long distances faster;
                    # a second press in mid-air triggers Flash Jump.
                    if abs(dx) > 0.15:
                        controls.press(self.keys["jump"], delay=0.12)
                        if self.mv.get("flash_jump"):
                            controls.press(self.keys["jump"], delay=0.3)
                else:
                    controls.release("left")
                    controls.release("right")

                if close_x and not close_y:
                    if dy < 0:
                        self._climb_up()
                    else:
                        self._drop_down()
                time.sleep(0.03)
            return False
        finally:
            controls.release_all()

    def _walk(self, direction):
        other = "left" if direction == "right" else "right"
        controls.release(other)
        controls.hold(direction)

    def _climb_up(self):
        # Jump onto the rope/ladder then hold up to climb.
        controls.hold("up")
        controls.press(self.keys["jump"])
        time.sleep(0.4)
        controls.release("up")

    def _drop_down(self):
        controls.hold("down")
        time.sleep(0.05)
        controls.press(self.keys["jump"])
        time.sleep(0.3)
        controls.release("down")

    # ---- actions -----------------------------------------------------------
    def face(self, direction):
        controls.press(direction, delay=0.05)

    def walk(self, direction, seconds):
        controls.hold(direction)
        time.sleep(seconds)
        controls.release(direction)

    def attack(self, times=1, direction=None, skill=False):
        """skill=True: use the attack skill (keys.skill, e.g. Double Stab) while
        MP lasts, otherwise the normal attack key."""
        if direction:
            self.face(direction)
        sk = self.bot.config.get("skill", {})
        for _ in range(times):
            if not self.bot.running:
                return
            mp = self.bot.mp
            if skill and self.keys.get("skill") and (mp is None or mp >= sk.get("min_mp", 0.15)):
                controls.press(self.keys["skill"], delay=sk.get("delay", 0.6))
            else:
                controls.press(self.keys["attack"], delay=0.35)
            self.bot.check_health()

    def loot(self, times=1):
        controls.press(self.keys["loot"], times=times, delay=0.1)

    def key(self, key, times=1):
        controls.press(key, times=times)

    def wait(self, seconds):
        time.sleep(seconds)

    def run_action(self, action):
        (name, args), = action.items()
        handler = {
            "attack": self.attack,
            "loot": self.loot,
            "key": self.key,
            "wait": self.wait,
        }.get(name)
        if handler is None:
            raise ValueError(f"ไม่รู้จัก action '{name}'")
        handler(**(args or {}))
