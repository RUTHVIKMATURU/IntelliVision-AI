"""
vision_engine/pipeline.py — Centralized vision processing pipeline.

Encapsulates YOLO, MiDaS, and free-space detection logic into a single,
mode-aware entry point. 
"""

import asyncio
import time
from typing import Optional, Dict, Any

import numpy as np
from vision_engine.depth import (
    run_midas_raw,
    normalize_depth_map,
    detect_free_space,
    depth_to_base64
)
from vision_engine.detection import run_yolo_with_depth
from vision_engine.spatial import generate_scene_description
from models import blip_model, blip_processor, device

async def run_vision_pipeline(
    img_rgb: np.ndarray,
    mode: str,
    run_caption: bool = False,
    is_live: bool = False,
) -> Dict[str, Any]:
    """
    Execute the vision pipeline based on the specified mode.
    
    Args:
        img_rgb: H×W×3 uint8 RGB image.
        mode:    Application mode ("surveillance", "assistive", "self_driving").
        caption: Optional BLIP caption.
        is_live: If True, skips high-overhead visualisations (like free-space mask).
        
    Returns:
        Dict containing detections, navigation, scene_description, 
        and optionally depth/free-space metadata.
    """
    timing = {}
    start_time = time.perf_counter()
    caption = ""
    
    # 1. Depth Estimation (Mode-dependent)
    depth_raw = None
    depth_norm = None
    depth_b64 = ""
    
    run_depth = (mode != "surveillance")
    
    if run_depth:
        print("Depth model used (assistive/self_driving mode)")
        t0 = time.perf_counter()
        depth_raw = await asyncio.to_thread(run_midas_raw, img_rgb)
        timing["midas_ms"] = round((time.perf_counter() - t0) * 1000, 1)
        
        if depth_raw is not None:
            depth_norm = normalize_depth_map(depth_raw)
            h, w = img_rgb.shape[:2]
            depth_b64 = depth_to_base64(depth_raw, (w, h))
    else:
        print("Depth model skipped (surveillance mode)")
        timing["midas_ms"] = 0
        
    # 2. YOLO & Free-space & Caption (Concurrent)
    def _run_blip():
        if not blip_model or not blip_processor:
            return ""
        try:
            import torch
            from PIL import Image
            raw_image = Image.fromarray(img_rgb)
            inputs = blip_processor(raw_image, return_tensors="pt").to(device)
            with torch.inference_mode():
                out = blip_model.generate(**inputs, max_new_tokens=50)
            return blip_processor.decode(out[0], skip_special_tokens=True)
        except Exception as e:
            print(f"[pipeline] BLIP failed: {e}")
            return ""

    def _yolo():
        t = time.perf_counter()
        res = run_yolo_with_depth(img_rgb, depth_norm, mode=mode)
        timing["yolo_ms"] = round((time.perf_counter() - t) * 1000, 1)
        return res

    def _free_space():
        if depth_norm is None:
            return {"navigation": "Unknown", "safe_ratio": 0.0, "free_mask_b64": ""}
        t = time.perf_counter()
        res = detect_free_space(depth_norm, encode_overlay=not is_live)
        timing["free_space_ms"] = round((time.perf_counter() - t) * 1000, 1)
        return res

    tasks = []
    tasks.append(asyncio.to_thread(_yolo))
    if run_depth:
        tasks.append(asyncio.to_thread(_free_space))
    if run_caption:
        tasks.append(asyncio.to_thread(_run_blip))

    results = await asyncio.gather(*tasks)
    
    # Unpack results in order
    idx = 0
    detections = results[idx]
    idx += 1
    
    if run_depth:
        free_space = results[idx]
        idx += 1
    else:
        free_space = {"navigation": "Unknown", "safe_ratio": 0.0, "free_mask_b64": ""}
        timing["free_space_ms"] = 0

    if run_caption:
        caption = results[idx]
        idx += 1
    else:
        caption = ""
        
    # 3. Scene Description
    t0 = time.perf_counter()
    navigation = free_space.get("navigation", "Unknown")
    scene_desc = generate_scene_description(detections, navigation, caption)
    timing["description_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    
    timing["pipeline_total_ms"] = round((time.perf_counter() - start_time) * 1000, 1)
    
    return {
        "detections":        detections,
        "navigation":        navigation,
        "safe_ratio":        free_space.get("safe_ratio", 0.0),
        "scene_description": scene_desc,
        "caption":           caption,
        "depth_map":         depth_b64,
        "free_mask":         free_space.get("free_mask_b64", ""),
        "timing":            timing,
        # Internal state for mode handlers
        "depth_norm":        depth_norm,
        "depth_raw":         depth_raw
    }
