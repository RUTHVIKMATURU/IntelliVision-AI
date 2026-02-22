"""
vision_engine/detection.py — YOLO inference & depth-fusion pipeline.

Two public functions:

    detect_objects(frame, mode="surveillance")
        Lightweight, pure detection using the model for the given mode.
        Returns [{label, confidence, bbox}].

    run_yolo_with_depth(img_np, depth_norm, mode="surveillance")
        Full pipeline: YOLO + depth fusion + priority filtering + spatial
        classification + NL alerts. Used by /upload and /analyze-frame.

Model dispatch
--------------
The module imports the `models` dict from models.py (loaded once at startup).
Both functions accept an optional `mode` argument and resolve it to the
correct YOLO weights via `_get_model(mode)`:

    "self_driving" → kitti_model  (best.onnx,   KITTI classes)
    "surveillance" → coco_model   (yolo26n.onnx, COCO classes)
    "assistive"    → coco_model   (yolo26n.onnx, COCO classes)
"""

from typing import Optional

import cv2
import numpy as np
from fastapi import HTTPException

# ── Model dispatch — keyed by application mode ────────────────────────────────
from models import device, models as _MODEL_DICT   # loaded once at startup

from vision_engine.depth import categorize_distance
from vision_engine.priority import (
    PRIORITY_THRESHOLD,
    URGENCY_PRIORITY_MIN,
    get_priority,
    priority_label,
)
from vision_engine.spatial import (
    build_alert,
    get_horizontal_zone,
    get_vertical_zone,
)

# Valid application modes
_VALID_MODES: frozenset[str] = frozenset({"self_driving", "surveillance", "assistive"})
_DEFAULT_MODE = "surveillance"

print(
    f"[detection] Model dispatch ready — "
    f"modes: {[k for k, v in _MODEL_DICT.items() if v is not None]}  "
    f"device: {device}"
)


def _get_model(mode: str):
    """
    Return the YOLO model for the given application mode.
    Falls back to the COCO model if the requested model failed to load.
    """
    m = _MODEL_DICT.get(mode) or _MODEL_DICT.get(_DEFAULT_MODE)
    if m is None:
        # Last-resort: return any loaded model
        for v in _MODEL_DICT.values():
            if v is not None:
                m = v
                break
    
    if m is not None:
        model_name = getattr(m, 'ckpt_path', 'unknown')
        print(f"[debug] Mode: '{mode}' -> Using Model: {model_name} (Classes: {len(m.names)})")
    
    return m


# ─────────────────────────────────────────────────────────────────────────────
# detect_objects — simple, storage-free detection
# ─────────────────────────────────────────────────────────────────────────────

def detect_objects(frame: np.ndarray, mode: str) -> list[dict]:
    """
    Run YOLO on a single frame and return raw detections.

    Args:
        frame: H×W×3 BGR image (OpenCV uint8).
        mode:  Required application mode — one of:
               "self_driving" → best.onnx   (KITTI)
               "surveillance" → yolo26n.onnx (COCO)
               "assistive"    → yolo26n.onnx (COCO)

    Returns:
        List of dicts, one per detected object::

            [
                {
                    "label":      str,              # class name
                    "confidence": float,            # 0.0 – 1.0
                    "bbox":       [x1, y1, x2, y2]  # int pixel coords
                },
                ...
            ]

    Raises:
        HTTPException(400): if mode is not one of the three valid values.
    """
    if mode not in _VALID_MODES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid mode '{mode}'. "
                f"Must be one of: {sorted(_VALID_MODES)}"
            ),
        )

    yolo = _get_model(mode)
    if yolo is None:
        print(f"[detection] detect_objects — no model available for mode '{mode}'")
        return []

    try:
        results = yolo(frame)   # frame is already BGR from OpenCV
    except Exception as e:
        print(f"[detection] detect_objects ({mode}) — inference failed: {e}")
        return []

    detections: list[dict] = []
    h, w = frame.shape[:2]

    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            try:
                xyxy = box.xyxy[0].cpu().numpy()
                x1   = int(max(0,     xyxy[0]))
                y1   = int(max(0,     xyxy[1]))
                x2   = int(min(w - 1, xyxy[2]))
                y2   = int(min(h - 1, xyxy[3]))

                label      = yolo.names[int(box.cls[0])]
                confidence = round(float(box.conf[0]), 4)
                
                if len(detections) == 0: # Print only first detection in list for debug
                    print(f"[debug] {mode} - First detection: {label} ({confidence})")

                detections.append({
                    "label":      label,
                    "confidence": confidence,
                    "bbox":       [x1, y1, x2, y2],
                })
            except Exception as e:
                print(f"[detection] detect_objects ({mode}) — box error: {e}")
                continue

    return detections


