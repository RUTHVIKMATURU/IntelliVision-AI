import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import LoadingSpinner from '../components/LoadingSpinner';
import { useToast } from '../context/ToastContext';
import { uploadImage } from '../services/api';

const LiveCamera = () => {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [errorObj, setErrorObj] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const { addToast } = useToast();

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isCameraActive]);

  const startCamera = async () => {
    setIsLoading(true);
    setErrorObj(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      setIsCameraActive(true);
    } catch (error) {
      console.error("Error accessing camera:", error);
      setErrorObj(error.message || "Failed to access camera");
      addToast("Failed to access camera. Please check permissions.", "error");
    } finally {
      setIsLoading(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const captureFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    setIsAnalyzing(true);
    const context = canvasRef.current.getContext('2d');
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    context.drawImage(videoRef.current, 0, 0);

    canvasRef.current.toBlob(async (blob) => {
      if (!blob) {
        setIsAnalyzing(false);
        return;
      }

      const formData = new FormData();
      formData.append('file', blob, 'capture.jpg');

      try {
        const data = await uploadImage(formData);
        setResult(data);
        addToast('Frame analyzed successfully!', 'success');
      } catch (error) {
        console.error('Error analyzing frame:', error);
        addToast('Failed to analyze frame.', 'error');
      } finally {
        setIsAnalyzing(false);
      }
    }, 'image/jpeg');
  };

  return (
    <div className="container" style={{ maxWidth: '900px' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.5 }}
        className="card bg-dark border-secondary shadow-lg overflow-hidden"
        style={{ backgroundColor: 'rgba(33, 37, 41, 0.9)' }}
      >
        <div className="card-header border-secondary bg-transparent py-3">
          <div className="d-flex justify-content-between align-items-center">
            <h2 className="h4 mb-0 fw-bold" style={{
              background: 'linear-gradient(to right, #4ade80, #059669)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              <i className="bi bi-camera-video-fill me-2"></i>
              Live Camera Detection
            </h2>
            {isCameraActive && (
              <span className="badge bg-danger bg-opacity-75 animate-pulse">
                <i className="bi bi-record-circle-fill me-1"></i> LIVE
              </span>
            )}
          </div>
        </div>

        <div className="card-body p-0">
          {/* Video Preview Area */}
          <div className="ratio ratio-16x9 bg-black position-relative">
            {isCameraActive ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-100 h-100 object-fit-cover"
              />
            ) : (
              <div className="d-flex align-items-center justify-center w-100 h-100 flex-column">
                {isLoading ? (
                  <LoadingSpinner message="Initializing Camera..." />
                ) : (
                  <>
                    <i className="bi bi-webcam text-secondary display-1 mb-3 opacity-25"></i>
                    <p className="text-secondary mb-0">Camera feed not active</p>
                    <button
                      className="btn btn-outline-light btn-sm mt-3"
                      onClick={startCamera}
                    >
                      <i className="bi bi-power me-2"></i>Start Camera
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Hidden Canvas for Capture */}
            <canvas ref={canvasRef} className="d-none"></canvas>
            {/* Overlay Grid (Optional visual flair) */}
            <div className="position-absolute top-0 start-0 w-100 h-100 pe-none"
              style={{
                backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
                backgroundSize: '50px 50px',
                opacity: 0.3
              }}>
            </div>

            {/* Analysis Loading Overlay */}
            {isAnalyzing && (
              <div className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                <LoadingSpinner message="Analyzing Frame..." />
              </div>
            )}
          </div>
        </div>

        <div className="card-footer border-secondary bg-transparent p-4">
          <div className="row align-items-center g-3">
            <div className="col-md-4">
              <button
                onClick={captureFrame}
                disabled={!isCameraActive || isAnalyzing}
                className="btn btn-primary w-100 py-2 fw-semibold d-flex align-items-center justify-content-center gap-2 shadow-sm"
              >
                <i className="bi bi-camera-fill"></i>
                Capture Frame
              </button>
            </div>
            <div className="col-md-8">
              <div className="alert alert-dark border-secondary mb-0 d-flex align-items-start gap-3" role="alert">
                <i className="bi bi-info-circle-fill text-info mt-1"></i>
                <div className="flex-grow-1">
                  <h6 className="alert-heading h6 text-info mb-1">Detection Results</h6>
                  {result ? (
                    <div>
                      <p className="mb-1 text-light">"{result.caption}"</p>
                      <div className="d-flex flex-wrap gap-1 mt-2">
                        {result.detections.map((det, idx) => (
                          <span key={idx} className="badge bg-secondary bg-opacity-50 border border-secondary text-info fw-normal small">
                            {det}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="mb-0 small text-light opacity-75">
                      Waiting for capture... Systems ready.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default LiveCamera;
