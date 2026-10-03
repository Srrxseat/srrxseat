"""Grab frames of the game window."""
import ctypes
import sys

import mss
import numpy as np


def find_window_rect(title):
    """Return (left, top, width, height) of the game window whose title (or
    app name) contains `title`. Coordinates are screen points."""
    if sys.platform == "win32":
        return _find_window_rect_windows(title)
    if sys.platform == "darwin":
        return _find_window_rect_macos(title)
    raise RuntimeError("รองรับเฉพาะ Windows และ macOS")


def _find_window_rect_macos(title):
    import Quartz

    options = Quartz.kCGWindowListOptionOnScreenOnly | Quartz.kCGWindowListExcludeDesktopElements
    windows = Quartz.CGWindowListCopyWindowInfo(options, Quartz.kCGNullWindowID)
    matches = []
    for w in windows:
        # Window names are only visible once Screen Recording is allowed;
        # the owning app name always is.
        names = f"{w.get('kCGWindowName') or ''} {w.get('kCGWindowOwnerName') or ''}"
        if w.get("kCGWindowLayer") == 0 and title.lower() in names.lower():
            b = w["kCGWindowBounds"]
            matches.append((int(b["X"]), int(b["Y"]), int(b["Width"]), int(b["Height"])))
    if not matches:
        raise RuntimeError(f"ไม่พบหน้าต่างที่ชื่อมีคำว่า '{title}'")
    # The app may own small helper windows; the game is the biggest one.
    return max(matches, key=lambda r: r[2] * r[3])


def _find_window_rect_windows(title):
    import ctypes.wintypes

    user32 = ctypes.windll.user32
    user32.SetProcessDPIAware()
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def enum_proc(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        if title.lower() in buf.value.lower():
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(enum_proc, 0)
    if not found:
        raise RuntimeError(f"ไม่พบหน้าต่างที่ชื่อมีคำว่า '{title}'")

    hwnd = found[0]
    rect = ctypes.wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(rect))
    pt = ctypes.wintypes.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    return pt.x, pt.y, rect.right - rect.left, rect.bottom - rect.top


class Capture:
    def __init__(self, window_title):
        self.window_title = window_title
        self.sct = mss.mss()
        self.refresh_window()

    def refresh_window(self):
        self.left, self.top, self.width, self.height = find_window_rect(self.window_title)

    def frame(self):
        """Whole game window as a BGR numpy array. On Retina displays the
        image is in physical pixels (e.g. 2x the window size in points)."""
        mon = {"left": self.left, "top": self.top, "width": self.width, "height": self.height}
        img = np.array(self.sct.grab(mon))
        return img[:, :, :3]

    @staticmethod
    def crop(frame, region):
        x, y, w, h = region
        return frame[y:y + h, x:x + w]
