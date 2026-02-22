import asyncio
import base64
import json
import cv2
import numpy as np
import websockets

async def verify_ws():
    uri = "ws://localhost:8000/ws/live-caption"
    
    # Create a dummy image (640x480 black)
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(img, "WS Test Frame", (100, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    _, buffer = cv2.imencode('.jpg', img)
    img_bytes = buffer.tobytes()
    img_b64 = base64.b64encode(img_bytes).decode('utf-8')

    print(f"Connecting to {uri}...")
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected! Sending frame (Binary)...")
            await websocket.send(img_bytes)
            
            response = await websocket.recv()
            data = json.loads(response)
            print("\nResponse (Binary Frame):")
            print(json.dumps(data, indent=2))

            print("\nSending frame (Base64 Text)...")
            await websocket.send(img_b64)
            
            response = await websocket.recv()
            data = json.loads(response)
            print("\nResponse (Base64 Frame):")
            print(json.dumps(data, indent=2))

    except Exception as e:
        print(f"Connection failed: {e}")

async def test_stability():
    uri = "ws://localhost:8000/ws/live-caption"
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(img, "Stability Test", (100, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    _, buffer = cv2.imencode('.jpg', img)
    img_bytes = buffer.tobytes()

    print(f"\n--- Testing Stability & Rolling Logic ---")
    async with websockets.connect(uri) as websocket:
        for i in range(6):
            print(f"Sending Frame {i+1}...")
            await websocket.send(img_bytes)
            response = await websocket.recv()
            data = json.loads(response)
            print(f"  Caption: {data.get('summary')}")
            # Wait a bit more than the 2s PROCESS_INTERVAL
            await asyncio.sleep(2.1)

if __name__ == "__main__":
    # asyncio.run(verify_ws())
    asyncio.run(test_stability())
