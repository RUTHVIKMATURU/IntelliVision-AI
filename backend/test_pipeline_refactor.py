
import asyncio
import sys
import os
import unittest
from unittest.mock import MagicMock, patch
import numpy as np

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

class TestPipelineRefactor(unittest.IsolatedAsyncioTestCase):
    @patch('vision_engine.pipeline.run_midas_raw')
    @patch('vision_engine.pipeline.detect_free_space')
    @patch('vision_engine.pipeline.run_yolo_with_depth')
    async def test_surveillance_mode_skips_depth(self, mock_yolo, mock_free, mock_midas):
        from vision_engine.pipeline import run_vision_pipeline
        
        mock_yolo.return_value = [{"label": "person", "confidence": 0.9}]
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        
        result = await run_vision_pipeline(img, mode="surveillance")
        
        # Verify MiDaS was NOT called
        mock_midas.assert_not_called()
        # Verify free space was NOT called (it returns a default dict in this case)
        mock_free.assert_not_called()
        
        self.assertEqual(result["depth_map"], "")
        self.assertEqual(result["navigation"], "Unknown")
        self.assertEqual(result["timing"]["midas_ms"], 0)

    @patch('vision_engine.pipeline.run_midas_raw')
    @patch('vision_engine.pipeline.detect_free_space')
    @patch('vision_engine.pipeline.run_yolo_with_depth')
    @patch('vision_engine.pipeline.depth_to_base64')
    async def test_assistive_mode_runs_depth(self, mock_b64, mock_yolo, mock_free, mock_midas):
        from vision_engine.pipeline import run_vision_pipeline
        
        mock_midas.return_value = np.zeros((100, 100), dtype=np.float32)
        mock_yolo.return_value = [{"label": "person", "confidence": 0.9}]
        mock_free.return_value = {"navigation": "Obstacle Ahead", "safe_ratio": 0.5, "free_mask_b64": "mask"}
        mock_b64.return_value = "depth_b64"
        
        img = np.zeros((100, 100, 3), dtype=np.uint8)
        
        result = await run_vision_pipeline(img, mode="assistive")
        
        # Verify MiDaS WAS called
        mock_midas.assert_called_once()
        # Verify free space WAS called
        mock_free.assert_called_once()
        
        self.assertEqual(result["depth_map"], "depth_b64")
        self.assertEqual(result["navigation"], "Obstacle Ahead")
        self.assertGreater(result["timing"]["midas_ms"], -1)

if __name__ == "__main__":
    unittest.main()
