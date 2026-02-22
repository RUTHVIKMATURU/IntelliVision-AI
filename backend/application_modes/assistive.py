"""
application_modes/assistive.py — Real-time assistive navigation pipeline.

AssistiveMode is designed for visually-impaired navigation assistance.

Design constraints:
  • NO image storage — frames are processed and discarded immediately.
  • NO database writes — zero I/O latency impact.
  • Minimal JSON output — only what a TTS / audio UI needs.
  • Urgency alerts surfaced first in every response.

Usage:
    mode = AssistiveMode()
    response = mode.handle(result)

Where `result` is the dict returned by run_yolo_with_depth() / detect_objects().
"""

from datetime import datetime, timezone
from typing import Optional

from vision_engine.detection import run_yolo_with_depth
from vision_engine.depth import detect_free_space
from vision_engine.priority import apply_priority_filter, get_priority
from vision_engine.spatial import (
    generate_assistive_caption,
    generate_navigation_instruction,
)

import numpy as np

# Minimum priority level to include in assistive output
_ASSISTIVE_PRIORITY_MIN = 2



class AssistiveMode:
    """
    Assistive application mode — zero-storage, low-latency.

    Processes detection results, filters to safety-relevant objects,
    ranks by urgency and priority, and returns a minimal structured
    response optimised for audio/TTS consumption.

    No frames are written to disk. No database calls are made.
    """

    def handle(self, result: dict) -> dict:
        """
        Process a detection result for assistive navigation output.

        Args:
            result: Dict with at minimum:
                      "detections"        – list[dict] from run_yolo_with_depth
                      "navigation"        – str
                      "scene_description" – str  (optional, regenerated if absent)

        Returns:
            Minimal structured dict (no binary data, no paths):
            {
                "timestamp":         str,          # ISO-8601 UTC
                "navigation":        str,          # human direction
                "navigation_spoken": str,          # TTS-friendly short phrase
                "scene_description": str,          # NL paragraph
                "urgent_alerts":     list[str],    # urgent alert sentences, priority order
                "all_alerts":        list[str],    # all alert sentences
                "urgent_count":      int,
                "object_count":      int,
                "safe_ratio":        float,
            }
        """
        timestamp  = datetime.now(timezone.utc).isoformat(timespec="seconds")
        raw_dets   = result.get("detections", [])
        navigation = result.get("navigation", "Unknown")
        safe_ratio = result.get("safe_ratio", 0.0)

        # ── 1. Filter by priority level (dynamic per model) ───────────────────
        # This replaces hardcoded label lists.
        filtered = [
            d for d in raw_dets
            if get_priority(d.get("label", "")) >= _ASSISTIVE_PRIORITY_MIN
        ]

        # ── 2. Apply priority filter + urgency flag ────────────────────────────
        detections = apply_priority_filter(filtered)

        # ── 3. Build scene description (regenerate if not provided) ────────────
        scene_description = generate_assistive_caption(detections, result.get("caption", ""))

        # ── 4. Extract navigation instruction ──────────────────────────────────
        navigation_spoken = generate_navigation_instruction(navigation)

        # ── 4. Extract alert sentences (urgent first — already sorted) ─────────
        urgent_alerts = [
            d["alert"] for d in detections if d.get("urgency")
        ]
        all_alerts = [d["alert"] for d in detections if d.get("alert")]

        return {
            "timestamp":         timestamp,
            "navigation":        navigation,
            "navigation_spoken": navigation_spoken,
            "scene_description": scene_description,
            "urgent_alerts":     urgent_alerts,
            "all_alerts":        all_alerts,
            "urgent_count":      len(urgent_alerts),
            "object_count":      len(detections),
            "safe_ratio":        round(float(safe_ratio), 3),
        }


# ── Functional wrapper (backward compat with api/main.py) ─────────────────────

def run_assistive_analysis(
    img_np:     np.ndarray,
    depth_norm: Optional[np.ndarray] = None,
    caption:    str = "",
) -> dict:
    """
    Convenience wrapper: run detection pipeline then pass to AssistiveMode.

    Args:
        img_np:     H×W×3 uint8 RGB image.
        depth_norm: Optional normalised depth map.
        caption:    Optional BLIP caption for richer scene description.

    Returns:
        AssistiveMode.handle() response dict.
    """
    detections = run_yolo_with_depth(img_np, depth_norm)

    free_space = (
        detect_free_space(depth_norm)
        if depth_norm is not None
        else {"navigation": "Unknown", "safe_ratio": 0.0}
    )

    scene_description = generate_assistive_caption(detections, caption)

    result = {
        "detections":        detections,
        "navigation":        free_space["navigation"],
        "safe_ratio":        free_space.get("safe_ratio", 0.0),
        "scene_description": scene_description,
    }

    return AssistiveMode().handle(result)
