"""Grab frames of the game window."""
import ctypes
import sys

import mss
import numpy as np


def find_window_rect(title):
    """Return (left, top, width, height) of the client area of the window whose
    title contains `title`. Windows only."""
    if sys.platform != "win32":
        raise RuntimeError("หาหน้าต่างเกมได้เฉพาะบน Windows")

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
        """Whole game window as a BGR numpy array."""
        mon = {"left": self.left, "top": self.top, "width": self.width, "height": self.height}
        img = np.array(self.sct.grab(mon))
        return img[:, :, :3]

    @staticmethod
    def crop(frame, region):
        x, y, w, h = region
        return frame[y:y + h, x:x + w]
