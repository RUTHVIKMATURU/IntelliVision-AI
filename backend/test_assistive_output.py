
import sys
import os
import numpy as np
from unittest.mock import MagicMock

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from application_modes.assistive import AssistiveMode

def test_assistive_output():
    print("Testing AssistiveMode output...")
    
    mode = AssistiveMode()
    
    # Mock detection result with 'alert' already present
    # (In real flow, run_yolo_with_depth or detections pipe adds these)
    test_result = {
        "navigation": "Move Slightly Left",
        "safe_ratio": 0.85,
        "detections": [
            {
                "label": "person", 
                "direction": "Center", 
                "distance": "Very Close", 
                "urgency": True,
                "alert": "Person detected directly ahead at a very close distance. URGENT!"
            },
            {
                "label": "car", 
                "direction": "Right", 
                "distance": "Near", 
                "urgency": False,
                "alert": "Car detected on your right nearby."
            }
        ]
    }
    
    # Run handle
    output = mode.handle(test_result)
    
    print("\nOutput keys:", output.keys())
    print("Scene Description:", output.get("scene_description"))
    print("Navigation Spoken:", output.get("navigation_spoken"))
    print("Urgent Alerts:", output.get("urgent_alerts"))
    
    # Assertions
    required_keys = ["timestamp", "navigation", "navigation_spoken", "scene_description", "urgent_alerts", "all_alerts"]
    for key in required_keys:
        if key not in output:
            print(f"FAILED: Missing key '{key}' in output.")
            return False
            
    if "Steer slightly left" not in output["navigation_spoken"]:
        print("FAILED: Navigation spoken instruction missing or wrong.")
        return False
        
    if not any("URGENT" in alert for alert in output["urgent_alerts"]):
        print("FAILED: Urgent alert missing from 'urgent_alerts'.")
        return False

    if "directly ahead" not in output["scene_description"].lower():
        print("FAILED: Spatial direction missing from scene description.")
        return False

    # Check for image storage or DB paths
    forbidden_keys = ["frame_path", "frame_saved", "id", "stored_in_db"]
    for key in forbidden_keys:
        if key in output:
            print(f"FAILED: Forbidden key '{key}' found in assistive output (leaked from surveillance?).")
            return False
            
    print("\nSUCCESS: AssistiveMode output is correct and preserves assistive features.")
    return True

if __name__ == "__main__":
    if test_assistive_output():
        sys.exit(0)
    else:
        sys.exit(1)
