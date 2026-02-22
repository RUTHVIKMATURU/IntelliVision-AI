import asyncio
import numpy as np
from vision_engine.pipeline import run_vision_pipeline

async def test_surveillance_output():
    # Dummy image
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    
    print("\n--- Testing Surveillance Mode ---")
    res_surv = await run_vision_pipeline(img, mode="surveillance", run_caption=False)
    print(f"Surveillance Summary: {res_surv['scene_description']}")
    
    # Check if any nav phrases are in the summary
    nav_phrases = ["directly ahead", "on your left", "on your right", "Move slightly", "Obstacle ahead"]
    contains_nav = any(phrase.lower() in res_surv['scene_description'].lower() for phrase in nav_phrases)
    print(f"Contains navigation? {contains_nav}")

    print("\n--- Testing Assistive Mode ---")
    res_asst = await run_vision_pipeline(img, mode="assistive", run_caption=False)
    print(f"Assistive Summary: {res_asst['scene_description']}")
    
    contains_nav_asst = any(phrase.lower() in res_asst['scene_description'].lower() for phrase in nav_phrases)
    print(f"Contains navigation? {contains_nav_asst}")

if __name__ == "__main__":
    asyncio.run(test_surveillance_output())
