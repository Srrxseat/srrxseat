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
    """

    def __init__(self, paths, flip=False):
        self.images = []
        for p in paths:
            img = cv2.imread(str(p))
            if img is None:
                continue
            self.images.append(img)
            if flip:
                self.images.append(cv2.flip(img, 1))
        self._scaled = {}

    def __bool__(self):
        return bool(self.images)

    def _at_scale(self, scale):
        if scale not in self._scaled:
            self._scaled[scale] = [
                cv2.resize(t, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
                for t in self.images
            ]
        return self._scaled[scale]

    @staticmethod
    def _body_mask(img, hue):
        """Pixels in the monster's own colour (e.g. a slime's bright green)."""
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        dh = np.abs(hsv[:, :, 0].astype(int) - hue)
        dh = np.minimum(dh, 180 - dh)
        return (dh <= 12) & (hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 90)

    @staticmethod
    def _main_hue(img):
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        vivid = hsv[(hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 90)]
        return int(np.median(vivid[:, 0])) if len(vivid) else None

    def find(self, frame, threshold, max_width=960, max_color_diff=45, min_body=0.6):
        scale = min(1.0, max_width / frame.shape[1])
        small = cv2.resize(frame, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) \
            if scale < 1 else frame
        hits = []
        for t in self._at_scale(scale):
            th, tw = t.shape[:2]
            if th < 4 or tw < 4 or th > small.shape[0] or tw > small.shape[1]:
                continue
            result = cv2.matchTemplate(small, t, cv2.TM_CCOEFF_NORMED)
            t_color = t.reshape(-1, 3).mean(axis=0)
            hue = self._main_hue(t) if min_body else None
            t_body = self._body_mask(t, hue).sum() if hue is not None else 0
            while True:
                _, score, _, (x, y) = cv2.minMaxLoc(result)
                if score < threshold:
                    break
                # Shape matching ignores overall colour, so e.g. the white glove
                # cursor can match a green slime; reject clearly different colours.
                patch = small[y:y + th, x:x + tw]
                patch_color = patch.reshape(-1, 3).mean(axis=0)
                # Drops (e.g. small green blobs a slime leaves behind) match
                # the shape loosely but are much smaller: require roughly as
                # much monster-coloured body as the template has.
                big_enough = not t_body or \
                    self._body_mask(patch, hue).sum() >= min_body * t_body
                if np.linalg.norm(patch_color - t_color) <= max_color_diff and big_enough:
                    hits.append(((x + tw / 2) / scale, (y + th / 2) / scale, float(score)))
                # Blank out this match so the next loop finds a different one.
                cv2.rectangle(result, (x - tw // 2, y - th // 2), (x + tw // 2, y + th // 2), -1, -1)
        return _dedupe(hits, frame.shape[1] * 0.02)


def _dedupe(hits, radius):
    """Merge matches closer than `radius` (same monster found by several templates)."""
    kept = []
    for h in sorted(hits, key=lambda h: -h[2]):
        if all(abs(h[0] - k[0]) > radius or abs(h[1] - k[1]) > radius for k in kept):
            kept.append(h)
    return kept
