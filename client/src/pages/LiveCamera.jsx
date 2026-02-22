import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LoadingSpinner from '../components/LoadingSpinner';
import { useToast } from '../context/ToastContext';
import ObjectAlertCard from '../components/ObjectAlertCard';

const API_BASE = 'http://localhost:8000';

/* ── Mode config ────────────────────────────────────────────────── */
const MODES = [
  { value: 'surveillance', label: 'Surveillance', icon: 'bi-camera-video-fill', color: '#3b82f6' },
  { value: 'assistive', label: 'Assistive', icon: 'bi-ear-fill', color: '#22d3ee' },
  { value: 'self_driving', label: 'Self-Driving', icon: 'bi-car-front-fill', color: '#a78bfa' },
];

const STEER_COLOR = {
  'Move Forward': '#22c55e', 'Turn Left': '#f59e0b',
  'Turn Right': '#f59e0b', 'Stop': '#ef4444',
};

/* ── constants ───────────────────────────────────────────────────────── */
const PRIORITY_COLOR = {
  Critical: 'danger',
  High: 'warning',
  Medium: 'info',
  Low: 'secondary',
  Minimal: 'dark',
};

const NAV_META = {
  'Move Forward': { icon: 'bi-arrow-up-circle-fill', cls: 'success', bg: 'rgba(25,135,84,0.15)' },
  'Move Slightly Left': { icon: 'bi-arrow-left-circle-fill', cls: 'warning', bg: 'rgba(255,193,7,0.12)' },
  'Move Slightly Right': { icon: 'bi-arrow-right-circle-fill', cls: 'warning', bg: 'rgba(255,193,7,0.12)' },
  'Obstacle Ahead': { icon: 'bi-exclamation-triangle-fill', cls: 'danger', bg: 'rgba(220,53,69,0.15)' },
};

const URGENCY_TIER = (p) =>
  ['Critical', 'High'].includes(p) ? 'high' : p === 'Medium' ? 'medium' : 'low';

const URGENCY_BADGE = {
  high: { cls: 'danger', label: '●  High' },
  medium: { cls: 'warning', label: '●  Medium' },
  low: { cls: 'success', label: '●  Low' },
};

/* ── fade-slide variant shared by all animated panels ────────────────── */
const fadeSlide = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28 } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.18 } },
};