# ─────────────────────────────────────────────────────────────────────────────
# run_yolo_with_depth — full pipeline (used by /upload & /analyze-frame)
# ─────────────────────────────────────────────────────────────────────────────

def run_yolo_with_depth(
    img_np:     np.ndarray,
    depth_norm: Optional[np.ndarray],
    mode:       str = _DEFAULT_MODE,
) -> list[dict]:
    """
    YOLO + depth-map fusion with priority filtering, spatial classification,
    and natural-language alert generation.

    Args:
        img_np:     H×W×3 uint8 **RGB** image.
        depth_norm: H×W float32 normalised depth in [0,1], or None.
        mode:       Application mode — selects the right YOLO weights.
                    "self_driving" uses best.onnx (KITTI);
                    "surveillance" / "assistive" use yolo26n.onnx (COCO).

    Returns:
        List of enriched detection dicts:
            label, confidence, direction, vertical_zone, spatial_zone,
            distance, priority_level, urgency, alert
        Objects below PRIORITY_THRESHOLD are silently skipped.
    """
    yolo = _get_model(mode)
    if yolo is None:
        return []

    h, w = img_np.shape[:2]

    try:
        img_bgr = cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)
        results  = yolo(img_bgr)
    except Exception as e:
        print(f"[detection] run_yolo_with_depth ({mode}) — inference failed: {e}")
        return []

    detections: list[dict] = []

    for result in results:
        if result.boxes is None:
            continue
        for box in result.boxes:
            try:
                xyxy       = box.xyxy[0].cpu().numpy()
                x1 = int(max(0,     xyxy[0]))
                y1 = int(max(0,     xyxy[1]))
                x2 = int(min(w - 1, xyxy[2]))
                y2 = int(min(h - 1, xyxy[3]))

                label      = yolo.names[int(box.cls[0])]
                confidence = float(box.conf[0])
                
                if len(detections) == 0:
                    print(f"[debug] {mode} - Pipeline first detection: {label} ({confidence:.2f})")

                # Spatial zones
                cx           = (x1 + x2) / 2
                cy           = (y1 + y2) / 2
                h_zone       = get_horizontal_zone(cx, w)
                v_zone       = get_vertical_zone(cy, h)
                spatial_zone = f"{v_zone} {h_zone}"

                # Depth fusion
                distance = "Unknown"
                if mode != "surveillance" and depth_norm is not None and (x2 > x1) and (y2 > y1):
                    roi = depth_norm[y1:y2, x1:x2]
                    if roi.size > 0:
                        distance = categorize_distance(float(roi.mean()))

                # Priority filter
                prio_int = get_priority(label)
                if prio_int < PRIORITY_THRESHOLD:
                    continue

                # Urgency: surveillance mode skips distance-based urgency
                if mode == "surveillance":
                    urgency = False
                else:
                    urgency = (
                        prio_int >= URGENCY_PRIORITY_MIN
                        and distance == "Very Close"
                    )

                alert = build_alert(label, h_zone, v_zone, distance, urgency)

                detections.append({
                    "label":          label,
                    "confidence":     round(confidence, 3),
                    "bbox":           [x1, y1, x2, y2],
                    "direction":      h_zone,
                    "vertical_zone":  v_zone,
                    "spatial_zone":   spatial_zone,
                    "distance":       distance,
                    "priority_level": priority_label(prio_int),
                    "urgency":        urgency,
                    "alert":          alert,
                })
            except Exception as e:
                print(f"[detection] run_yolo_with_depth ({mode}) — box error: {e}")
                continue

    return detections
