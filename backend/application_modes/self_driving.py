"""
application_modes/self_driving.py — Autonomous vehicle navigation pipeline.

SelfDrivingMode uses spatial and free-space analysis to compute a navigation
vector and emit a discrete steering instruction suited for AV controllers.

Design constraints:
  • NO data storage — no disk writes, no DB calls.
  • Modular logic — vector computation is isolated in _compute_nav_vector().
  • Four instructions only: Move Forward | Turn Left | Turn Right | Stop

Usage:
    mode = SelfDrivingMode()
    response = mode.handle(result, depth_norm)
"""

from typing import Optional

import cv2
import numpy as np

from vision_engine.detection import run_yolo_with_depth
from vision_engine.depth import detect_free_space, normalize_depth_map
from vision_engine.priority import OBJECT_PRIORITY, apply_priority_filter
from vision_engine.spatial import generate_scene_description

# ── Labels relevant to road / AV decision-making ──────────────────────────────
_ROAD_LABELS: frozenset[str] = frozenset({
    "person", "pedestrian", "child", "cyclist", "motorcyclist",
    "car", "truck", "bus", "motorcycle", "bicycle",
    "emergency vehicle", "ambulance", "fire truck",
    "traffic light", "stop sign", "road sign",
    "barrier", "cone", "pothole", "speed bump",
})

# Only objects at medium priority or above are considered
_SD_MIN_PRIORITY: int = 3


# ── Navigation vector ─────────────────────────────────────────────────────────

