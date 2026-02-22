"""
vision_engine/priority.py — Object priority & urgency system.

Priority levels (integer):
    5 = Critical   — pedestrians, cyclists
    4 = High       — vehicles
    3 = Medium     — road signs, animals
    2 = Low        — street furniture
    1 = Minimal    — static background

Public API:

    OBJECT_PRIORITY                    dict  – label → int
    PRIORITY_THRESHOLD                 int   – discard below this level
    URGENCY_PRIORITY_MIN               int   – urgency trigger threshold

    get_priority(label)                → int
    priority_label(level)              → str
    apply_priority_filter(detections)  → list[dict]   ← primary API
"""

# ── Thresholds ─────────────────────────────────────────────────────────────────
PRIORITY_THRESHOLD:   int = 2   # objects below this level are discarded
URGENCY_PRIORITY_MIN: int = 4   # priority ≥ this AND "Very Close" → URGENT

# ── Priority table ─────────────────────────────────────────────────────────────
OBJECT_PRIORITY: dict[str, int] = {
    # Critical (5)
    "person":            5,
    "pedestrian":        5,
    "child":             5,
    "cyclist":           5,
    "motorcyclist":      5,
    "person_sitting":    5,
    # High (4)
    "car":               4,
    "van":               4,
    "truck":             4,
    "bus":               4,
    "motorcycle":        4,
    "bicycle":           4,
    "emergency vehicle": 4,
    "ambulance":         4,
    "fire truck":        4,
    "tram":              4,
    # Medium (3)
    "traffic light":     3,
    "stop sign":         3,
    "road sign":         3,
    "barrier":           3,
    "cone":              3,
    "pothole":           3,
    "speed bump":        3,
    "dog":               3,
    "cat":               3,
    "misc":              3,
    # Low (2)
    "bench":             2,
    "trash can":         2,
    "fire hydrant":      2,
    "parking meter":     2,
    "gate":              2,
    # Minimal (1)
    "tree":              1,
    "pole":              1,
    "building":          1,
    "vegetation":        1,
    "sidewalk":          1,
}

_LEVEL_LABELS: dict[int, str] = {
    5: "Critical",
    4: "High",
    3: "Medium",
    2: "Low",
    1: "Minimal",
}


# ── Lookup helpers ─────────────────────────────────────────────────────────────

def get_priority(label: str) -> int:
    """Return integer priority level for a label (case-insensitive). Default 2."""
    if not label:
        return 2
    
    clean_label = label.lower().strip()
    
    # Check direct mapping
    if clean_label in OBJECT_PRIORITY:
        return OBJECT_PRIORITY[clean_label]
    
    # Partial matching for robustness (e.g., "pedestrians" -> "pedestrian")
    for key, val in OBJECT_PRIORITY.items():
        if key in clean_label or clean_label in key:
            return val
            
    return 2


def priority_label(level: int) -> str:
    """Convert integer priority level to human-readable string."""
    return _LEVEL_LABELS.get(level, "Low")


# ── apply_priority_filter — primary API ───────────────────────────────────────

def apply_priority_filter(detections: list[dict]) -> list[dict]:
    """
    Filter detections by priority and attach an urgency flag to each.

    Each detection dict must have at minimum:
        "label"    : str
        "distance" : str  ("Very Close" | "Near" | "Medium" | "Far" | "Unknown")

    Processing steps:
        1. Look up the priority level for each object's label.
        2. Discard objects below PRIORITY_THRESHOLD (default: Low = 2).
        3. Set urgency = True when:
               priority_int  ≥  URGENCY_PRIORITY_MIN  (≥ High = 4)
               AND  distance == "Very Close"
        4. Attach priority_level (str) and urgency (bool) to each dict.
        5. Sort result: urgent objects first, then by descending priority.

    Args:
        detections: list of detection dicts (mutated in-place then returned).

    Returns:
        Filtered, sorted list with "priority_level" and "urgency" fields set.

    Example:
        >>> dets = [
        ...     {"label": "person", "distance": "Very Close", "confidence": 0.92},
        ...     {"label": "tree",   "distance": "Far",        "confidence": 0.80},
        ... ]
        >>> apply_priority_filter(dets)
        [{"label": "person", "distance": "Very Close", "confidence": 0.92,
          "priority_level": "Critical", "urgency": True}]
        # "tree" is Minimal (1) → below threshold → removed
    """
    result: list[dict] = []

    for det in detections:
        label    = det.get("label", "")
        distance = det.get("distance", "Unknown")

        prio_int = get_priority(label)

        # ── 1. Discard below threshold ──────────────────────────────────────
        if prio_int < PRIORITY_THRESHOLD:
            continue

        # ── 2. Urgency flag ─────────────────────────────────────────────────
        urgency = (
            prio_int >= URGENCY_PRIORITY_MIN
            and distance == "Very Close"
        )

        # ── 3. Annotate and collect ──────────────────────────────────────────
        det["priority_level"] = priority_label(prio_int)
        det["priority_int"]   = prio_int          # kept for sorting; caller may strip
        det["urgency"]        = urgency
        result.append(det)

    # ── 4. Sort: urgent first, then by descending priority ──────────────────
    result.sort(
        key=lambda d: (d["urgency"], d["priority_int"]),
        reverse=True,
    )

    # Strip internal sort key from output
    for det in result:
        det.pop("priority_int", None)

    return result
