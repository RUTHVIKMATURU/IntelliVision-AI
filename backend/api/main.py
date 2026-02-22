"""
api/main.py — Caption-vision FastAPI application.

All routes are defined here. Core AI logic is imported from:
  - models               (model singletons — loaded ONCE at startup)
  - vision_engine.*      (depth, spatial, priority, detection)
  - application_modes.*  (surveillance, assistive, self_driving)

Performance notes:
  • _decode_and_resize() centralises BGR decode + downscale (no duplication).
  • _LIVE_LOCK (asyncio.Semaphore) serialises GPU work on live endpoints —
    prevents memory blow-up when the browser sends frames faster than GPU
    can process them.  Excess requests receive an immediate 503.
  • _PerfTracker logs rolling avg FPS + ms to stdout every 30 frames.
  • Live endpoints pass encode_overlay=False to detect_free_space() to
    skip the ~200 KB/frame PNG allocation.
"""

import asyncio
import collections
import os
import shutil
import time
from datetime import datetime
from typing import Optional, Tuple

import cv2
import numpy as np
from bson import ObjectId
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pymongo import MongoClient

# ── Model singletons (loaded once on first import) ────────────────────────────
from models import blip_model, blip_processor, device  # noqa: F401

# ── Vision-engine modules ─────────────────────────────────────────────────────
from vision_engine.depth import (
    depth_to_base64,
    detect_free_space,
    normalize_depth_map,
    run_midas_raw,
)
from vision_engine.detection import run_yolo_with_depth
from vision_engine.spatial import generate_scene_description
from vision_engine.priority import apply_priority_filter

# ── Application mode handlers ────────────────────────────────────────────────
from application_modes.surveillance import SurveillanceMode
from application_modes.assistive    import AssistiveMode
from application_modes.self_driving import SelfDrivingMode

# ── Vision Pipeline ──────────────────────────────────────────────────────────
from vision_engine.pipeline import run_vision_pipeline

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Caption-vision API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# ── MongoDB ───────────────────────────────────────────────────────────────────
_mongo_client      = MongoClient("mongodb://localhost:27017/", serverSelectionTimeoutMS=3000)
_db                = _mongo_client["caption_vision_db"]
results_collection = _db["results"]


