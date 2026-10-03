"""Read game state (player position, HP/MP) from captured frames."""
import cv2
import numpy as np


def _mask(img, hsv_range):
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    lower, upper = np.array(hsv_range["lower"]), np.array(hsv_range["upper"])
    if lower[0] <= upper[0]:
        return cv2.inRange(hsv, lower, upper)
    # Hue wraps around (red sits at both 0 and 179): match lower..179 and 0..upper.
    return cv2.inRange(hsv, lower, np.array([179, *upper[1:]])) | \
        cv2.inRange(hsv, np.array([0, *lower[1:]]), upper)


def player_position(minimap, dot_hsv):
    """Return the player's (x, y) on the minimap as fractions 0..1, or None
    if the dot isn't visible."""
    mask = _mask(minimap, dot_hsv)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    biggest = max(contours, key=cv2.contourArea)
    # Yellowish specks on platforms are a pixel or two; the player dot is much
    # bigger, so ignore anything tiny rather than mistaking it for the player.
    x, y, w, h = cv2.boundingRect(biggest)
    min_side = max(3, minimap.shape[1] // 90)
    if w < min_side or h < min_side:
        return None
    m = cv2.moments(biggest)
    if m["m00"] == 0:
        x, y, w, h = cv2.boundingRect(biggest)
        cx, cy = x + w / 2, y + h / 2
    else:
        cx, cy = m["m10"] / m["m00"], m["m01"] / m["m00"]
    h, w = minimap.shape[:2]
    return cx / w, cy / h


def bar_ratio(bar, bar_hsv):
    """Fraction of a horizontal HP/MP bar that is still filled, or None if the
    region hasn't been set."""
    if bar.size == 0:
        return None
    mask = _mask(bar, bar_hsv)
    filled_cols = np.where(mask.any(axis=0))[0]
    if len(filled_cols) == 0:
        return 0.0
    # Bars fill from the left, so the rightmost coloured column marks the level.
    return (filled_cols[-1] + 1) / bar.shape[1]


class Templates:
    """Small images (player name tag, monsters) to find on screen.

    Matching runs on a downscaled frame for speed; results are returned in
    full-frame pixel coordinates as (center_x, center_y, score).

    masked=True (monsters): the background around the monster in each
    captured image (grass, rock, platform) is cut away automatically, so a
    patch of the same background elsewhere is not mistaken for a monster,
    and every match must look like the monster pixel by pixel.
    """

    def __init__(self, paths, flip=False, masked=False):
        self.images = []
        self.masks = []
        self.masked = masked
        for p in paths:
            img = cv2.imread(str(p))
            if img is None:
                continue
            mask = _object_mask(img) if masked else None
            self.images.append(img)
            self.masks.append(mask)
            if flip:
                self.images.append(cv2.flip(img, 1))
                self.masks.append(cv2.flip(mask, 1) if mask is not None else None)
        self._scaled = {}

    def __bool__(self):
        return bool(self.images)

    def _at_scale(self, scale):
        if scale not in self._scaled:
            out = []
            for t, m in zip(self.images, self.masks):
                ts = cv2.resize(t, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
                ms = None if m is None else cv2.resize(
                    m, (ts.shape[1], ts.shape[0]), interpolation=cv2.INTER_NEAREST)
                out.append((ts, ms))
            self._scaled[scale] = out
        return self._scaled[scale]

    def find(self, frame, threshold, max_width=960, max_color_diff=45, max_pixel_diff=50,
             exclude=()):
        """exclude: (x, y, w, h) frame rectangles to ignore (e.g. the minimap)."""
        scale = min(1.0, max_width / frame.shape[1])
        small = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) \
            if scale < 1 else frame
        hits = []
        for t, m in self._at_scale(scale):
            th, tw = t.shape[:2]
            if th < 4 or tw < 4 or th > small.shape[0] or tw > small.shape[1]:
                continue
            if m is not None:
                result = cv2.matchTemplate(small, t, cv2.TM_CCOEFF_NORMED, mask=m)
                result = np.nan_to_num(result, nan=-1.0, posinf=-1.0, neginf=-1.0)
            else:
                result = cv2.matchTemplate(small, t, cv2.TM_CCOEFF_NORMED)
            sel = m > 0 if m is not None else np.ones((th, tw), bool)
            t_color = t[sel].mean(axis=0)
            t_int = t.astype(np.int16)
            for _ in range(200):
                _, score, _, (x, y) = cv2.minMaxLoc(result)
                if score < threshold:
                    break
                # Blank out this match so the next loop finds a different one.
                cv2.rectangle(result, (x - tw // 2, y - th // 2), (x + tw // 2, y + th // 2), -1, -1)
                cx, cy = (x + tw / 2) / scale, (y + th / 2) / scale
                if any(ex <= cx <= ex + ew and ey <= cy <= ey + eh for ex, ey, ew, eh in exclude):
                    continue
                patch = small[y:y + th, x:x + tw]
                # Shape matching ignores overall colour, so e.g. the white glove
                # cursor can match a green slime; reject clearly different colours.
                if np.linalg.norm(patch[sel].mean(axis=0) - t_color) > max_color_diff:
                    continue
                if self.masked:
                    # A real monster matches nearly pixel for pixel; background
                    # that merely has a similar shape (rock, grass) does not.
                    diff = np.linalg.norm(patch.astype(np.int16) - t_int, axis=2)[sel]
                    if np.median(diff) > max_pixel_diff:
                        continue
                hits.append((cx, cy, float(score)))
        return _dedupe(hits, frame.shape[1] * 0.02)


def _object_mask(img):
    """255 where the monster is, 0 for the background around it (GrabCut,
    assuming the capture box touches background on its edges). Falls back to
    the whole image when the cut looks wrong."""
    h, w = img.shape[:2]
    if h < 12 or w < 12:
        return None
    mask = np.zeros((h, w), np.uint8)
    bg, fg = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(img, mask, (2, 2, w - 4, h - 4), bg, fg, 5, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None
    obj = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    if not 0.25 <= (obj > 0).mean() <= 0.95:
        return None
    return obj


def _dedupe(hits, radius):
    """Merge matches closer than `radius` (same monster found by several templates)."""
    kept = []
    for h in sorted(hits, key=lambda h: -h[2]):
        if all(abs(h[0] - k[0]) > radius or abs(h[1] - k[1]) > radius for k in kept):
            kept.append(h)
    return kept
