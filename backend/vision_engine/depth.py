"""
vision_engine/depth.py — MiDaS depth estimation & free-space detection.

Public API (in order of abstraction):

    estimate_depth(frame)                           ← primary real-time entry-point
        BGR/RGB uint8 frame → float32 depth map, same H×W as input.

    run_midas_raw(img_np)                           ← internal / lower-level
        RGB uint8 → float32 depth map. Used by the /upload pipeline.

    normalize_depth_map(depth_np)                  → np.ndarray [0, 1]
    depth_to_base64(depth_np, original_size)       → str  (base64 PNG)
    categorize_distance(avg_normalized_depth)      → str
    detect_free_space(depth_norm)                  → dict
"""

import base64
from typing import Optional

import cv2
import numpy as np
import torch

from models import device, midas, midas_transform


# ─────────────────────────────────────────────────────────────────────────────
# estimate_depth — real-time entry-point
# ─────────────────────────────────────────────────────────────────────────────

def estimate_depth(frame: np.ndarray) -> Optional[np.ndarray]:
    """
    Run MiDaS small on a single frame and return a depth map the same
    size as the input.

    Optimisations for real-time use:
      • torch.no_grad()  — disables autograd overhead.
      • bicubic interpolation back to original resolution in one GPU op.
      • No normalisation, no colourmap — caller decides what to do with
        the raw float values.
      • Accepts BGR (OpenCV default) or RGB — detects colour order via a
        channel-swap check; MiDaS expects RGB.

    Args:
        frame: H×W×3 uint8 numpy array (BGR or RGB).

    Returns:
        float32 numpy array of shape (H, W), same spatial size as `frame`.
        Values are raw inverse-depth (higher = closer).
        Returns None if the model is unavailable or inference fails.
    """
    if midas is None or midas_transform is None:
        return None

    h, w = frame.shape[:2]

    # MiDaS was trained on RGB — convert from BGR if needed.
    img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    try:
        input_batch = midas_transform(img_rgb).to(device)

        with torch.inference_mode():     # faster than no_grad; disables version tracking
            prediction = midas(input_batch)
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=(h, w),
                mode="bicubic",
                align_corners=False,
            ).squeeze()

        return prediction.cpu().numpy().astype(np.float32)

    except Exception as e:
        print(f"[depth] estimate_depth failed: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# run_midas_raw — used internally by the /upload async pipeline (RGB input)
# ─────────────────────────────────────────────────────────────────────────────

def run_midas_raw(img_np: np.ndarray) -> Optional[np.ndarray]:
    """
    Run MiDaS on an **RGB** uint8 image (PIL / np.array path).
    Returns a float32 depth map (same H×W) or None on failure.

    Use estimate_depth() for BGR OpenCV frames.
    """
    if midas is None or midas_transform is None:
        return None
    try:
        input_batch = midas_transform(img_np).to(device)
        with torch.inference_mode():
            prediction = midas(input_batch)
            prediction = torch.nn.functional.interpolate(
                prediction.unsqueeze(1),
                size=img_np.shape[:2],
                mode="bicubic",
                align_corners=False,
            ).squeeze()
        return prediction.cpu().numpy().astype(np.float32)
    except Exception as e:
        print(f"[depth] run_midas_raw failed: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Utility: normalisation
# ─────────────────────────────────────────────────────────────────────────────

def normalize_depth_map(depth_np: np.ndarray) -> np.ndarray:
    """
    Normalise a raw MiDaS output to [0, 1].
    MiDaS outputs **inverse** depth: higher value → object is **closer**.
    Returns a zero array if the map is flat (avoids divide-by-zero).
    """
    d_min, d_max = depth_np.min(), depth_np.max()
    if d_max - d_min > 1e-6:
        return ((depth_np - d_min) / (d_max - d_min)).astype(np.float32)
    return np.zeros_like(depth_np, dtype=np.float32)


# ─────────────────────────────────────────────────────────────────────────────
# Utility: visualisation
# ─────────────────────────────────────────────────────────────────────────────

def depth_to_base64(depth_np: np.ndarray, original_size: tuple) -> str:
    """
    Normalise → 8-bit → INFERNO colormap → resize to original_size (W, H)
    → base64-encoded PNG string.
    """
    depth_01  = normalize_depth_map(depth_np)
    depth_u8  = (depth_01 * 255).astype(np.uint8)
    depth_col = cv2.applyColorMap(depth_u8, cv2.COLORMAP_INFERNO)
    w, h      = original_size
    resized   = cv2.resize(depth_col, (w, h), interpolation=cv2.INTER_LINEAR)
    ok, buf   = cv2.imencode(".png", resized)
    return base64.b64encode(buf).decode("utf-8") if ok else ""


# ─────────────────────────────────────────────────────────────────────────────
# Utility: distance label
# ─────────────────────────────────────────────────────────────────────────────

def categorize_distance(avg_normalized_depth: float) -> str:
    """
    Map a normalised MiDaS depth value (0 = far, 1 = close) to a label.

    Thresholds tuned for typical indoor/outdoor scenes.
    """
    if avg_normalized_depth >= 0.75:
        return "Very Close"
    elif avg_normalized_depth >= 0.50:
        return "Near"
    elif avg_normalized_depth >= 0.25:
        return "Medium"
    return "Far"


# ─────────────────────────────────────────────────────────────────────────────
# Free-space detection (navigation suggestion)
# ─────────────────────────────────────────────────────────────────────────────

def detect_free_space(depth_norm: np.ndarray, encode_overlay: bool = True) -> dict:
    """
    encode_overlay=False skips the PNG/base64 step — use this for live
    video endpoints where the overlay is not rendered in the UI to avoid
    ~200 KB allocation per frame.
    """  # noqa: D205
    """
    Analyse the lower half of a normalised depth map and suggest a
    movement direction.

    Algorithm:
      1. Crop to lower half (ground / immediate path).
      2. Threshold at FREE_THRESHOLD — low depth = far = safe.
      3. Morphological open to remove noise.
      4. Connected-component analysis → largest safe region.
      5. Centre-bottom clearance check → forward/left/right/obstacle.
      6. Build a colour overlay for visualisation.

    Returns:
        {navigation, safe_ratio, free_mask_b64}
    """
    FREE_THRESHOLD = 0.40

    try:
        H, W   = depth_norm.shape
        half_y = H // 2
        lower  = depth_norm[half_y:, :]
        lH, lW = lower.shape

        # Threshold + morphological denoise
        binary = (lower < FREE_THRESHOLD).astype(np.uint8) * 255
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

        # Largest connected safe region
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            binary, connectivity=8
        )
        safe_ratio    = float((binary > 0).sum()) / (lH * lW)
        largest_label = max(
            range(1, num_labels),
            key=lambda l: stats[l, cv2.CC_STAT_AREA],
            default=0,
        )
        largest_mask = (
            (labels == largest_label).astype(np.uint8)
            if largest_label > 0
            else np.zeros((lH, lW), np.uint8)
        )

        # Centre-bottom clearance (10 % × 10 % patch)
        cx0, cx1    = int(lW * 0.40), int(lW * 0.60)
        cy0, cy1    = int(lH * 0.85), lH
        centre_safe = bool(largest_mask[cy0:cy1, cx0:cx1].mean() > 0.5)

        left_safe  = float(largest_mask[:, : lW // 2].mean())
        right_safe = float(largest_mask[:, lW // 2 :].mean())

        if centre_safe:
            navigation = "Move Forward"
        elif left_safe > right_safe and left_safe > 0.15:
            navigation = "Move Slightly Left"
        elif right_safe > left_safe and right_safe > 0.15:
            navigation = "Move Slightly Right"
        else:
            navigation = "Obstacle Ahead"

        # Colour overlay — skipped on live endpoints to avoid per-frame allocation
        free_mask_b64 = ""
        if encode_overlay:
            overlay = cv2.cvtColor((lower * 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
            overlay[largest_mask == 1] = (0, 200, 80)
            overlay[largest_mask == 0] = (overlay[largest_mask == 0] * 0.4).astype(np.uint8)
            colour = (0, 255, 0) if centre_safe else (0, 0, 255)
            cv2.rectangle(overlay, (cx0, cy0), (cx1, cy1 - 1), colour, 2)
            cv2.putText(
                overlay, navigation,
                (10, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.7,
                (0, 255, 0) if "Forward" in navigation else (0, 165, 255),
                2, cv2.LINE_AA,
            )
            ok, buf       = cv2.imencode(".png", overlay)
            free_mask_b64 = base64.b64encode(buf).decode("utf-8") if ok else ""

        return {
            "navigation":    navigation,
            "safe_ratio":    round(safe_ratio, 3),
            "free_mask_b64": free_mask_b64,
        }

    except Exception as e:
        print(f"[depth] detect_free_space failed: {e}")
        return {"navigation": "Obstacle Ahead", "safe_ratio": 0.0, "free_mask_b64": ""}
