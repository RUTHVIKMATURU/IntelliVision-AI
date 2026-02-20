import axios from 'axios';

const API_BASE_URL = 'http://localhost:8000';

const api = axios.create({
  baseURL: API_BASE_URL,
});

export const uploadImage = async (formData) => {
  const response = await api.post('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
};

export const fetchHistory = async () => {
  const response = await api.get('/history');
  return response.data;
};

export const deleteItem = async (id) => {
  const response = await api.delete(`/delete/${id}`);
  return response.data;
};

export default api;
