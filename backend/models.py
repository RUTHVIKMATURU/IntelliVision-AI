"""
models.py — Shared AI model singletons for Caption-vision.

All models are loaded here exactly once at import time.  Every other module
imports from this file so there is no duplicate loading across workers or
requests.

Performance notes:
  • All models are set to .eval() mode — disables batch-norm / dropout.
  • torch.inference_mode() is used at call sites (depth.py) for the
    lowest possible autograd overhead — faster than no_grad().
  • No model is ever re-loaded after startup.
  • YOLO models are keyed by application mode in the `models` dict so
    each mode picks the specialised weights it was trained on.

Exports:
    device          – 'cuda' | 'cpu'
    models          – dict: {"self_driving": YOLO, "surveillance": YOLO,
                             "assistive": YOLO}
    kitti_model     – ultralytics.YOLO (best.onnx,  KITTI classes)
    coco_model      – ultralytics.YOLO (yolo26n.onnx, COCO classes)
    blip_processor  – BlipProcessor         | None
    blip_model      – BlipForConditionalGen | None
    midas           – torch.nn.Module       | None
    midas_transform – callable              | None
"""

import os
import torch
from ultralytics import YOLO
from transformers import BlipProcessor, BlipForConditionalGeneration

# ── Device ─────────────────────────────────────────────────────────────────────
device: str = "cuda" if torch.cuda.is_available() else "cpu"
print(f"[Caption-vision] Device: {device}")

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR      = os.path.join(BASE_DIR, "Model_Training_Testing")
KITTI_PATH     = os.path.join(MODEL_DIR, "best.onnx")     # self-driving
COCO_PATH      = os.path.join(MODEL_DIR, "yolo26n.onnx")  # surveillance / assistive

# ── YOLO — KITTI model (self-driving) ─────────────────────────────────────────
try:
    kitti_model = YOLO(KITTI_PATH, task="detect")
    print(f"[Caption-vision] KITTI model loaded  ({KITTI_PATH})")
except Exception as e:
    print(f"[Caption-vision] KITTI model load error: {e}")
    kitti_model = None

# ── YOLO — COCO model (surveillance & assistive) ──────────────────────────────
try:
    coco_model = YOLO(COCO_PATH, task="detect")
    print(f"[Caption-vision] COCO model loaded   ({COCO_PATH})")
except Exception as e:
    print(f"[Caption-vision] COCO model load error: {e}")
    coco_model = None

# ── Mode-keyed model dictionary ───────────────────────────────────────────────
# Each application mode picks the YOLO weights it was trained on.
# detection.py imports this dict and calls models[mode] at inference time.
models: dict = {
    "self_driving": kitti_model,
    "surveillance": coco_model,
    "assistive":    coco_model,
}

_loaded = {k for k, v in models.items() if v is not None}
if _loaded:
    print(f"[Caption-vision] Model dispatch ready: {sorted(_loaded)}")
else:
    print("[Caption-vision] WARNING — no YOLO models loaded; detections will be empty.")

# ── BLIP ───────────────────────────────────────────────────────────────────────
try:
    blip_processor = BlipProcessor.from_pretrained(
        "Salesforce/blip-image-captioning-base"
    )
    blip_model = (
        BlipForConditionalGeneration
        .from_pretrained("Salesforce/blip-image-captioning-base")
        .to(device)
        .eval()                          # disable dropout / train-only ops
    )
    print("[Caption-vision] BLIP loaded.")
except Exception as e:
    print(f"[Caption-vision] BLIP load error: {e}")
    blip_processor = None
    blip_model     = None

# ── MiDaS (small) ─────────────────────────────────────────────────────────────
try:
    midas = torch.hub.load("intel-isl/MiDaS", "MiDaS_small", trust_repo=True)
    midas.to(device).eval()              # eval() disables dropout in backbone
    _transforms     = torch.hub.load("intel-isl/MiDaS", "transforms", trust_repo=True)
    midas_transform = _transforms.small_transform
    # Warm-up pass — fills CUDA kernel cache so first real request is not slow
    if device == "cuda":
        import numpy as _np
        _dummy = _np.zeros((256, 256, 3), dtype=_np.uint8)
        with torch.inference_mode():
            _t = midas_transform(_dummy).to(device)
            midas(_t)
        del _dummy, _t
        print("[Caption-vision] MiDaS CUDA warm-up done.")
    print("[Caption-vision] MiDaS loaded.")
except Exception as e:
    print(f"[Caption-vision] MiDaS load error: {e}")
    midas           = None
    midas_transform = None
