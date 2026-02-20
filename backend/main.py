import asyncio
import os
import shutil
import uvicorn
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from transformers import BlipProcessor, BlipForConditionalGeneration
from PIL import Image
import torch
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime

# Check for GPU
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")

from fastapi.staticfiles import StaticFiles

app = FastAPI()

origins = [
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Server running"}

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Construct absolute path to the model
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(BASE_DIR, "Model_Training_Testing", "best.onnx")

# Load the YOLO model
try:
    yolo_model = YOLO(MODEL_PATH, task="detect")
except Exception as e:
    print(f"Error loading YOLO model: {e}")
    yolo_model = None

# Load the BLIP model
try:
    blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
    blip_model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base").to(device)
except Exception as e:
    print(f"Error loading BLIP model: {e}")
    blip_processor = None
    blip_model = None

# MongoDB Connection
client = MongoClient("mongodb://localhost:27017/")
db = client["caption_vision_db"]
results_collection = db["results"]

# Helper to serialize MongoDB documents
def serialize_doc(doc):
    doc["_id"] = str(doc["_id"])
    return doc

@app.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    detected_classes = []
    caption = ""

    try:
        # Open and resize image for faster processing
        raw_image = Image.open(file_path).convert('RGB')
        max_size = 800
        if max(raw_image.size) > max_size:
            ratio = max_size / max(raw_image.size)
            new_size = (int(raw_image.width * ratio), int(raw_image.height * ratio))
            raw_image = raw_image.resize(new_size, Image.Resampling.LANCZOS)

        # Define async wrappers for blocking tasks
        def run_yolo():
            if not yolo_model: return []
            try:
                # YOLO can accept a PIL image directly
                results = yolo_model(raw_image)
                classes = []
                for result in results:
                    for cls in result.boxes.cls:
                        classes.append(yolo_model.names[int(cls)])
                return classes
            except Exception as e:
                print(f"YOLO detection failed: {e}")
                return []

        def run_blip():
            if not blip_model or not blip_processor: return ""
            try:
                inputs = blip_processor(raw_image, return_tensors="pt").to(device)
                out = blip_model.generate(**inputs)
                return blip_processor.decode(out[0], skip_special_tokens=True)
            except Exception as e:
                print(f"BLIP captioning failed: {e}")
                return f"Error: {str(e)}"

        # Run both models concurrently
        detected_classes, caption = await asyncio.gather(
            asyncio.to_thread(run_yolo),
            asyncio.to_thread(run_blip)
        )

    except Exception as e:
        print(f"Processing failed: {e}")

    # Store in MongoDB
    result_data = {
        "file_path": file_path,
        "detections": detected_classes,
        "caption": caption,
        "timestamp": datetime.now().isoformat()
    }
    inserted_id = results_collection.insert_one(result_data).inserted_id

    return {
        "message": "File uploaded and processed successfully",
        "id": str(inserted_id),
        "file_path": file_path,
        "detections": detected_classes,
        "caption": caption
    }

@app.get("/history")
def get_history():
    history = list(results_collection.find().sort("timestamp", -1))
    return [serialize_doc(doc) for doc in history]

@app.delete("/delete/{id}")
def delete_result(id: str):
    try:
        result = results_collection.delete_one({"_id": ObjectId(id)})
        if result.deleted_count == 1:
            return {"message": "Record deleted successfully"}
        else:
            return {"message": "Record not found"}
    except Exception as e:
        return {"message": "Invalid ID format", "error": str(e)}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
