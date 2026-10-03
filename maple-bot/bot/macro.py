"""Record what you press while playing, then replay it in a loop.

F6 starts recording: every game key you press and release is stored with
its timing, plus where you started on the minimap. F6 again stops and saves.
In `replay` mode F9 plays it back over and over. Before each loop the bot
walks back to the starting point (knockbacks make the character drift), so
every loop starts from the same place.
"""
import math
import time

import yaml

from . import controls
from .area import AreaFarmer
from .config import ROOT

MACRO_FILE = ROOT / "routines" / "macro.yaml"


def key_name(key):
    """pynput key -> the name controls.press understands ('space', 'z', ...)."""
    name = getattr(key, "name", None)
    if name:
        return name
    char = getattr(key, "char", None)
    return char.lower() if char else None


class MacroRecorder:
    def __init__(self):
        self.recording = False
        self.events = []
        self.start_pos = None
        self._t0 = 0.0
        self._down = set()

    def start(self, pos):
        self.recording = True
        self.events, self._down = [], set()
        self.start_pos = pos
        self._t0 = time.time()

    def add(self, kind, name):
        if not self.recording or not name:
            return
        # Holding a key makes the OS repeat "down"; keep only the first one.
        if kind == "down":
            if name in self._down:
                return
            self._down.add(name)
        else:
            if name not in self._down:
                return
            self._down.discard(name)
        self.events.append([round(time.time() - self._t0, 3), kind, name])

    def cut(self):
        """Return the keys recorded since the last cut (times from 0) and keep
        recording. Keys still held are released at the end of this piece and
        pressed again at the start of the next one."""
        now = time.time()
        end = round(now - self._t0, 3)
        held = sorted(self._down)
        events = self.events + [[end, "up", name] for name in held]
        self.events = [[0.0, "down", name] for name in held]
        self._t0 = now
        return events

    def stop(self):
        self.recording = False
        end = round(time.time() - self._t0, 3)
        for name in list(self._down):  # anything still held is let go at the end
            self.events.append([end, "up", name])
        data = {
            "start": [round(v, 4) for v in self.start_pos] if self.start_pos else None,
            "duration": end,
            "events": self.events,
        }
        MACRO_FILE.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
        return len(self.events), end


def load_macro():
    if not MACRO_FILE.exists():
        return None
    data = yaml.safe_load(MACRO_FILE.read_text(encoding="utf-8")) or {}
    return data if data.get("events") else None


class MacroPlayer(AreaFarmer):
    """Replays the recorded keys; reuses area mode's step-by-step walking to
    get back to the start point between loops."""

    def __init__(self, bot, macro):
        super().__init__(bot)
        self.macro = macro
        self.start = tuple(macro["start"]) if macro.get("start") else None
        self.rcfg = bot.config.get("replay", {})
        self._returning_since = None
        self.loops = 0

    def describe(self):
        return (f"เล่นซ้ำ {len(self.macro['events'])} การกดปุ่ม "
                f"ยาว {self.macro['duration']:.0f} วินาทีต่อรอบ | จุดเริ่ม {self.start}")

    def tick(self):
        if self.start and not self._at_start():
            return
        self._returning_since = None
        self.loops += 1
        print(f"[replay] รอบที่ {self.loops}")
        self._play_once()

    def _at_start(self):
        pos = self.bot.position()
        if pos is None or math.dist(pos, self.start) <= self.rcfg.get("reach", 0.05):
            return True
        now = time.time()
        if self._returning_since is None:
            self._returning_since = now
        if now - self._returning_since > self.rcfg.get("return_timeout", 20):
            print("[replay] กลับจุดเริ่มไม่ถึง - เล่นต่อจากตรงนี้เลย")
            return True
        self.center = self.start
        self._step_back(pos)
        return False

    def _play_once(self):
        play_events(self.bot, self.macro["events"])


def play_events(bot, events):
    """Press/release keys with the recorded timing. Pauses while the game is
    not in front and keeps drinking potions on long recordings."""
    t0 = time.time()
    last_check = t0
    try:
        for t, kind, name in events:
            while True:
                if not bot.running:
                    return
                if not bot.capture.is_foreground():
                    # Paused (another window in front): hold the timeline.
                    controls.release_all()
                    pause = time.time()
                    while bot.running and not bot.capture.is_foreground():
                        time.sleep(0.3)
                    t0 += time.time() - pause
                wait = t0 + t - time.time()
                if wait <= 0:
                    break
                time.sleep(min(wait, 0.2))
            if kind == "down":
                controls.hold(name)
            else:
                controls.release(name)
            if time.time() - last_check > 1.5:
                bot.check_health()  # potions keep working mid-recording
                last_check = time.time()
    finally:
        controls.release_all()