def _compute_nav_vector(
    depth_norm:  Optional[np.ndarray],
    detections:  list[dict],
) -> dict:
    """
    Compute a navigation vector from the depth map and filtered detections.

    The vector is derived from three independent signals:
      1. Free-space analysis (which region of the lower-half is driveable).
      2. Obstacle urgency (any urgent object forces Stop regardless of space).
      3. Left/right clearance bias (steering towards the roomier side).

    Returns:
        {
            "instruction":   str,    # Move Forward | Turn Left | Turn Right | Stop
            "left_clear":    float,  # 0-1, fraction of left half that is free
            "right_clear":   float,  # 0-1, fraction of right half that is free
            "center_clear":  bool,   # True if centre-bottom patch is safe
            "safe_ratio":    float,  # overall free-space fraction in lower half
            "urgent_block":  bool,   # True if an urgent object forced Stop
        }
    """
    # ── Default (no depth available) ──────────────────────────────────────────
    if depth_norm is None:
        return {
            "instruction": "Stop",
            "left_clear":  0.0,
            "right_clear": 0.0,
            "center_clear": False,
            "safe_ratio":  0.0,
            "urgent_block": False,
        }

    # ── Free-space mask ────────────────────────────────────────────────────────
    FREE_THRESHOLD = 0.40
    H, W   = depth_norm.shape
    half_y = H // 2
    lower  = depth_norm[half_y:, :]   # ground / path region
    lH, lW = lower.shape

    import cv2
    binary = (lower < FREE_THRESHOLD).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    # ── Spatial clearance values ───────────────────────────────────────────────
    left_clear  = float(binary[:, : lW // 2].mean()) / 255.0
    right_clear = float(binary[:, lW // 2 :].mean()) / 255.0
    safe_ratio  = float((binary > 0).sum()) / (lH * lW)

    cx0, cx1 = int(lW * 0.40), int(lW * 0.60)
    cy0, cy1 = int(lH * 0.85), lH
    center_clear = bool(binary[cy0:cy1, cx0:cx1].mean() > 127)

    # ── Urgent obstacle check ──────────────────────────────────────────────────
    urgent_block = any(d.get("urgency") for d in detections)

    # ── Steering decision ──────────────────────────────────────────────────────
    if urgent_block:
        instruction = "Stop"
    elif center_clear:
        instruction = "Move Forward"
    elif left_clear > right_clear and left_clear > 0.15:
        instruction = "Turn Left"
    elif right_clear > left_clear and right_clear > 0.15:
        instruction = "Turn Right"
    else:
        instruction = "Stop"

    return {
        "instruction":  instruction,
        "left_clear":   round(left_clear,  3),
        "right_clear":  round(right_clear, 3),
        "center_clear": center_clear,
        "safe_ratio":   round(safe_ratio,  3),
        "urgent_block": urgent_block,
    }


# ── SelfDrivingMode class ─────────────────────────────────────────────────────

class SelfDrivingMode:
    """
    Self-driving application mode — zero-storage, road-focused navigation.

    Processes detection results and a depth map to produce a discrete
    steering instruction and supporting telemetry for an AV controller.

    No frames are written to disk. No database calls are made.
    """

    def handle(
        self,
        result:     dict,
        depth_norm: Optional[np.ndarray] = None,
    ) -> dict:
        """
        Compute steering instruction from detection results + depth map.

        Args:
            result:     Dict from detect_objects() / run_yolo_with_depth():
                          "detections", "navigation", "scene_description"
            depth_norm: H×W float32 normalised depth in [0,1], or None.

        Returns:
            {
                "instruction":       str,    # Move Forward|Turn Left|Turn Right|Stop
                "navigation_raw":    str,    # raw free-space suggestion (for debug)
                "scene_description": str,
                "left_clear":        float,
                "right_clear":       float,
                "center_clear":      bool,
                "safe_ratio":        float,
                "urgent_block":      bool,
                "urgent_count":      int,
                "object_count":      int,
                "road_clear":        bool,   # True iff instruction=="Move Forward"
            }
        """
        raw_dets = result.get("detections", [])

        # ── 1. Filter to road-relevant, medium+ priority objects ───────────────
        road_dets = [
            d for d in raw_dets
            if d.get("label", "").lower() in _ROAD_LABELS
            and OBJECT_PRIORITY.get(d.get("label", "").lower(), 0) >= _SD_MIN_PRIORITY
        ]
        detections = apply_priority_filter(road_dets)

        # ── 2. Navigation vector ───────────────────────────────────────────────
        nav_vector = _compute_nav_vector(depth_norm, detections)

        # ── 3. Scene description ───────────────────────────────────────────────
        scene_description = result.get("scene_description") or \
            generate_scene_description(
                detections, nav_vector["instruction"], caption=""
            )

        instruction = nav_vector["instruction"]

        return {
            "instruction":       instruction,
            "navigation_raw":    result.get("navigation", "Unknown"),
            "scene_description": scene_description,
            "left_clear":        nav_vector["left_clear"],
            "right_clear":       nav_vector["right_clear"],
            "center_clear":      nav_vector["center_clear"],
            "safe_ratio":        nav_vector["safe_ratio"],
            "urgent_block":      nav_vector["urgent_block"],
            "urgent_count":      sum(1 for d in detections if d.get("urgency")),
            "object_count":      len(detections),
            "road_clear":        instruction == "Move Forward",
        }


# ── Functional wrapper (backward compat with api/main.py) ─────────────────────

def run_self_driving_analysis(
    img_np:     np.ndarray,
    depth_norm: Optional[np.ndarray] = None,
) -> dict:
    """
    Convenience wrapper: run detection pipeline then pass to SelfDrivingMode.

    Args:
        img_np:     H×W×3 uint8 RGB image.
        depth_norm: Optional normalised depth map (float32 [0,1]).

    Returns:
        SelfDrivingMode.handle() response dict.
    """
    detections = run_yolo_with_depth(img_np, depth_norm)
    nav        = detect_free_space(depth_norm)["navigation"] \
                 if depth_norm is not None else "Unknown"

    result = {
        "detections":        detections,
        "navigation":        nav,
        "scene_description": "",
    }

    return SelfDrivingMode().handle(result, depth_norm)
