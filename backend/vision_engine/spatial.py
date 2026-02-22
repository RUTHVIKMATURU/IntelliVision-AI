"""
vision_engine/spatial.py — Spatial classification & scene language generation.

Primary API (clean, reusable):

    compute_direction(bbox, frame_width)       → str + structured dict
    compute_distance(depth_map, bbox)          → str + structured dict

Supporting utilities:

    get_horizontal_zone(cx, img_width)         → 'Left' | 'Center' | 'Right'
    get_vertical_zone(cy, img_height)          → 'Upper' | 'Middle' | 'Lower'
    get_direction(cx, img_width)               → legacy alias
    build_alert(label, h_zone, v_zone, distance, urgency) → str
    generate_scene_description(detections, navigation, caption) → str
"""

from typing import Optional
import numpy as np


# ─────────────────────────────────────────────────────────────────────────────
# compute_direction — primary API
# ─────────────────────────────────────────────────────────────────────────────

def compute_direction(bbox: list | tuple, frame_width: int) -> dict:
    """
    Determine horizontal position of a bounding box within the frame.

    The frame is divided into three equal columns:
        Left   — cx < frame_width / 3
        Center — frame_width / 3 ≤ cx < 2 × frame_width / 3
        Right  — cx ≥ 2 × frame_width / 3

    Args:
        bbox:        [x1, y1, x2, y2] pixel coordinates (int or float).
        frame_width: total frame width in pixels.

    Returns:
        {
            "direction":    "Left" | "Center" | "Right",
            "center_x":     float,   # horizontal centre of the box
            "zone_index":   int,     # 0 = Left, 1 = Center, 2 = Right
        }
    """
    x1, _, x2, _ = bbox
    cx = (x1 + x2) / 2.0
    third = frame_width / 3.0

    if cx < third:
        direction, zone_index = "Left", 0
    elif cx < 2 * third:
        direction, zone_index = "Center", 1
    else:
        direction, zone_index = "Right", 2

    return {
        "direction":  direction,
        "center_x":   round(cx, 2),
        "zone_index": zone_index,
    }


# ─────────────────────────────────────────────────────────────────────────────
# compute_distance — primary API
# ─────────────────────────────────────────────────────────────────────────────

def compute_distance(
    depth_map: Optional[np.ndarray],
    bbox:      list | tuple,
) -> dict:
    """
    Estimate the distance of an object from a normalised MiDaS depth map.

    MiDaS produces **inverse** depth: higher value → object is **closer**.
    Values are assumed to be in [0, 1] (normalised).

    Distance categories:
        Very Close  — avg depth ≥ 0.75
        Near        — avg depth ≥ 0.50
        Medium      — avg depth ≥ 0.25
        Far         — avg depth  < 0.25
        Unknown     — depth_map is None or bbox ROI is empty

    Args:
        depth_map: H×W float32 normalised depth array, or None.
        bbox:      [x1, y1, x2, y2] pixel coordinates (must be within depth_map).

    Returns:
        {
            "distance":    "Very Close" | "Near" | "Medium" | "Far" | "Unknown",
            "avg_depth":   float | None,   # mean normalised depth over the ROI
            "depth_valid": bool,           # False if depth_map was None or ROI empty
        }
    """
    if depth_map is None:
        return {"distance": "Unknown", "avg_depth": None, "depth_valid": False}

    x1, y1, x2, y2 = (int(v) for v in bbox)

    # Clamp to depth map bounds
    h, w  = depth_map.shape[:2]
    x1    = max(0, x1);  y1 = max(0, y1)
    x2    = min(w, x2);  y2 = min(h, y2)

    if x2 <= x1 or y2 <= y1:
        return {"distance": "Unknown", "avg_depth": None, "depth_valid": False}

    roi       = depth_map[y1:y2, x1:x2]
    if roi.size == 0:
        return {"distance": "Unknown", "avg_depth": None, "depth_valid": False}

    avg_depth = float(roi.mean())
    distance  = _categorize(avg_depth)

    return {
        "distance":    distance,
        "avg_depth":   round(avg_depth, 4),
        "depth_valid": True,
    }


def _categorize(avg: float) -> str:
    if avg >= 0.75:
        return "Very Close"
    elif avg >= 0.50:
        return "Near"
    elif avg >= 0.25:
        return "Medium"
    return "Far"


# ─────────────────────────────────────────────────────────────────────────────
# Low-level zone helpers (used internally & by detection.py)
# ─────────────────────────────────────────────────────────────────────────────

def get_horizontal_zone(cx: float, img_width: int) -> str:
    """Horizontal zone from centre x → 'Left' | 'Center' | 'Right'."""
    third = img_width / 3
    if cx < third:       return "Left"
    elif cx < 2 * third: return "Center"
    return "Right"


def get_vertical_zone(cy: float, img_height: int) -> str:
    """
    Vertical zone from centre y → 'Upper' | 'Middle' | 'Lower'.
    Upper = sky/top, Lower = ground level/immediate path.
    """
    third = img_height / 3
    if cy < third:       return "Upper"
    elif cy < 2 * third: return "Middle"
    return "Lower"


def get_direction(cx: float, img_width: int) -> str:
    """Legacy alias for get_horizontal_zone."""
    return get_horizontal_zone(cx, img_width)


# ─────────────────────────────────────────────────────────────────────────────
# Natural-language alert builder
# ─────────────────────────────────────────────────────────────────────────────

_DIRECTION_PHRASE: dict[str, str] = {
    "Left":   "on your left",
    "Center": "directly ahead",
    "Right":  "on your right",
}
_VERTICAL_PHRASE: dict[str, str] = {
    "Upper":  "above",
    "Middle": "at mid-level",
    "Lower":  "at ground level",
}
_DISTANCE_PHRASE: dict[str, str] = {
    "Very Close": "at a very close distance",
    "Near":       "nearby",
    "Medium":     "at a moderate distance",
    "Far":        "far away",
    "Unknown":    "at an unknown distance",
}


