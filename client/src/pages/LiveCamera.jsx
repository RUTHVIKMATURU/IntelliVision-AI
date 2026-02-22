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
    } catch (err) {
      setCamError(err.message || 'Camera unavailable');
      addToast('Camera access denied.', 'error');
    } finally { setIsLoading(false); }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setIsCameraActive(false);
  };

  /* ── capture & analyse ───────────────────────────────────────────── */
  const captureAndAnalyze = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || isAnalyzing) return;
    setIsAnalyzing(true);

    const ctx = canvasRef.current.getContext('2d');
    canvasRef.current.width = videoRef.current.videoWidth;
    canvasRef.current.height = videoRef.current.videoHeight;
    ctx.drawImage(videoRef.current, 0, 0);

    canvasRef.current.toBlob(async (blob) => {
      if (!blob) { setIsAnalyzing(false); return; }
      try {
        const fd = new FormData();
        fd.append('file', blob, 'frame.jpg');
        fd.append('mode', mode);
        const res = await fetch(`${API_BASE}/process-frame`, { method: 'POST', body: fd });
        const data = await res.json();

        /* FPS */
        const now = performance.now();
        if (lastFrameTs.current)
          setFps(Math.round(1000 / (now - lastFrameTs.current)));
        lastFrameTs.current = now;

        /* shared state */
        setDetections(data.detections ?? []);
        setNavigation(data.navigation ?? '');
        setSafeRatio(data.safe_ratio ?? 0);
        setSceneDescription(data.scene_description ?? '');
        setCaption(data.caption ?? '');
        setDepthMap(data.depth_map ?? '');
        setFreeMask(data.free_mask ?? '');
        setUrgentCount(data.urgent_count ?? 0);
        setTimingMs(data.timing_ms ?? null);
        /* mode-specific */
        setUrgentAlerts(data.urgent_alerts ?? []);
        setAllAlerts(data.all_alerts ?? []);
        setNavSpoken(data.navigation_spoken ?? '');
        setInstruction(data.instruction ?? '');
        setLeftClear(data.left_clear ?? 0);
        setRightClear(data.right_clear ?? 0);
        setCenterClear(data.center_clear ?? false);
        setRoadClear(data.road_clear ?? false);

        setResultKey(k => k + 1);
      } catch {
        addToast('Failed to analyse frame.', 'error');
      } finally { setIsAnalyzing(false); }
    }, 'image/jpeg', 0.85);
  }, [isAnalyzing, mode, addToast]);

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
            <h2 className="h4 mb-0 fw-bold" style={{
              background: `linear-gradient(135deg,${selectedMode.color},#06b6d4)`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              <i className={`bi ${selectedMode.icon} me-2`}
                style={{ WebkitTextFillColor: selectedMode.color }} />
              Live Camera
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

        {/* ── Controls ───────────────────────────────────────────── */}
        <div className="px-4 py-3 border-top border-secondary d-flex gap-2 flex-wrap align-items-center">
          <button onClick={captureAndAnalyze}
            disabled={!isCameraActive || isAnalyzing}
            className="btn fw-semibold text-white flex-grow-1"
            style={{ background: 'linear-gradient(135deg,#3b82f6,#06b6d4)', border: 'none' }}>
            <i className="bi bi-camera-fill me-2" />
            {isAnalyzing ? 'Analysing…' : 'Capture & Analyse'}
          </button>
          {isCameraActive
            ? <button onClick={stopCamera} className="btn btn-outline-danger">
              <i className="bi bi-stop-circle me-1" />Stop
            </button>
            : <button onClick={startCamera} disabled={isLoading} className="btn btn-outline-light">
              <i className="bi bi-power me-1" />Start
            </button>
          }
          {timingMs && (
            <span className="text-secondary ms-auto" style={{ fontSize: '0.7rem' }}>
              <i className="bi bi-stopwatch me-1" />
              total: {timingMs.total_ms} ms
            </span>
          )}
        </div>

        <AnimatePresence mode="wait">
          {!hasResults ? (
            <motion.div key="idle"
              variants={fadeSlide} initial="hidden" animate="visible" exit="exit"
              className="px-4 py-5 text-center border-top border-secondary">
              <i className="bi bi-bounding-box text-secondary opacity-25" style={{ fontSize: '2.5rem' }} />
              <p className="text-secondary mt-3 mb-0 small">
                Capture a frame to see real-time detection results here.
              </p>
            </motion.div>
          ) : (
            <motion.div key={`results-${resultKey}`}
              variants={fadeSlide} initial="hidden" animate="visible" exit="exit"
              className="px-4 py-4 border-top border-secondary d-flex flex-column gap-3">

              {/* ① AI Caption — for detailed recognition */}
              {caption && (
                <div className="rounded-3 p-3 border border-primary border-opacity-25"
                  style={{ background: 'rgba(59,130,246,0.05)' }}>
                  <p className="small text-primary fw-bold text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                    <i className="bi bi-card-text me-1" />Image Caption
                  </p>
                  <p className="text-light mb-0" style={{ fontSize: '1rem', fontStyle: 'italic', lineHeight: 1.5 }}>
                    "{caption}"
                  </p>
                </div>
              )}

              {/* ② AI Summary — all modes */}
              {sceneDescription && (
                <div className="rounded-3 p-3 border border-secondary"
                  style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <p className="small text-info fw-bold text-uppercase mb-1" style={{ letterSpacing: '0.06em' }}>
                    <i className="bi bi-stars me-1" />Scene Summary
                  </p>
                  <p className="text-light mb-0" style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
                    {sceneDescription}
                  </p>
                </div>
              )}

              {/* ② Mode-specific result panels */}
              <AnimatePresence mode="wait">

                {/* SURVEILLANCE — nav + full object list */}
                {mode === 'surveillance' && (
                  <motion.div key="surv-r" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="d-flex flex-column gap-3">
                    {navMeta && (
                      <div className={`p-3 rounded-3 border border-${navMeta.cls} d-flex align-items-center gap-3`}
                        style={{ background: navMeta.bg }}>
                        <i className={`bi ${navMeta.icon} text-${navMeta.cls} fs-2`} />
                        <div className="flex-grow-1">
                          <p className="fw-bold text-light mb-0 fs-6">{navigation}</p>
                          <small className="text-secondary">Clear path: {(safeRatio * 100).toFixed(0)}%</small>
                        </div>
                        {urgentCount > 0 && (
                          <span className="badge bg-danger">{urgentCount} urgent</span>
                        )}
                      </div>
                    )}
                    {detections.length > 0 && (
                      <div>
                        <p className="small text-info fw-bold text-uppercase mb-2">
                          <i className="bi bi-bounding-box me-1" />Object Alerts
                          <span className="ms-2 badge bg-secondary fw-normal">{detections.length}</span>
                        </p>
                        <div className="d-flex flex-column gap-2">
                          {[...detections]
                            .sort((a, b) => (b.urgency ? 1 : 0) - (a.urgency ? 1 : 0))
                            .map((det, i) => (
                              <ObjectAlertCard key={`${det.label}-${i}`}
                                label={det.label} confidence={det.confidence}
                                direction={det.direction} verticalZone={det.vertical_zone}
                                distance={det.distance} priorityLevel={det.priority_level}
                                urgency={det.urgency} alert={det.alert} animDelay={i * 0.045}
                              />
                            ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* ASSISTIVE — spoken nav + urgent / all alerts */}
                {mode === 'assistive' && (
                  <motion.div key="asst-r" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="d-flex flex-column gap-3">
                    {navSpoken && (
                      <div className="rounded-3 p-3 d-flex align-items-center gap-3"
                        style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.25)' }}>
                        <i className="bi bi-volume-up-fill text-info fs-3" />
                        <div>
                          <p className="small text-info fw-bold text-uppercase mb-1">Navigation</p>
                          <p className="text-light fw-semibold fs-6 mb-0">{navSpoken}</p>
                        </div>
                      </div>
                    )}
                    {urgentAlerts.length > 0 && (
                      <div>
                        <p className="small fw-bold text-danger text-uppercase mb-2">
                          <i className="bi bi-exclamation-triangle-fill me-1" />Urgent Alerts
                          <span className="ms-2 badge bg-danger">{urgentAlerts.length}</span>
                        </p>
                        <div className="d-flex flex-column gap-2">
                          {urgentAlerts.map((a, i) => (
                            <div key={i} className="rounded-3 px-3 py-2 d-flex align-items-start gap-2"
                              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                              <i className="bi bi-exclamation-circle-fill text-danger mt-1" />
                              <p className="text-light mb-0 small">{a}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {allAlerts.filter(a => !urgentAlerts.includes(a)).length > 0 && (
                      <div>
                        <p className="small fw-bold text-secondary text-uppercase mb-2">
                          <i className="bi bi-info-circle me-1" />All Alerts
                        </p>
                        <div className="d-flex flex-column gap-2">
                          {allAlerts.filter(a => !urgentAlerts.includes(a)).map((a, i) => (
                            <div key={i} className="rounded-3 px-3 py-2 d-flex align-items-start gap-2"
                              style={{ background: 'rgba(100,116,139,0.12)', border: '1px solid rgba(100,116,139,0.2)' }}>
                              <i className="bi bi-dot text-secondary mt-1 fs-5" />
                              <p className="text-secondary mb-0 small">{a}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                {/* SELF-DRIVING — steering instruction + clearance bars */}
                {mode === 'self_driving' && (
                  <motion.div key="sd-r" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="d-flex flex-column gap-3">
                    {instruction && (() => {
                      const color = STEER_COLOR[instruction] ?? '#94a3b8';
                      return (
                        <div className="rounded-3 p-4 text-center"
                          style={{ background: `${color}12`, border: `2px solid ${color}55` }}>
                          <p className="small fw-bold text-uppercase mb-1" style={{ color, letterSpacing: '0.1em' }}>
                            Steering Instruction
                          </p>
                          <p className="fw-bold fs-3 mb-1" style={{ color }}>{instruction}</p>
                          {roadClear && <span className="badge bg-success">Road clear</span>}
                        </div>
                      );
                    })()}
                    <div className="rounded-3 p-3"
                      style={{ background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)' }}>
                      <p className="small fw-bold text-secondary text-uppercase mb-3">
                        <i className="bi bi-arrows-fullscreen me-1" />Path Clearance
                      </p>
                      {[
                        { label: 'Left lane', pct: Math.round(leftClear * 100), icon: 'bi-arrow-left' },
                        { label: 'Right lane', pct: Math.round(rightClear * 100), icon: 'bi-arrow-right' },
                        { label: 'Safe area', pct: Math.round(safeRatio * 100), icon: 'bi-aspect-ratio' },
                      ].map(({ label, pct, icon }) => (
                        <div key={label} className="mb-2">
                          <div className="d-flex justify-content-between mb-1">
                            <small className="text-secondary"><i className={`bi ${icon} me-1`} />{label}</small>
                            <small className={`fw-bold text-${pct >= 50 ? 'success' : 'danger'}`}>{pct}%</small>
                          </div>
                          <div className="progress" style={{ height: 5, background: 'rgba(255,255,255,0.05)' }}>
                            <div className={`progress-bar bg-${pct >= 50 ? 'success' : 'danger'}`}
                              style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      ))}
                      <span className={`badge mt-2 ${centerClear ? 'bg-success' : 'bg-danger'}`}>
                        <i className={`bi ${centerClear ? 'bi-check' : 'bi-x'} me-1`} />
                        Centre {centerClear ? 'clear' : 'blocked'}
                      </span>
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>

              {/* ③ Depth + Free-space thumbnails — all modes */}
              {(depthMap || freeMask) && (
                <div className="row g-3">
                  {depthMap && (
                    <div className="col-6">
                      <p className="text-info fw-bold text-uppercase mb-1"
                        style={{ fontSize: '0.65rem', letterSpacing: '0.06em' }}>
                        <i className="bi bi-layers-fill me-1" />Depth Map
                      </p>
                      <img src={`data:image/png;base64,${depthMap}`}
                        alt="Depth" className="img-fluid rounded-2 w-100" />
                    </div>
                  )}
                  {freeMask && (
                    <div className="col-6">
                      <p className="text-info fw-bold text-uppercase mb-1"
                        style={{ fontSize: '0.65rem', letterSpacing: '0.06em' }}>
                        <i className="bi bi-map-fill me-1" />Free Space
                      </p>
                      <img src={`data:image/png;base64,${freeMask}`}
                        alt="Free Space" className="img-fluid rounded-2 w-100" />
                    </div>
                  )}
                </div>
              )}

            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </div>
  );
};

export default LiveCamera;

