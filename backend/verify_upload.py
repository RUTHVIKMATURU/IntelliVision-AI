import requests
import os

def test_upload():
    url = "http://localhost:8000/upload"
    file_path = r"c:\Users\ruthv\OneDrive\Desktop\Summer project\ROD_IDS\backend\uploads\capture.jpg"
    
    if not os.path.exists(file_path):
        print(f"File not found: {file_path}")
        return

    with open(file_path, "rb") as f:
        files = {"file": (os.path.basename(file_path), f, "image/jpeg")}
        try:
            response = requests.post(url, files=files)
            if response.status_code == 200:
                data = response.json()
                print("Upload successful!")
                print(f"ID: {data.get('id')}")
                print(f"Caption: {data.get('caption')}")
                print(f"Detections: {data.get('detections')}")
                depth_map = data.get('depth_map')
                if depth_map:
                    print(f"Depth map received (length: {len(depth_map)})")
                else:
                    print("No depth map received.")
            else:
                print(f"Upload failed with status code: {response.status_code}")
                print(response.text)
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    test_upload()