def build_alert(
    label:    str,
    h_zone:   str,
    v_zone:   str,
    distance: str,
    urgency:  bool,
) -> str:
    """
    Compose a natural-language spatial alert sentence.

    Examples:
        "Person detected directly ahead at ground level at a very close distance. URGENT!"
        "Car detected on your right at mid-level nearby."
    """
    h = _DIRECTION_PHRASE.get(h_zone, h_zone.lower())
    v = _VERTICAL_PHRASE.get(v_zone,  v_zone.lower())
    d = _DISTANCE_PHRASE.get(distance, distance.lower())
    text = f"{label.capitalize()} detected {h} {v} {d}."
    if urgency:
        text += " URGENT!"
    return text


# ─────────────────────────────────────────────────────────────────────────────
# Scene description (aggregates all detections)
# ─────────────────────────────────────────────────────────────────────────────

_LEVEL_ORDER: dict[str, int] = {
    "Critical": 5, "High": 4, "Medium": 3, "Low": 2, "Minimal": 1
}
_NAV_PHRASE: dict[str, str] = {
    "Move Forward":        "Path ahead is clear. You may proceed forward.",
    "Move Slightly Left":  "Steer slightly left to find a clearer path.",
    "Move Slightly Right": "Steer slightly right to find a clearer path.",
    "Obstacle Ahead":      "Obstacle detected ahead. Stop and reassess your route.",
    "Unknown":             "",
}
_DISTANCE_ACTION: dict[tuple, str] = {
    ("Very Close", True):  "{l} {d} — very close! Please slow down immediately.",
    ("Very Close", False): "{l} {d} at close range.",
    ("Near",       True):  "{l} approaching {d}. Proceed with caution.",
    ("Near",       False): "{l} {d} nearby.",
    ("Medium",     True):  "{l} detected {d} at moderate distance. Stay alert.",
    ("Medium",     False): "{l} {d} at a moderate distance.",
    ("Far",        True):  "{l} spotted {d} in the distance.",
    ("Far",        False): "{l} detected {d}, far away.",
}


def _object_sentence(det: dict) -> str:
    label    = det.get("label",    "object").lower()
    h_zone   = det.get("direction","Center")
    distance = det.get("distance", "Unknown")
    urgency  = det.get("urgency",  False)
    dphrase  = {"Left": "from your left", "Center": "directly ahead",
                "Right": "from your right"}.get(h_zone, h_zone.lower())
    tpl = _DISTANCE_ACTION.get((distance, urgency), "{l} detected {d}.")
    return tpl.format(l=label.capitalize(), d=dphrase)


def generate_scene_description(
    detections: list,
    navigation: str,
    caption:    str,
) -> str:
    """
    Single plain-English paragraph combining caption, top-4 detections
    (sorted by urgency then priority), and the navigation suggestion.
    """
    parts: list[str] = []

    if caption:
        scene = caption.strip().capitalize()
        parts.append(scene if scene.endswith(".") else scene + ".")

    sorted_dets = sorted(
        detections,
        key=lambda d: (
            d.get("urgency", False),
            _LEVEL_ORDER.get(d.get("priority_level", "Low"), 2),
        ),
        reverse=True,
    )
    for det in sorted_dets[:4]:
        parts.append(_object_sentence(det))

    nav_text = _NAV_PHRASE.get(navigation, "")
    if nav_text:
        parts.append(nav_text)

    if not detections and not nav_text:
        parts.append("No significant objects detected. The scene appears clear.")

    return " ".join(parts)


def generate_surveillance_summary(detections: list) -> str:
    """
    Generate a natural monitoring-style summary for surveillance mode.
    Rules: Count objects, no direction, no distance, neutral tone.
    Example: "2 persons detected. 1 vehicle detected."
    """
    if not detections:
        return "No activity detected."

    counts = {}
    for det in detections:
        label = det.get("label", "object").lower()
        counts[label] = counts.get(label, 0) + 1

    sentences = []
    for label, count in counts.items():
        # Normalise some labels for monitoring tone
        display_label = "vehicle" if label == "car" else label
        
        # Pluralization logic
        if count > 1:
            if display_label == "person":
                name = "persons"
            elif display_label.endswith("s"):
                name = display_label
            else:
                name = f"{display_label}s"
        else:
            name = display_label

        phrase = f"{count} {name} detected"
        
        # Adding some flair based on examples (optional but matching tone)
        if label == "backpack":
            phrase += " unattended"
        
        sentences.append(phrase + ".")

    return " ".join(sentences)


def generate_navigation_instruction(navigation: str) -> str:
    """
    Convert a navigation label into a natural language instruction.
    Returns a TTS-friendly string.
    """
    return _NAV_PHRASE.get(navigation, "Proceed with caution.")


def generate_assistive_caption(detections: list, caption: str = "") -> str:
    """
    Generate a paragraph describing what is in the scene and where.
    Combines BLIP caption with top-4 detections. Excludes navigation.
    """
    parts: list[str] = []

    if caption:
        scene = caption.strip().capitalize()
        parts.append(scene if scene.endswith(".") else scene + ".")

    sorted_dets = sorted(
        detections,
        key=lambda d: (
            d.get("urgency", False),
            _LEVEL_ORDER.get(d.get("priority_level", "Low"), 2),
        ),
        reverse=True,
    )

    for det in sorted_dets[:4]:
        parts.append(_object_sentence(det))

    if not detections and not caption:
        parts.append("The current view appears to be clear.")

    return " ".join(parts)
