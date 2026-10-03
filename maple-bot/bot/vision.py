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
