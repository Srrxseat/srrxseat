"""Keyboard input sent with DirectInput scan codes (what the game client reads)."""
import time

import pydirectinput

pydirectinput.PAUSE = 0
pydirectinput.FAILSAFE = False

_held = set()


def press(key, times=1, delay=0.08):
    for _ in range(times):
        pydirectinput.keyDown(key)
        time.sleep(0.04)
        pydirectinput.keyUp(key)
        time.sleep(delay)


def hold(key):
    if key not in _held:
        pydirectinput.keyDown(key)
        _held.add(key)


def release(key):
    if key in _held:
        pydirectinput.keyUp(key)
        _held.discard(key)


def release_all():
    for key in list(_held):
        release(key)
