import requests
import os
import sys

def test_video_processing():
    url = "http://localhost:8000/process-video"
    # Find a video file in uploads or use a placeholder if none exists
    uploads_dir = r"c:\Users\ruthv\OneDrive\Desktop\Summer project\ROD_IDS\backend\uploads"
    
    # Try to find any .mp4 file in uploads
    video_files = [f for f in os.listdir(uploads_dir) if f.endswith(".mp4")]
    
    if not video_files:
        print("No .mp4 files found in uploads directory to test with.")
        print("Please place a video file in the uploads directory first.")
        return

    file_path = os.path.join(uploads_dir, video_files[0])
    print(f"Testing with video: {file_path}")

    with open(file_path, "rb") as f:
        files = {"file": (os.path.basename(file_path), f, "video/mp4")}
        data = {"mode": "surveillance"}
        try:
            response = requests.post(url, files=files, data=data)
            if response.status_code == 200:
                res_json = response.json()
                print("\nVideo processing successful!")
                print("\nMetadata:")
                print(f"  Mode: {res_json.get('mode')}")
                print(f"  Total Frames Analyzed: {res_json.get('total_frames_analyzed')}")
                print(f"  Total Processing Time: {res_json.get('total_processing_ms')}ms")
                
                summaries = res_json.get("frame_summaries", [])
                print(f"\nAnalysis Results ({len(summaries)} unique frames/events):")
                
                for res in summaries:
                    timestamp = res.get("timestamp_sec")
                    summary   = res.get("summary", "")
                    dets_len  = len(res.get("detections", []))
                    f_ms      = res.get("processing_ms")
                    # Raw frame check should now always be No in API response
                    has_raw   = "Yes" if "raw_frame_b64" in res else "No"
                    print(f"\n  [ {timestamp}s ] ({f_ms}ms)")
                    print(f"    Summary: {summary}")
                    print(f"    Detections Count: {dets_len}")
                
                print("\n--- Final Video Summary ---")
                print(f"  {res_json.get('video_summary')}")
                
                print("\nObject Counts Across Video:")
                print(f"  {res_json.get('object_counts')}")
                
            else:
                print(f"\nProcessing failed with status code: {response.status_code}")
                print(response.text)
        except Exception as e:
            print(f"\nError: {e}")

if __name__ == "__main__":
    test_video_processing()