def _serialize(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    return doc


# ─────────────────────────────────────────────────────────────────────────────
# Performance helpers
# ─────────────────────────────────────────────────────────────────────────────

# One GPU at a time for live endpoints — excess requests get an instant 503
# rather than piling up and causing OOM.
_LIVE_LOCK = asyncio.Semaphore(1)


class _PerfTracker:
    """
    Rolling performance tracker.
    Logs average FPS and inference time to stdout every `print_every` frames.
    Thread-safe via deque (appendleft / popleft are atomic in CPython).
    """
    def __init__(self, window: int = 30, print_every: int = 30) -> None:
        self._ts:         collections.deque = collections.deque(maxlen=window)
        self._total_ms:   collections.deque = collections.deque(maxlen=window)
        self._window      = window
        self._print_every = print_every
        self._count       = 0
        self._label       = ""

    def record(self, total_ms: float, label: str = "") -> dict:
        """Record one frame. Returns {avg_fps, avg_total_ms} for the response."""
        now = time.perf_counter()
        self._ts.append(now)
        self._total_ms.append(total_ms)
        self._label = label or self._label
        self._count += 1

        # Compute rolling averages
        avg_ms  = sum(self._total_ms) / len(self._total_ms)
        if len(self._ts) >= 2:
            elapsed = self._ts[-1] - self._ts[0]
            avg_fps = round((len(self._ts) - 1) / elapsed, 1) if elapsed > 0 else 0.0
        else:
            avg_fps = 0.0

        if self._count % self._print_every == 0:
            print(
                f"[perf] {self._label or 'live'}  "
                f"avg_fps={avg_fps}  avg_ms={round(avg_ms, 1)}  "
                f"frames={self._count}"
            )
        return {"avg_fps": avg_fps, "avg_total_ms": round(avg_ms, 1)}


_perf = _PerfTracker(window=30, print_every=30)


def _decode_and_resize(
    raw_bytes: bytes,
    max_px: int = 640,
) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], int, int]:
    """
    Decode raw bytes to BGR, downscale so the longer edge ≤ max_px,
    and return (img_bgr, img_rgb, h, w).  Returns (None, None, 0, 0) on error.

    Centralises the decode + resize logic that was duplicated across
    /analyze-frame, /process-frame, and /depth.
    """
    arr = np.frombuffer(raw_bytes, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        return None, None, 0, 0

    h0, w0 = img_bgr.shape[:2]
    scale   = min(max_px / max(h0, w0), 1.0)
    if scale < 1.0:
        img_bgr = cv2.resize(
            img_bgr,
            (int(w0 * scale), int(h0 * scale)),
            interpolation=cv2.INTER_LINEAR,
        )

    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    h, w    = img_bgr.shape[:2]
    return img_bgr, img_rgb, h, w


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
def read_root():
    return {"message": "Caption-vision API is running", "device": device}


# ── /upload ───────────────────────────────────────────────────────────────────

@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    """
    Full analysis pipeline (BLIP + MiDaS + YOLO + free-space).
    BLIP and MiDaS run concurrently, then YOLO + free-space run concurrently.
    Result is persisted to MongoDB.
    """
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    detections: list  = []
    caption:    str   = ""
    depth_b64:  str   = ""
    free_space: dict  = {"navigation": "Unknown", "safe_ratio": 0.0, "free_mask_b64": ""}

    try:
        raw_image = Image.open(file_path).convert("RGB")
        max_size  = 800
        if max(raw_image.size) > max_size:
            ratio    = max_size / max(raw_image.size)
            raw_image = raw_image.resize(
                (int(raw_image.width * ratio), int(raw_image.height * ratio)),
                Image.Resampling.LANCZOS,
            )
        img_np = np.array(raw_image)

        # Use centralized vision pipeline
        pipeline_result = await run_vision_pipeline(
            img_np, 
            mode="surveillance", 
            run_caption=True,
            is_live=False
        )
        
        detections = pipeline_result["detections"]
        caption    = pipeline_result["caption"]
        depth_b64  = pipeline_result["depth_map"]
        navigation = pipeline_result["navigation"]
        free_space = {
            "navigation": navigation,
            "safe_ratio": pipeline_result["safe_ratio"],
            "free_mask_b64": pipeline_result["free_mask"]
        }

    except Exception as e:
        print(f"[api] /upload processing error: {e}")

    # Surveillance rules: filter detections
    surv_detections = [
        {"label": d["label"], "confidence": d["confidence"], "bbox": d.get("bbox")}
        for d in detections
    ]
    timestamp = datetime.now().isoformat()
    scene_description = pipeline_result["scene_description"]

    record = {
        "file_path":         file_path,
        "detections":        surv_detections,
        "caption":           caption,
        "navigation":        navigation,
        "scene_description": scene_description,
        "safe_ratio":        pipeline_result["safe_ratio"],
        "timestamp":         timestamp,
    }
    inserted_id = results_collection.insert_one(record).inserted_id

    # ── 5. Respond (Restored compatibility while keeping surveillance rules) ──
    return {
        "message":           "File uploaded and processed successfully",
        "id":                str(inserted_id),
        "mode":              "surveillance",
        "detections":        surv_detections,
        "caption":           caption,
        "scene_description": scene_description,
        "depth_map":         pipeline_result["depth_map"],
        "navigation":        navigation,
        "safe_ratio":        pipeline_result["safe_ratio"],
        "free_mask":         pipeline_result["free_mask"],
        "timestamp":         timestamp,
    }


# ── /analyze-frame ─────────────────────────────────────────────────────────────

@app.post("/analyze-frame")
async def analyze_frame(file: UploadFile = File(...)):
    """
    Real-time live-camera analysis.
    Semaphore ensures only one GPU inference runs at a time; excess browsers
    get a 503 rather than queueing and causing OOM.
    """
    if not _LIVE_LOCK.locked():
        await _LIVE_LOCK.acquire()
    else:
        raise HTTPException(status_code=503, detail="Server busy — retry in a moment")

    t_start = time.perf_counter()
    timing: dict = {}

    try:
        # 1. Decode + downscale to 640 px (centralised helper)
        t0 = time.perf_counter()
        raw = await file.read()
        img_bgr, img_rgb, h, w = await asyncio.to_thread(
            _decode_and_resize, raw, 640
        )
        if img_bgr is None:
            raise HTTPException(status_code=400, detail="Could not decode frame")
        timing["decode_resize_ms"] = round((time.perf_counter() - t0) * 1000, 1)

        # 2. Run Vision Pipeline (Surveillance context)
        pipeline_result = await run_vision_pipeline(
            img_rgb, 
            mode="surveillance", 
            run_caption=True,
            is_live=True
        )
        
        detections = pipeline_result["detections"]
        navigation = pipeline_result["navigation"]
        scene_desc = pipeline_result["scene_description"]
        depth_b64  = pipeline_result["depth_map"]
        
        timing.update(pipeline_result["timing"])
        timing["total_ms"]       = round((time.perf_counter() - t_start) * 1000, 1)

        # 5. Rolling FPS tracker
        perf = _perf.record(timing["total_ms"], label="analyze-frame")
        timing["avg_fps"]      = perf["avg_fps"]
        timing["avg_total_ms"] = perf["avg_total_ms"]

        print(
            f"[api] /analyze-frame  "
            f"dr={timing.get('decode_resize_ms')}ms  "
            f"midas={timing.get('midas_ms')}ms  "
            f"yolo={timing.get('yolo_ms')}ms  "
            f"free={timing.get('free_space_ms')}ms  "
            f"total={timing['total_ms']}ms  "
            f"fps={timing['avg_fps']}"
        )

        # 5. Respond (Restored compatibility + caption)
        return {
            "mode":              "surveillance",
            "detections":        [
                # Minimal info as requested for surveillance
                {"label": d["label"], "confidence": d["confidence"], "bbox": d.get("bbox")}
                for d in detections
            ],
            "navigation":        navigation,
            "safe_ratio":        pipeline_result["safe_ratio"],
            "scene_description": scene_desc,
            "caption":           caption,
            "depth_map":         depth_b64,
            "free_mask":         "",
            "frame_width":       w,
            "frame_height":      h,
            "timing_ms":         timing,
            "urgent_count":      0, # No urgency in surveillance
            "timestamp":         datetime.now().isoformat(),
        }

    finally:
        _LIVE_LOCK.release()


# ── /depth (lightweight alias) ────────────────────────────────────────────────

@app.post("/depth")
async def estimate_depth(file: UploadFile = File(...)):
    """Depth map only — no YOLO, no free-space. Fast visualisation endpoint."""
    try:
        contents  = await file.read()
        img_array = np.frombuffer(contents, dtype=np.uint8)
        img_bgr   = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img_bgr is None:
            return {"depth_map": "", "error": "Could not decode image"}

        img_rgb   = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        max_size  = 512
        h, w      = img_rgb.shape[:2]
        if max(h, w) > max_size:
            ratio   = max_size / max(h, w)
            img_rgb = cv2.resize(img_rgb, (int(w * ratio), int(h * ratio)))

        depth_raw = await asyncio.to_thread(run_midas_raw, img_rgb)
        if depth_raw is None:
            return {"depth_map": ""}
        return {"depth_map": depth_to_base64(depth_raw, (img_rgb.shape[1], img_rgb.shape[0]))}

    except Exception as e:
        print(f"[api] /depth error: {e}")
        return {"depth_map": "", "error": str(e)}


# ── /process-frame ─────────────────────────────────────────────────────────────

_PROCESS_VALID_MODES: frozenset[str] = frozenset({"surveillance", "assistive", "self_driving"})
# Map each mode to a human-readable model name for logs
_MODE_MODEL_LABEL: dict[str, str] = {
    "surveillance": "COCO  (yolo26n.onnx)",
    "assistive":    "COCO  (yolo26n.onnx)",
    "self_driving": "KITTI (best.onnx)",
}

@app.post("/process-frame")
async def process_frame(
    file: UploadFile = File(...),
    mode: str        = Form("surveillance"),   # sent as a form field, same multipart body
):
    """
    Mode-aware frame processing (surveillance / assistive / self_driving).

    ``mode`` is accepted as a **form field** so clients send it in the same
    multipart/form-data body as the frame file — no query-string needed.

    Validation and model-selection logging happen *before* any GPU work so
    an invalid mode returns a fast 400 without wasting compute.
    """
    # ── 0. Validate mode & log model selection (before GPU work) ────────────
    if mode not in _PROCESS_VALID_MODES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid mode '{mode}'. "
                f"Must be one of: {sorted(_PROCESS_VALID_MODES)}"
            ),
        )

    model_label  = _MODE_MODEL_LABEL[mode]
    is_upload    = (mode == "surveillance")   # surveillance persists the frame
    print(f"[api] /process-frame — mode={mode}  model={model_label}")

    # ── Semaphore: one GPU inference at a time ───────────────────────────────
    if not _LIVE_LOCK.locked():
        await _LIVE_LOCK.acquire()
    else:
        raise HTTPException(status_code=503, detail="Server busy — retry in a moment")

    t_start = time.perf_counter()
    timing:  dict = {}

    try:
        # 1. Decode + downscale to 640 px max edge
        t0 = time.perf_counter()
        raw = await file.read()
        img_bgr, img_rgb, h, w = await asyncio.to_thread(
            _decode_and_resize, raw, 640
        )
        if img_bgr is None:
            raise HTTPException(status_code=400, detail="Could not decode frame")
        timing["decode_resize_ms"] = round((time.perf_counter() - t0) * 1000, 1)

        # 2. Run Vision Pipeline (Mode-aware)
        pipeline_result = await run_vision_pipeline(
            img_rgb, 
            mode=mode, 
            run_caption=(mode == "assistive" or mode == "surveillance"),
            is_live=not is_upload
        )
        
        detections = pipeline_result["detections"]
        navigation = pipeline_result["navigation"]
        scene_desc = pipeline_result["scene_description"]
        depth_b64  = pipeline_result["depth_map"]
        depth_norm = pipeline_result["depth_norm"]
        
        timing.update(pipeline_result["timing"])

        shared_result = {
            "detections":        detections,
            "navigation":        navigation,
            "safe_ratio":        pipeline_result["safe_ratio"],
            "scene_description": scene_desc,
        }

        # 5. Mode handler dispatch
        t0 = time.perf_counter()
        if mode == "surveillance":
            mode_response = SurveillanceMode().handle(shared_result, img_bgr)
        elif mode == "assistive":
            mode_response = AssistiveMode().handle(shared_result)
        else:  # self_driving
            mode_response = SelfDrivingMode().handle(shared_result, depth_norm)

        timing["mode_ms"]  = round((time.perf_counter() - t0) * 1000, 1)
        timing["total_ms"] = round((time.perf_counter() - t_start) * 1000, 1)

        # 6. Rolling FPS tracker
        perf = _perf.record(timing["total_ms"], label=f"process/{mode}")
        timing["avg_fps"]      = perf["avg_fps"]
        timing["avg_total_ms"] = perf["avg_total_ms"]

        print(
            f"[api] /process-frame ({mode})  "
            f"model={model_label}  "
            f"dr={timing.get('decode_resize_ms')}ms  "
            f"midas={timing.get('midas_ms')}ms  "
            f"yolo={timing.get('yolo_ms')}ms  "
            f"free={timing.get('free_space_ms')}ms  "
            f"mode={timing.get('mode_ms')}ms  "
            f"total={timing['total_ms']}ms  "
            f"fps={timing['avg_fps']}"
        )

        # 7. Unified structured response
        # 7. Unified structured response
        response = {
            "mode":              mode,
            "model":             model_label,
            "frame_width":       w,
            "frame_height":      h,
            "detections":        detections,
            "navigation":        navigation,
            "safe_ratio":        pipeline_result["safe_ratio"],
            "scene_description": scene_desc,
            "caption":           pipeline_result["caption"],
            "depth_map":         depth_b64,
            "free_mask":         pipeline_result["free_mask"],
            "timing_ms":         timing,
            "urgent_count":      sum(1 for d in detections if d.get("urgency")),
            **mode_response,     # Includes summary/detected_objects for surveillance
        }
        
        # If surveillance, we might want to override detections with the filtered ones from mode_response
        if mode == "surveillance" and "detected_objects" in mode_response:
             response["detections"] = mode_response["detected_objects"]
             # Keep scene_description as the one from pipeline (which includes caption) 
             # and put surveillance count-based summary in 'summary' field.
             response["summary"] = mode_response.get("summary", "")

        return response

    finally:
        _LIVE_LOCK.release()



# ── /history & /delete ────────────────────────────────────────────────────────

@app.get("/history")
def get_history():
    history = list(results_collection.find().sort("timestamp", -1))
    return [_serialize(doc) for doc in history]


@app.delete("/delete/{id}")
def delete_result(id: str):
    try:
        res = results_collection.delete_one({"_id": ObjectId(id)})
        if res.deleted_count == 1:
            return {"message": "Record deleted successfully"}
        return {"message": "Record not found"}
    except Exception as e:
        return {"message": "Invalid ID format", "error": str(e)}
