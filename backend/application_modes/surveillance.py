"""
application_modes/surveillance.py — Persistent surveillance pipeline.

SurveillanceMode handles post-inference storage, including:
  - Saving the frame to disk with a timestamped filename.
  - Persisting structured metadata to MongoDB.
  - Returning a confirmed JSON response with storage details.

Usage:
    mode = SurveillanceMode()
    response = mode.handle(result, frame)

Where `result` is the dict returned by detect_objects / run_yolo_with_depth
and `frame` is the raw BGR numpy array from OpenCV.
"""

import os
import uuid
from datetime import datetime
from typing import Optional

import cv2
import numpy as np
from pymongo import MongoClient

from vision_engine.detection import run_yolo_with_depth
from vision_engine.depth import categorize_distance
from vision_engine.priority import get_priority, priority_label, apply_priority_filter
from vision_engine.spatial import (
    generate_surveillance_summary,
    get_horizontal_zone,
    get_vertical_zone,
)

# ── Storage config ─────────────────────────────────────────────────────────────
SURVEILLANCE_DIR = os.path.join("uploads", "surveillance")
os.makedirs(SURVEILLANCE_DIR, exist_ok=True)

# ── MongoDB ────────────────────────────────────────────────────────────────────
_client     = MongoClient("mongodb://localhost:27017/")
_db         = _client["caption_vision_db"]
_collection = _db["surveillance"]


class SurveillanceMode:
    """
    Surveillance application mode.

    Persists every processed frame with its full detection metadata so that
    historical records can be reviewed, searched, and audited.

    Attributes:
        save_dir (str): Directory where frames are written to disk.
        collection:     PyMongo collection for metadata storage.
    """

    def __init__(
        self,
        save_dir:   str              = SURVEILLANCE_DIR,
        collection                   = _collection,
    ):
        self.save_dir   = save_dir
        self.collection = collection
        os.makedirs(self.save_dir, exist_ok=True)

    # ── Primary method ─────────────────────────────────────────────────────────

    def handle(
        self,
        result: dict,
        frame:  Optional[np.ndarray] = None,
    ) -> dict:
        """
        Persist a detection result and (optionally) the raw frame.
        Filters out spatial and depth-related fields.
        """
        timestamp = datetime.utcnow().isoformat(timespec="seconds") + "Z"
        raw_detections = result.get("detections", [])
        
        # ── 1. Filter detections: label, confidence, and bbox only ────────────
        # (Note: bbox is added to run_yolo_with_depth results in detection.py)
        detected_objects = []
        for d in raw_detections:
            obj = {
                "label":      d.get("label"),
                "confidence": d.get("confidence")
            }
            if "bbox" in d:
                obj["bbox"] = d.get("bbox")
            detected_objects.append(obj)

        summary = generate_surveillance_summary(detected_objects)

        # ── 2. Save frame to disk ──────────────────────────────────────────────
        frame_path, frame_saved = self._save_frame(frame, timestamp)

        # ── 3. Build MongoDB document ──────────────────────────────────────────
        document = {
            "timestamp":         timestamp,
            "frame_path":        frame_path,
            "detected_objects":  detected_objects,
            "summary":           summary,
            "object_count":      len(detected_objects),
            "mode":              "surveillance",
        }

        # ── 4. Persist to MongoDB ──────────────────────────────────────────────
        self._store(document)

        # ── 5. Return confirmed response (Strictly as requested) ───────────────
        return {
            "mode":             "surveillance",
            "summary":          summary,
            "detected_objects": detected_objects,
            "timestamp":        timestamp,
        }

    # ── Private helpers ────────────────────────────────────────────────────────

    def _save_frame(
        self,
        frame:     Optional[np.ndarray],
        timestamp: str,
    ) -> tuple[Optional[str], bool]:
        """Write the BGR frame to disk as a JPEG. Returns (path, success)."""
        if frame is None:
            return None, False
        try:
            safe_ts   = timestamp.replace(":", "-").replace("Z", "")
            filename  = f"surv_{safe_ts}_{uuid.uuid4().hex[:8]}.jpg"
            file_path = os.path.join(self.save_dir, filename)
            ok        = cv2.imwrite(file_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
            if ok:
                print(f"[surveillance] Frame saved → {file_path}")
                return file_path, True
            print("[surveillance] cv2.imwrite returned False")
            return None, False
        except Exception as e:
            print(f"[surveillance] Frame save error: {e}")
            return None, False

    def _store(self, document: dict) -> tuple[bool, Optional[str]]:
        """Insert document into MongoDB. Returns (success, inserted_id_str)."""
        try:
            result = self.collection.insert_one(document)
            return True, str(result.inserted_id)
        except Exception as e:
            print(f"[surveillance] MongoDB insert error: {e}")
            return False, None


# ── Functional wrapper (kept for backward compat with api/main.py) ─────────────

def run_surveillance_analysis(
    img_np:     np.ndarray,
    depth_norm: Optional[np.ndarray] = None,
) -> dict:
    """
    Convenience function: run full detection then pass to SurveillanceMode.

    Args:
        img_np:     H×W×3 uint8 RGB image.
        depth_norm: Optional normalised depth map.

    Returns:
        SurveillanceMode.handle() response dict.
    """
    detections   = run_yolo_with_depth(img_np, depth_norm)
    summary      = generate_surveillance_summary(detections)

    result = {
        "detections": detections,
        "summary":    summary,
    }

    # Convert to BGR for saving (run_yolo receives RGB)
    import cv2 as _cv2
    frame_bgr = _cv2.cvtColor(img_np, _cv2.COLOR_RGB2BGR)

    mode = SurveillanceMode()
    return mode.handle(result, frame_bgr)
