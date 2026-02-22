import os
import sys

# Add backend to sys.path to import models
backend_dir = r"c:\Users\ruthv\OneDrive\Desktop\Summer project\ROD_IDS\backend"
sys.path.append(backend_dir)

try:
    from models import kitti_model, coco_model
    
    if kitti_model:
        print("KITTI Classes:")
        print(kitti_model.names)
    else:
        print("KITTI model not loaded.")
        
    if coco_model:
        print("\nCOCO Classes:")
        print(coco_model.names)
    else:
        print("COCO model not loaded.")
except Exception as e:
    print(f"Error: {e}")
