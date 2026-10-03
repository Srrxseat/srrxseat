"""Keyboard input to the game.

Windows: DirectInput scan codes via pydirectinput (what DirectX games read).
macOS:   Quartz key events via pynput (Terminal needs Accessibility permission).
"""
import sys
import time

if sys.platform == "win32":
    import pydirectinput

    pydirectinput.PAUSE = 0
    pydirectinput.FAILSAFE = False

    def _down(key):
        pydirectinput.keyDown(key)

    def _up(key):
        pydirectinput.keyUp(key)
else:
    from pynput.keyboard import Controller, Key, KeyCode

    _kb = Controller()

    def _resolve(key):
        # Names like "alt", "ctrl", "left", "f1", "delete" map to pynput's Key;
        # anything else is a single character such as "z" or "0".
        special = getattr(Key, key, None)
        return special if special is not None else KeyCode.from_char(key)

    def _down(key):
        _kb.press(_resolve(key))

    def _up(key):
        _kb.release(_resolve(key))

_held = set()


def press(key, times=1, delay=0.08):
    for _ in range(times):
        _down(key)
        time.sleep(0.04)
        _up(key)
        time.sleep(delay)


def hold(key):
    if key not in _held:
        _down(key)
        _held.add(key)


def release(key):
    if key in _held:
        _up(key)
        _held.discard(key)


def release_all():
    for key in list(_held):
        release(key)
