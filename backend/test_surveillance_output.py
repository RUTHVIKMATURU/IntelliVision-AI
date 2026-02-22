
import sys
import os
import numpy as np
from unittest.mock import MagicMock

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from application_modes.surveillance import SurveillanceMode
from vision_engine.spatial import generate_surveillance_summary

def test_surveillance_output():
    print("Testing SurveillanceMode output...")
    
    # Mock MongoDB collection
    mock_collection = MagicMock()
    mock_collection.insert_one.return_value.inserted_id = "test_id"
    
    mode = SurveillanceMode(collection=mock_collection)
    
    # Mock detection result
    test_result = {
        "detections": [
            {"label": "person", "direction": "Center", "distance": "Very Close", "urgency": True},
            {"label": "person", "direction": "Left", "distance": "Near", "urgency": False},
            {"label": "car", "direction": "Right", "distance": "Far", "urgency": False},
            {"label": "traffic light", "direction": "Center", "distance": "Medium", "urgency": False},
            {"label": "traffic light", "direction": "Center", "distance": "Far", "urgency": False},
        ]
    }
    
    # Mock frame
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    
    # Run handle
    output = mode.handle(test_result, frame)
    
    print("\nOutput keys:", output.keys())
    print("Summary:", output.get("summary"))
    
    # Assertions
    forbidden_phrases = ["Move left", "Obstacle ahead", "Path clear", "directly ahead", "on your left", "on your right"]
    for phrase in forbidden_phrases:
        if phrase.lower() in output.get("summary", "").lower():
            print(f"FAILED: Found forbidden phrase '{phrase}' in summary.")
            return False
            
    if "navigation" in output:
        print("FAILED: 'navigation' field still exists in output.")
        return False
        
    if "urgent_count" in output:
        print("FAILED: 'urgent_count' field still exists in output.")
        return False

    if "detected_objects" not in output:
        print("FAILED: 'detected_objects' field missing.")
        return False

    expected_summary = "2 persons detected. 1 vehicle detected. 2 traffic lights detected."
    if output.get("summary") != expected_summary:
        print(f"FAILED: Expected summary '{expected_summary}', got '{output.get('summary')}'")
        return False
        
    print("\nSUCCESS: SurveillanceMode output is clean and correctly formatted for monitoring.")
    return True

if __name__ == "__main__":
    if test_surveillance_output():
        sys.exit(0)
    else:
        sys.exit(1)
