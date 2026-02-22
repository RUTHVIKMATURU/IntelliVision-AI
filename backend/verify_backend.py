import sys
import os
import numpy as np
import torch

# Add backend to sys.path
backend_dir = r"c:\Users\ruthv\OneDrive\Desktop\Summer project\ROD_IDS\backend"
sys.path.append(backend_dir)

from vision_engine.detection import detect_objects, run_yolo_with_depth
from models import device

def test_modes():
    print(f"--- Starting Backend Verification on {device} ---")
    
    # Mock frame (BGR for OpenCV)
    dummy_frame = np.zeros((480, 640, 3), dtype=np.uint8)
    
    modes = ["self_driving", "surveillance", "assistive"]
    
    for mode in modes:
        print(f"\n[Test] Testing Mode: {mode}")
        try:
            # Test simple detection
            dets = detect_objects(dummy_frame, mode=mode)
            print(f"  detect_objects count: {len(dets)}")
            
            # Test pipeline (requires depth_norm mock)
            dummy_depth = np.zeros((480, 640), dtype=np.float32)
            # detect_objects expects BGR, run_yolo_with_depth expects RGB (as per its docstring)
            dummy_frame_rgb = np.zeros((480, 640, 3), dtype=np.uint8)
            dets_pipeline = run_yolo_with_depth(dummy_frame_rgb, dummy_depth, mode=mode)
            print(f"  run_yolo_with_depth count: {len(dets_pipeline)}")
            
        except Exception as e:
            print(f"  [Error] {mode}: {e}")

if __name__ == "__main__":
    test_modes()
