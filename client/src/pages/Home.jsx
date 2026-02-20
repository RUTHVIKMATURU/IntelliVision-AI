import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LoadingSpinner from '../components/LoadingSpinner';
import { useToast } from '../context/ToastContext';
import { uploadImage } from '../services/api';

const Home = () => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const { addToast } = useToast();

  const onDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragActive(true);
  }, []);

  const onDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragActive(false);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragActive(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type.startsWith('image/')) {
      handleFileSelect(droppedFile);
    } else {
      addToast('Please upload a valid image file.', 'error');
    }
  }, [addToast]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelect(e.target.files[0]);
    }
  };

  const handleFileSelect = (selectedFile) => {
    setFile(selectedFile);
    setPreview(URL.createObjectURL(selectedFile));
    setResult(null); // Reset result on new upload
    addToast('Image uploaded successfully', 'info');
  };

  const handleAnalyze = async () => {
    if (!file) {
      addToast('Please upload an image first.', 'error');
      return;
    }
    setLoading(true);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const data = await uploadImage(formData);
      setResult(data);
      addToast('Analysis completed successfully!', 'success');
    } catch (error) {
      console.error('Error analyzing image:', error);
      const errorMessage = error.response?.data?.detail || 'Failed to analyze image. Please try again.';
      addToast(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetUpload = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
  };

  return (
    <div className="container" style={{ maxWidth: '800px' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="card bg-dark border-secondary shadow-lg overflow-hidden"
        style={{ backgroundColor: 'rgba(33, 37, 41, 0.8)' }}
      >
        <div className="card-body p-5">
          <div className="text-center mb-5">
            <h2 className="display-6 fw-bold mb-2" style={{
              background: 'linear-gradient(to right, #60a5fa, #22d3ee)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              Image Analysis
            </h2>
            <p className="text-secondary small">Upload an image to detect objects and generate captions</p>
          </div>

          <AnimatePresence mode="wait">
            {!preview ? (
              <motion.div
                key="upload-zone"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div
                  className={`position-relative rounded-3 p-5 text-center ${isDragActive ? 'bg-opacity-10 bg-info border-info' : 'bg-transparent border-secondary'}`}
                  style={{ border: '2px dashed', borderColor: isDragActive ? '#0dcaf0' : '#6c757d', cursor: 'pointer' }}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="position-absolute top-0 start-0 w-100 h-100 opacity-0"
                    style={{ cursor: 'pointer' }}
                  />
                  <div className="d-flex flex-column align-items-center gap-3 pe-none">
                    <div className="d-flex align-items-center justify-center rounded-circle bg-secondary bg-opacity-25 mb-2" style={{ width: '64px', height: '64px' }}>
                      <i className="bi bi-cloud-arrow-up text-info fs-1"></i>
                    </div>
                    <p className="fs-5 fw-medium text-light mb-0">
                      {isDragActive ? "Drop image here" : "Drag & Drop or Click to Browse"}
                    </p>
                    <p className="small text-secondary mb-0">Supports JPG, PNG, WEBP</p>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="preview-zone"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="d-flex flex-column gap-4"
              >
                <div className="position-relative rounded-3 overflow-hidden bg-black d-flex align-items-center justify-center ratio ratio-16x9">
                  {/* We use a div for ratio, but img needs to be centered. Bootstrap ratio expects immediate child. */}
                  <div className="d-flex align-items-center justify-center w-100 h-100">
                    <img src={preview} alt="Preview" className="img-fluid" style={{ maxHeight: '100%', objectFit: 'contain' }} />
                  </div>

                  {/* Remove Button Overlay */}
                  <div className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-center opacity-0 hover-opacity-100" style={{ background: 'rgba(0,0,0,0.6)', opacity: 0, transition: 'opacity 0.3s' }}
                    onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={(e) => e.currentTarget.style.opacity = '0'}
                  >
                    <button
                      onClick={resetUpload}
                      className="btn btn-danger"
                    >
                      Remove Image
                    </button>
                  </div>
                </div>

                {/* Analysis Controls */}
                {!result && (
                  <div className="d-flex justify-center">
                    <button
                      onClick={handleAnalyze}
                      disabled={loading}
                      className="btn btn-info text-white rounded-pill px-5 py-2 fw-semibold shadow position-relative overflow-hidden"
                      style={{ background: 'linear-gradient(to right, #3b82f6, #06b6d4)', border: 'none' }}
                    >
                      {loading ? (
                        <LoadingSpinner size="sm" message="Analyzing..." />
                      ) : (
                        <>Analyze Image</>
                      )}
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results Section */}
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-5 pt-4 border-top border-secondary"
              >
                <div className="d-grid gap-3">
                  <div className="bg-dark bg-opacity-50 p-4 rounded-3 border border-secondary">
                    <h3 className="text-info small fw-bold text-uppercase mb-2">Generated Caption</h3>
                    <p className="text-light lead mb-0">"{result.caption}"</p>
                  </div>

                  <div className="bg-dark bg-opacity-50 p-4 rounded-3 border border-secondary">
                    <h3 className="text-info small fw-bold text-uppercase mb-3">Detected Objects</h3>
                    <div className="d-flex flex-wrap gap-2">
                      {result.detections.map((item, index) => (
                        <span
                          key={index}
                          className="badge bg-secondary bg-opacity-50 text-light fw-normal border border-secondary"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={resetUpload}
                    className="btn btn-link text-secondary text-decoration-none mt-2 w-100"
                  >
                    Analyze another image
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default Home;
