"""
vision_engine/pipeline.py — Centralized vision processing pipeline.

Encapsulates YOLO, MiDaS, and free-space detection logic into a single,
mode-aware entry point. 
"""

import asyncio
import time
from typing import Optional, Dict, Any
from collections import Counter

import cv2
import numpy as np
from vision_engine.depth import (
    run_midas_raw,
    normalize_depth_map,
    detect_free_space,
    depth_to_base64,
    categorize_distance
)
from vision_engine.detection import run_yolo_with_depth, detect_objects
from vision_engine.spatial import (
    generate_scene_description,
    get_horizontal_zone,
    get_vertical_zone,
    generate_video_summary
)
from models import blip_model, blip_processor, device
import torch
from PIL import Image

def _run_blip_on_frame(img_rgb: np.ndarray) -> str:
    """Helper to run BLIP on a single RGB frame."""
    if not blip_model or not blip_processor:
        return ""
    try:
        raw_image = Image.fromarray(img_rgb)
        inputs = blip_processor(raw_image, return_tensors="pt").to(device)
        with torch.inference_mode():
            out = blip_model.generate(**inputs, max_new_tokens=50)
        return blip_processor.decode(out[0], skip_special_tokens=True)
    except Exception as e:
        print(f"[pipeline] BLIP failed: {e}")
        return ""

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
        
    # 2. Parallel Processing (YOLO, BLIP, Free Space)
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
        tasks.append(asyncio.to_thread(_run_blip_on_frame, img_rgb))

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
    scene_desc = generate_scene_description(detections, navigation, caption, mode=mode)
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

def _resize_if_needed(img: np.ndarray, max_edge: int = 640) -> np.ndarray:
    """Resize image if its longest edge exceeds max_edge while preserving aspect ratio."""
    h, w = img.shape[:2]
    if max(h, w) <= max_edge:
        return img
    
    scale = max_edge / max(h, w)
    new_size = (int(w * scale), int(h * scale))
    return cv2.resize(img, new_size, interpolation=cv2.INTER_AREA)

async def process_video(
    video_path: str,
    mode: str = "surveillance",
) -> Dict[str, Any]:
    """
    Open a video file, sample one frame every 5 seconds,
    and run the vision pipeline on each sampled frame.
    
    Limits:
      - Samples capped at 20 frames to avoid memory overload.
      - Efficient seeking via CAP_PROP_POS_FRAMES.
    """
    MAX_SAMPLED_FRAMES = 20
    SAMPLING_INTERVAL_SEC = 5

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return {"error": "Could not open video file"}

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps          = cap.get(cv2.CAP_PROP_FPS)
    duration     = total_frames / fps if fps > 0 else 0
    
    if fps <= 0:
        cap.release()
        return {"error": "Invalid video FPS"}

    interval_frames = int(fps * SAMPLING_INTERVAL_SEC)
    sampled_indices = range(0, total_frames, interval_frames)
    
    # Apply memory limit
    if len(list(sampled_indices)) > MAX_SAMPLED_FRAMES:
        print(f"[pipeline] Video too long ({len(list(sampled_indices))} samples). Capping at {MAX_SAMPLED_FRAMES}.")
        sampled_indices = list(sampled_indices)[:MAX_SAMPLED_FRAMES]

    metadata = {
        "duration_sec": round(duration, 2),
        "fps": round(fps, 2),
        "total_frames": total_frames,
        "sampling_interval_sec": SAMPLING_INTERVAL_SEC,
        "total_samples": len(sampled_indices)
    }

    frame_summaries = []
    import base64
    
    start_total = time.perf_counter()
    try:
        for f_idx in sampled_indices:
            f_start = time.perf_counter()
            
            # Efficient seek
            cap.set(cv2.CAP_PROP_POS_FRAMES, f_idx)
            success, frame_raw = cap.read()
            if not success or frame_raw is None:
                continue

            # 0. Optimize: Resize before any inference
            frame_bgr = _resize_if_needed(frame_raw, 640)

            # 1. Call detect_objects
            detections = detect_objects(frame_bgr, mode)
            
            # 2. Conditional depth estimation
            navigation = "Unknown"
            depth_norm = None
            img_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            
            if mode != "surveillance":
                depth_raw = await asyncio.to_thread(run_midas_raw, img_rgb)
                if depth_raw is not None:
                    depth_norm = normalize_depth_map(depth_raw)
                    free_space = detect_free_space(depth_norm, encode_overlay=False)
                    navigation = free_space["navigation"]
                    
                    # Enrich detections for summary
                    h, w = frame_bgr.shape[:2]
                    for d in detections:
                        x1, y1, x2, y2 = d["bbox"]
                        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                        d["direction"] = get_horizontal_zone(cx, w)
                        roi = depth_norm[y1:y2, x1:x2]
                        if roi.size > 0:
                            d["distance"] = categorize_distance(float(roi.mean()))
            else:
                # Simple spatial enrichment for surveillance
                h, w = frame_bgr.shape[:2]
                for d in detections:
                    x1, y1, x2, y2 = d["bbox"]
                    cx = (x1 + x2) / 2
                    d["direction"] = get_horizontal_zone(cx, w)

            # 3. Generate frame summary
            caption = ""
            if mode != "self_driving":
                caption = await asyncio.to_thread(_run_blip_on_frame, img_rgb)
            
            summary_text = generate_scene_description(detections, navigation, caption)
            
            f_end = time.perf_counter()
            f_ms = round((f_end - f_start) * 1000, 1)
            print(f"[pipeline] Frame {f_idx} processed in {f_ms}ms")

            # 4. Store per-frame data
            frame_data = {
                "timestamp_sec": round(f_idx / fps, 2),
                "frame_index": f_idx,
                "caption": caption,
                "summary": summary_text,
                "detections": detections,
                "processing_ms": f_ms
            }
            
            # 5. Store raw frame if surveillance (User requirement)
            if mode == "surveillance":
                ok, buf = cv2.imencode(".jpg", frame_bgr)
                if ok:
                    frame_data["raw_frame_b64"] = base64.b64encode(buf).decode("utf-8")
            
            frame_summaries.append(frame_data)
            
            # Prevent memory accumulation by freeing large objects
            del img_rgb
            if depth_norm is not None: del depth_norm

    except Exception as e:
        print(f"[pipeline] process_video error during loop: {e}")
    finally:
        cap.release()

    total_processing_ms = round((time.perf_counter() - start_total) * 1000, 1)
    print(f"[pipeline] Total video processing time: {total_processing_ms}ms")
    metadata["total_processing_ms"] = total_processing_ms

    # Post-processing: Aggregation and Deduplication
    all_labels = []
    for f in frame_summaries:
        for d in f["detections"]:
            all_labels.append(d["label"])
    
    counter = Counter(all_labels)
    
    deduplicated_summaries = []
    seen_summaries = set()
    for f in frame_summaries:
        if f["summary"] not in seen_summaries:
            deduplicated_summaries.append(f)
            seen_summaries.add(f["summary"])

    aggregated_stats = {
        "total_frames_analyzed": len(sampled_indices),
        "object_counts": dict(counter),
        "most_frequent_objects": [obj for obj, count in counter.most_common(3)],
        "unique_events_detected": len(deduplicated_summaries)
    }
    
    aggregated_stats["video_summary"] = generate_video_summary(aggregated_stats, mode)

    return {
        "metadata": metadata,
        "frame_summaries": deduplicated_summaries,
        "aggregated_stats": aggregated_stats
    }
