"""Vertical position on minimaps that scroll.

On tall maps (e.g. the Ellinia slime tree) the minimap box is shorter than
the map, so it scrolls to keep the player dot near its middle: the dot's y
inside the box barely changes from level to level. To get a real height we
stitch the minimap into a full-height picture (the "atlas") as the player
moves, and locate the current minimap in it. On maps that fit in the box the
offset is always 0 and positions are the same as the dot's own position.
"""
from pathlib import Path

import cv2
import numpy as np

from .config import ROOT

ATLAS_PNG = ROOT / "routines" / "minimap_atlas.png"
ATLAS_META = ROOT / "routines" / "minimap_atlas.txt"


def _prep(strip):
    """Grey minimap with the moving dots (us: yellow, others: red) blanked."""
    hsv = cv2.cvtColor(strip, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    dots = (s > 110) & (v > 120) & (((h >= 15) & (h <= 38)) | (h <= 10) | (h >= 170))
    dots = cv2.dilate(dots.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    grey = cv2.cvtColor(strip, cv2.COLOR_BGR2GRAY)
    grey[dots] = 0
    return grey


class MinimapAtlas:
    def __init__(self, path=ATLAS_PNG, meta=ATLAS_META):
        self.path, self.meta = Path(path), Path(meta)
        self.atlas = None   # grey image, full height seen so far
        self.origin = 0     # atlas row that is "row 0" (top of the first view)
        self.last_top = 0
        self._load()

    # ---- persistence -------------------------------------------------------------
    def _load(self):
        if self.path.exists() and self.meta.exists():
            self.atlas = cv2.imread(str(self.path), cv2.IMREAD_GRAYSCALE)
            try:
                self.origin = int(self.meta.read_text().strip())
            except ValueError:
                self.atlas = None

    def save(self):
        if self.atlas is not None:
            cv2.imwrite(str(self.path), self.atlas)
            self.meta.write_text(str(self.origin))

    def reset(self):
        self.atlas, self.origin, self.last_top = None, 0, 0
        for p in (self.path, self.meta):
            if p.exists():
                p.unlink()

    # ---- locating ------------------------------------------------------------------
    def top_of(self, strip):
        """Row (in atlas coordinates relative to the origin) of the minimap's
        top edge. Grows the atlas when the view reaches unseen parts."""
        g = _prep(strip)
        h, w = g.shape
        if self.atlas is None or self.atlas.shape[1] != w:
            self.atlas, self.origin, self.last_top = g, 0, 0
            self.save()
            return 0

        # Match the middle of the view: it overlaps the atlas even when the
        # edges are showing something new.
        b0, b1 = int(h * 0.25), int(h * 0.75)
        band = g[b0:b1]
        if band.shape[0] > self.atlas.shape[0]:
            return self.last_top
        res = cv2.matchTemplate(self.atlas, band, cv2.TM_CCOEFF_NORMED)
        _, score, _, (_, y) = cv2.minMaxLoc(res)
        if score < 0.6:
            return self.last_top  # unsure (e.g. a menu over the minimap)
        top = y - b0  # atlas row of the view's top edge

        grew = False
        confident = score > 0.75  # only trust clear matches to extend the atlas
        if top < 0 and not confident:
            return self.last_top
        if top < 0:  # seeing above the atlas: prepend the new rows
            self.atlas = np.vstack([g[:-top], self.atlas])
            self.origin -= top
            top = 0
            grew = True
        extra = top + h - self.atlas.shape[0]
        if extra > 0 and confident:  # seeing below it: append
            self.atlas = np.vstack([self.atlas, g[h - extra:]])
            grew = True
        if grew:
            self.save()
        self.last_top = top - self.origin
        return self.last_top


def locate_player(frame, config, atlas):
    """(x, y) of the player on the whole map, as fractions of the minimap box
    size. y can go below 0 / above 1 on maps taller than the box."""
    from .capture import Capture
    from .vision import player_position

    strip = Capture.crop(frame, config["regions"]["minimap"])
    pos = player_position(strip, config["player_dot_hsv"])
    if pos is None:
        return None
    top = atlas.top_of(strip) if config.get("scrolling_minimap", True) else 0
    return pos[0], pos[1] + top / strip.shape[0]
