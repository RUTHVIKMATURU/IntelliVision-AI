import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
});

/**
 * POST /upload
 * Full analysis (YOLO + BLIP + MiDaS + free-space). For static image pages.
 * Returns: { detections, caption, scene_description, depth_map,
 *             navigation, safe_ratio, free_mask, id, file_path }
 */
export const uploadImage = async (formData) => {
  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

/**
 * POST /analyze-frame
 * Optimized real-time analysis for live camera frames (no BLIP, no DB write).
 * Returns: { detections, navigation, safe_ratio, scene_description,
 *             depth_map, free_mask, frame_width, frame_height,
 *             timing_ms, urgent_count }
 */
export const analyzeFrame = async (blob) => {
  const formData = new FormData();
  formData.append('file', blob, 'frame.jpg');
  const response = await api.post('/analyze-frame', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

/**
 * GET /history
 * Returns array of past analyses from MongoDB.
 */
export const fetchHistory = async () => {
  const response = await api.get('/history');
  return response.data;
};

/**
 * DELETE /delete/:id
 */
export const deleteItem = async (id) => {
  const response = await api.delete(`/delete/${id}`);
  return response.data;
};

export default api;