/* ── component ───────────────────────────────────────────────────────── */
const LiveCamera = () => {
  /* camera */
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [camError, setCamError] = useState(null);

  /* mode */
  const [mode, setMode] = useState('surveillance');

  /* result state */
  const [detections, setDetections] = useState([]);
  const [navigation, setNavigation] = useState('');
  const [safeRatio, setSafeRatio] = useState(0);
  const [sceneDescription, setSceneDescription] = useState('');
  const [caption, setCaption] = useState('');
  const [depthMap, setDepthMap] = useState('');
  const [freeMask, setFreeMask] = useState('');
  const [urgentCount, setUrgentCount] = useState(0);
  const [timingMs, setTimingMs] = useState(null);
  const [fps, setFps] = useState(null);
  /* mode-specific extras */
  const [urgentAlerts, setUrgentAlerts] = useState([]);
  const [allAlerts, setAllAlerts] = useState([]);
  const [navSpoken, setNavSpoken] = useState('');
  const [instruction, setInstruction] = useState('');
  const [leftClear, setLeftClear] = useState(0);
  const [rightClear, setRightClear] = useState(0);
  const [centerClear, setCenterClear] = useState(false);
  const [roadClear, setRoadClear] = useState(false);

  const [resultKey, setResultKey] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const socketRef = useRef(null);
  const captureIntervalRef = useRef(null);
  const lastFrameTs = useRef(null);
  const { addToast } = useToast();
  const selectedMode = MODES.find(m => m.value === mode);

  useEffect(() => () => stopCamera(), []);
  useEffect(() => {
    if (isCameraActive && videoRef.current && streamRef.current)
      videoRef.current.srcObject = streamRef.current;
  }, [isCameraActive]);

  /* ── camera ──────────────────────────────────────────────────────── */
  const startCamera = async () => {
    setIsLoading(true); setCamError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setIsCameraActive(true);

      // ── Initialise WebSocket ──────────────────────────────────────
      const socket = new WebSocket('ws://localhost:8000/ws/live-caption');
      socketRef.current = socket;

      socket.onopen = () => {
        console.log('[ws] Connected to live-caption');
        // Start auto-capture every 2 seconds
        captureIntervalRef.current = setInterval(() => {
          captureAndAnalyze();
        }, 2000);
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.error) {
          console.error('[ws] Error:', data.error);
          return;
        }

        // Update results state from socket response
        setDetections(data.detections ?? []);
        setNavigation(data.navigation ?? '');
        setSafeRatio(data.safe_ratio ?? 0);
        setSceneDescription(data.summary ?? ''); // Backend sends stable narration in 'summary'
        setTimingMs(data.timing_ms ?? null);

        // Update FPS if backend provides it
        if (data.timing_ms?.avg_fps) setFps(data.timing_ms.avg_fps);

        setResultKey(k => k + 1);
        setIsAnalyzing(false);
      };

      socket.onclose = () => console.log('[ws] Disconnected');
      socket.onerror = (err) => {
        console.error('[ws] WebSocket Error:', err);
        addToast('Live stream connection failed.', 'error');
      };

    } catch (err) {
      setCamError(err.message || 'Camera unavailable');
      addToast('Camera access denied.', 'error');
    } finally { setIsLoading(false); }
  };

  const stopCamera = () => {
    // Stop auto-capture
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    // Close WebSocket
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    // Stop stream
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setIsCameraActive(false);
  };

  /* ── capture & analyse ───────────────────────────────────────────── */
  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    if (socketRef.current?.readyState !== WebSocket.OPEN) return;

    setIsAnalyzing(true);

    const ctx = canvasRef.current.getContext('2d');
    // Maintain a consistent analysis resolution (640px height) for backend efficiency
    const targetHeight = 480;
    const ratio = videoRef.current.videoWidth / videoRef.current.videoHeight;
    canvasRef.current.width = targetHeight * ratio;
    canvasRef.current.height = targetHeight;

    ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);

    // Get as base64 string
    const frameBase64 = canvasRef.current.toDataURL('image/jpeg', 0.8).split(',')[1];

    try {
      socketRef.current.send(JSON.stringify({
        frame: frameBase64,
        mode: mode
      }));
    } catch (err) {
      console.error('[ws] Failed to send frame:', err);
      setIsAnalyzing(false);
    }
  }, []);

  const navMeta = NAV_META[navigation];
  const hasResults = sceneDescription || detections.length > 0;

  /* ── render ──────────────────────────────────────────────────────── */
  return (
    <div className="container-fluid px-3 px-md-4" style={{ maxWidth: 1060 }}>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="card border-secondary shadow-lg overflow-hidden"
        style={{ backgroundColor: 'rgba(18,22,28,0.96)' }}
      >

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="card-header border-secondary bg-transparent px-4 py-3">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <h2 className="h4 mb-0 fw-bold d-flex align-items-center gap-2" style={{
              color: selectedMode.color,
              textShadow: '0 0 20px rgba(0,0,0,0.5)'
            }}>
              <i className={`bi ${selectedMode.icon}`} />
              <span>Live Camera</span>
            </h2>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              {fps !== null && (
                <span className="badge border border-secondary text-success"
                  style={{ background: 'rgba(0,0,0,0.4)', fontSize: '0.72rem' }}>
                  <i className="bi bi-speedometer2 me-1" />{fps} FPS
                </span>
              )}
              {urgentCount > 0 && (
                <motion.span key={urgentCount} initial={{ scale: 1.3 }} animate={{ scale: 1 }}
                  className="badge bg-danger" style={{ fontSize: '0.72rem' }}>
                  <i className="bi bi-exclamation-triangle-fill me-1" />{urgentCount} URGENT
                </motion.span>
              )}
              {isCameraActive && (
                <span className="badge bg-danger bg-opacity-80" style={{ fontSize: '0.72rem' }}>
                  <i className="bi bi-record-circle-fill me-1" />LIVE
                </span>
              )}
            </div>
          </div>

          {/* Mode selector pills */}
          <div className="d-flex gap-2 mt-3 flex-wrap">
            {MODES.map(m => (
              <button key={m.value}
                onClick={() => setMode(m.value)}
                className="btn btn-sm d-flex align-items-center gap-1 px-3 py-1 rounded-pill"
                style={{
                  border: `1.5px solid ${mode === m.value ? m.color : 'rgba(100,116,139,0.3)'}`,
                  background: mode === m.value ? `${m.color}18` : 'transparent',
                  color: mode === m.value ? m.color : '#94a3b8',
                  fontWeight: mode === m.value ? 700 : 400,
                  fontSize: '0.78rem', transition: 'all 0.2s',
                }}
              >
                <i className={`bi ${m.icon}`} />{m.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Video ──────────────────────────────────────────────── */}
        <div className="ratio ratio-16x9 bg-black position-relative">
          {isCameraActive ? (
            <video ref={videoRef} autoPlay playsInline muted
              className="w-100 h-100 object-fit-cover" />
          ) : (
            <div className="d-flex align-items-center justify-content-center flex-column gap-3 w-100 h-100">
              {isLoading
                ? <LoadingSpinner message="Initialising camera…" />
                : <>
                  <i className="bi bi-webcam text-secondary opacity-20"
                    style={{ fontSize: '4rem' }} />
                  <p className="text-secondary mb-0">Camera feed not active</p>
                  <button className="btn btn-outline-light btn-sm" onClick={startCamera}>
                    <i className="bi bi-power me-2" />Start Camera
                  </button>
                  {camError && <p className="text-danger small mt-1">{camError}</p>}
                </>
              }
            </div>
          )}

          {/* Subtle grid overlay */}
          <div className="position-absolute top-0 start-0 w-100 h-100 pe-none"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px)',
              backgroundSize: '50px 50px',
            }} />

          {/* Analysing overlay */}
          <AnimatePresence>
            {isAnalyzing && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
                style={{ backgroundColor: 'rgba(0,0,0,0.50)' }}>
                <LoadingSpinner message="Analysing frame…" />
              </motion.div>
            )}
          </AnimatePresence>

          <canvas ref={canvasRef} className="d-none" />
        </div>

        {/* ── Controls & Status ──────────────────────────────────── */}
        <div className="px-4 py-2 border-top border-secondary d-flex gap-2 flex-wrap align-items-center bg-black bg-opacity-20">
          <div className="flex-grow-1 d-flex align-items-center">
            <div className={`badge rounded-pill px-3 py-2 d-flex align-items-center gap-2 ${isCameraActive ? 'text-success bg-success bg-opacity-10 border border-success border-opacity-25' : 'text-secondary bg-white bg-opacity-5 border border-white border-opacity-10'}`}
              style={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}>
              <i className={`bi ${isAnalyzing ? 'bi-hourglass-split' : isCameraActive ? 'bi-broadcast' : 'bi-camera-video-off'} ${isAnalyzing ? 'spin' : ''}`} />
              {isAnalyzing ? 'PROCESSING FRAME...' : isCameraActive ? 'LIVE STREAM ACTIVE' : 'SYSTEM IDLE'}
            </div>
            {timingMs && (
              <span className="text-secondary ms-3 d-none d-md-inline" style={{ fontSize: '0.65rem', letterSpacing: '0.05em', opacity: 0.6 }}>
                LATENCY: {timingMs.total_ms}ms
              </span>
            )}
          </div>

          {isCameraActive && (
            <button onClick={stopCamera} className="btn btn-outline-danger btn-sm px-4 rounded-pill fw-bold shadow-sm"
              style={{ fontSize: '0.75rem', letterSpacing: '0.05em' }}>
              <i className="bi bi-stop-circle me-2" />STOP STREAM
            </button>
          )}
        </div>

        {/* ── Live AI Narrative (Centralized & Animated) ─────────── */}
        <div className="border-top border-secondary bg-black bg-opacity-20 px-4 py-4"
          style={{ minHeight: '120px' }}>
          <AnimatePresence mode="wait">
            {!sceneDescription ? (
              <motion.div key="waiting" variants={fadeSlide} initial="hidden" animate="visible" exit="exit"
                className="d-flex flex-column align-items-center justify-content-center h-100 opacity-25 py-2">
                <i className="bi bi-chat-dots fs-3 mb-2" />
                <p className="small mb-0">Waiting for live analysis...</p>
              </motion.div>
            ) : (
              <motion.div key={sceneDescription} variants={fadeSlide} initial="hidden" animate="visible" exit="exit">

                {/* Urgent Banner */}
                {urgentCount > 0 && (
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="alert alert-danger border-0 d-flex align-items-center gap-3 py-2 px-3 mb-3 rounded-3 shadow-sm"
                    style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3) !important' }}
                  >
                    <i className="bi bi-exclamation-triangle-fill fs-5" />
                    <div>
                      <p className="fw-bold mb-0 small text-uppercase" style={{ letterSpacing: '0.1em' }}>Immediate Attention Required</p>
                      <p className="mb-0 x-small opacity-75">{urgentCount} critical object(s) in path</p>
                    </div>
                  </motion.div>
                )}

                <div className="d-flex align-items-start gap-3">
                  <div className="p-2 rounded-circle bg-primary bg-opacity-10 border border-primary border-opacity-25 mt-1">
                    <i className="bi bi-robot text-primary" />
                  </div>
                  <div className="flex-grow-1">
                    <p className="small text-info fw-bold text-uppercase mb-1" style={{ letterSpacing: '0.1em', fontSize: '0.7rem' }}>
                      <i className="bi bi-stars me-1" />Vision Intelligence
                    </p>
                    <p className="text-light fs-5 mb-0 fw-medium leading-relaxed" style={{ textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                      {sceneDescription}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Detailed Tactical Overlay ──────────────────────────── */}
        <AnimatePresence>
          {hasResults && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-4 pb-4 border-top border-secondary border-opacity-50 overflow-hidden"
            >
              <div className="pt-4 border-top border-secondary border-opacity-25 row g-4">

                {/* Left: Navigation & Path */}
                <div className="col-lg-6">
                  {navMeta && (
                    <div className={`p-3 rounded-4 border border-${navMeta.cls} border-opacity-25 d-flex align-items-center gap-4 mb-3`}
                      style={{ background: navMeta.bg, backdropFilter: 'blur(10px)' }}>
                      <div className={`p-3 rounded-circle bg-${navMeta.cls} bg-opacity-10 border border-${navMeta.cls} border-opacity-25`}>
                        <i className={`bi ${navMeta.icon} text-${navMeta.cls} fs-3`} />
                      </div>
                      <div>
                        <p className="small text-secondary fw-bold text-uppercase mb-0" style={{ letterSpacing: '0.05em' }}>Route Assessment</p>
                        <p className="fw-bold text-light mb-0 fs-5">{navigation}</p>
                        <div className="mt-2" style={{ width: '120px' }}>
                          <div className="progress" style={{ height: 4, background: 'rgba(255,255,255,0.05)' }}>
                            <div className={`progress-bar bg-${navMeta.cls}`} style={{ width: `${safeRatio * 100}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {detections.length > 0 && (
                    <div className="mt-4">
                      <p className="small text-secondary fw-bold text-uppercase mb-3" style={{ letterSpacing: '0.05em' }}>
                        Tactical Alerts <span className="ms-2 badge bg-secondary opacity-50 fw-normal">{detections.length}</span>
                      </p>
                      <div className="d-flex flex-wrap gap-2">
                        {detections.slice(0, 6).map((det, i) => (
                          <div key={i} className={`badge rounded-pill border py-2 px-3 d-flex align-items-center gap-2 ${det.urgency ? 'border-danger text-danger bg-danger bg-opacity-10' : 'border-secondary border-opacity-25 text-secondary bg-white bg-opacity-5'}`}>
                            <i className={`bi ${det.urgency ? 'bi-exclamation-circle' : 'bi-dot'} fs-6`} />
                            {det.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Right: Visual Perception (Thumbnails) */}
                <div className="col-lg-6">
                  {(depthMap || freeMask) && (
                    <div className="card bg-black bg-opacity-40 border-secondary rounded-4 shadow-sm h-100 overflow-hidden">
                      <div className="card-body p-3">
                        <div className="row g-2">
                          {depthMap && (
                            <div className="col-6">
                              <p className="text-secondary fw-bold text-uppercase mb-2" style={{ fontSize: '0.6rem', letterSpacing: '0.1em' }}>
                                Depth Perception
                              </p>
                              <img src={`data:image/png;base64,${depthMap}`} alt="Depth" className="img-fluid rounded-3 border border-secondary border-opacity-25 shadow-sm" />
                            </div>
                          )}
                          {freeMask && (
                            <div className="col-6">
                              <p className="text-secondary fw-bold text-uppercase mb-2" style={{ fontSize: '0.6rem', letterSpacing: '0.1em' }}>
                                Spatial Analysis
                              </p>
                              <img src={`data:image/png;base64,${freeMask}`} alt="Free Space" className="img-fluid rounded-3 border border-secondary border-opacity-25 shadow-sm" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
};

export default LiveCamera;

