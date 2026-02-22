import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LoadingSpinner from '../components/LoadingSpinner';
import { useToast } from '../context/ToastContext';
import { uploadImage } from '../services/api';
import ObjectAlertCard from '../components/ObjectAlertCard';

/* ── API base ─────────────────────────────────────────────────────────────── */
const API_BASE = 'http://localhost:8000';

/* ── Mode config (selector options + result panel layout) ─────────────────── */
const MODES = [
  {
    value: 'surveillance',
    label: 'Surveillance',
    icon: 'bi-camera-video-fill',
    color: '#3b82f6',
    desc: 'All objects · full metadata · data persisted to DB',
  },
  {
    value: 'assistive',
    label: 'Assistive',
    icon: 'bi-ear-fill',
    color: '#22d3ee',
    desc: 'Pedestrian / hazard focus · spoken navigation · no storage',
  },
  {
    value: 'self_driving',
    label: 'Self-Driving',
    icon: 'bi-car-front-fill',
    color: '#a78bfa',
    desc: 'Road objects only · steering instruction · no storage',
  },
];

/* ── helpers ─────────────────────────────────────────────────────────────── */
const NAV_META = {
  'Move Forward': { icon: 'bi-arrow-up-circle-fill', cls: 'success' },
  'Move Slightly Left': { icon: 'bi-arrow-left-circle-fill', cls: 'warning' },
  'Move Slightly Right': { icon: 'bi-arrow-right-circle-fill', cls: 'warning' },
  'Obstacle Ahead': { icon: 'bi-exclamation-triangle-fill', cls: 'danger' },
  'Turn Left': { icon: 'bi-arrow-left-circle-fill', cls: 'warning' },
  'Turn Right': { icon: 'bi-arrow-right-circle-fill', cls: 'warning' },
  'Stop': { icon: 'bi-stop-circle-fill', cls: 'danger' },
};

const STEER_COLOR = {
  'Move Forward': '#22c55e', 'Turn Left': '#f59e0b',
  'Turn Right': '#f59e0b', 'Stop': '#ef4444'
};

/* ── sub-panels ──────────────────────────────────────────────────────────── */

/** Surveillance — storage confirmation + full detections */
function SurveillancePanel({ result }) {
  return (
    <>
      {/* Storage confirmation */}
      <div className="rounded-3 p-3 d-flex align-items-center gap-3"
        style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}>
        <i className={`bi fs-4 ${result.stored_in_db ? 'bi-database-fill-check text-success' : 'bi-database-x text-danger'}`} />
        <div>
          <p className="fw-semibold text-light mb-0" style={{ fontSize: '0.85rem' }}>
            {result.stored_in_db ? 'Stored to database' : 'Storage failed'}
          </p>
          {result.id && (
            <p className="text-secondary mb-0" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>
              ID: {result.id}
            </p>
          )}
          {result.timestamp && (
            <p className="text-secondary mb-0" style={{ fontSize: '0.7rem' }}>
              <i className="bi bi-clock me-1" />{result.timestamp}
            </p>
          )}
          {result.frame_path && (
            <p className="text-secondary mb-0" style={{ fontSize: '0.7rem' }}>
              <i className="bi bi-folder2-open me-1" />{result.frame_path}
            </p>
          )}
        </div>
      </div>

      {/* All detected objects */}
      {result.detections?.length > 0 && (
        <div>
          <p className="small fw-bold text-info text-uppercase mb-2">
            <i className="bi bi-bounding-box me-2" />
            Detected Objects
            <span className="ms-2 badge bg-secondary">{result.detections.length}</span>
            {result.detections.some(d => d.urgency) && (
              <span className="ms-2 badge bg-danger">URGENT</span>
            )}
          </p>
          <div className="d-flex flex-column gap-2">
            {result.detections.map((det, i) => (
              <ObjectAlertCard key={i}
                label={det.label} confidence={det.confidence}
                direction={det.direction} verticalZone={det.vertical_zone}
                distance={det.distance} priorityLevel={det.priority_level}
                urgency={det.urgency} alert={det.alert} animDelay={i * 0.05}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Assistive — urgent alerts banner + navigation spoken phrase */
function AssistivePanel({ result }) {
  return (
    <>
      {/* Navigation spoken phrase */}
      {result.navigation_spoken && (
        <div className="rounded-3 p-4 d-flex align-items-center gap-3"
          style={{ background: 'rgba(14,165,233,0.08)', border: '1px solid rgba(14,165,233,0.25)' }}>
          <i className="bi bi-volume-up-fill text-info fs-3" />
          <div>
            <p className="small text-info fw-bold text-uppercase mb-1">Navigation</p>
            <p className="text-light fw-semibold fs-5 mb-0">{result.navigation_spoken}</p>
          </div>
        </div>
      )}

      {/* Urgent alerts */}
      {result.urgent_alerts?.length > 0 && (
        <div>
          <p className="small fw-bold text-danger text-uppercase mb-2">
            <i className="bi bi-exclamation-triangle-fill me-2" />
            Urgent Alerts
            <span className="ms-2 badge bg-danger">{result.urgent_alerts.length}</span>
          </p>
          <div className="d-flex flex-column gap-2">
            {result.urgent_alerts.map((alert, i) => (
              <div key={i} className="rounded-3 px-3 py-2 d-flex align-items-start gap-2"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                <i className="bi bi-exclamation-circle-fill text-danger mt-1" />
                <p className="text-light mb-0 small">{alert}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All alerts (non-urgent) */}
      {result.all_alerts?.filter(a => !result.urgent_alerts?.includes(a)).length > 0 && (
        <div>
          <p className="small fw-bold text-secondary text-uppercase mb-2">
            <i className="bi bi-info-circle me-2" />All Alerts
          </p>
          <div className="d-flex flex-column gap-2">
            {result.all_alerts
              .filter(a => !result.urgent_alerts?.includes(a))
              .map((alert, i) => (
                <div key={i} className="rounded-3 px-3 py-2 d-flex align-items-start gap-2"
                  style={{ background: 'rgba(100,116,139,0.12)', border: '1px solid rgba(100,116,139,0.2)' }}>
                  <i className="bi bi-dot text-secondary mt-1 fs-5" />
                  <p className="text-secondary mb-0 small">{alert}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {result.urgent_count === 0 && result.all_alerts?.length === 0 && (
        <div className="text-center py-3">
          <i className="bi bi-check-circle-fill text-success fs-3" />
          <p className="text-success fw-semibold mt-2 mb-0">Path clear, no hazards detected</p>
        </div>
      )}
    </>
  );
}

/** Self-driving — steering instruction panel + clearance bars */
function SelfDrivingPanel({ result }) {
  const instruction = result.instruction ?? result.navigation ?? 'Unknown';
  const color = STEER_COLOR[instruction] ?? '#94a3b8';
  const leftPct = ((result.left_clear ?? 0) * 100).toFixed(0);
  const rightPct = ((result.right_clear ?? 0) * 100).toFixed(0);
  const safePct = ((result.safe_ratio ?? 0) * 100).toFixed(0);

  return (
    <>
      {/* Primary steering instruction */}
      <div className="rounded-3 p-4 text-center"
        style={{ background: `${color}12`, border: `2px solid ${color}55` }}>
        <p className="small fw-bold text-uppercase mb-2" style={{ color, letterSpacing: '0.1em' }}>
          Steering Instruction
        </p>
        <p className="fw-bold fs-3 mb-1" style={{ color }}>{instruction}</p>
        {result.urgent_block && (
          <span className="badge bg-danger">Urgent obstacle forced Stop</span>
        )}
        {result.road_clear && (
          <span className="badge bg-success">Road clear</span>
        )}
      </div>

      {/* Clearance bars */}
      <div className="rounded-3 p-3"
        style={{ background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.2)' }}>
        <p className="small fw-bold text-secondary text-uppercase mb-3">
          <i className="bi bi-arrows-fullscreen me-1" />Path Clearance
        </p>
        {[
          { label: 'Left lane', pct: leftPct, icon: 'bi-arrow-left' },
          { label: 'Right lane', pct: rightPct, icon: 'bi-arrow-right' },
          { label: 'Overall safe area', pct: safePct, icon: 'bi-aspect-ratio' },
        ].map(({ label, pct, icon }) => {
          const good = pct >= 50;
          return (
            <div key={label} className="mb-2">
              <div className="d-flex justify-content-between mb-1">
                <small className="text-secondary">
                  <i className={`bi ${icon} me-1`} />{label}
                </small>
                <small className={`fw-bold text-${good ? 'success' : 'danger'}`}>{pct}%</small>
              </div>
              <div className="progress" style={{ height: 6, background: 'rgba(255,255,255,0.05)' }}>
                <div className={`progress-bar bg-${good ? 'success' : 'danger'}`}
                  style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        <div className="d-flex gap-2 mt-3">
          <span className={`badge ${result.center_clear ? 'bg-success' : 'bg-danger'}`}>
            <i className={`bi ${result.center_clear ? 'bi-check' : 'bi-x'} me-1`} />
            Centre {result.center_clear ? 'clear' : 'blocked'}
          </span>
        </div>
      </div>
    </>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

const Home = () => {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState('surveillance');
  const { addToast } = useToast();

  const selectedMode = MODES.find(m => m.value === mode);

  /* drag-and-drop */
  const onDragOver = useCallback((e) => { e.preventDefault(); setIsDragActive(true); }, []);
  const onDragLeave = useCallback((e) => { e.preventDefault(); setIsDragActive(false); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault(); setIsDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('image/')) handleFileSelect(f);
    else addToast('Please upload a valid image file.', 'error');
  }, [addToast]);

  const handleFileChange = (e) => { if (e.target.files?.[0]) handleFileSelect(e.target.files[0]); };

  const handleFileSelect = (f) => {
    setFile(f); setPreview(URL.createObjectURL(f)); setResult(null);
    addToast('Image selected.', 'info');
  };

  const handleAnalyze = async () => {
    if (!file) { addToast('Please upload an image first.', 'error'); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', mode);

      // /process-frame for all modes
      const res = await fetch(`${API_BASE}/process-frame`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      addToast('Analysis complete!', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to analyze image.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetUpload = () => { setFile(null); setPreview(null); setResult(null); };

  const navMeta = result ? (NAV_META[result.navigation] ?? null) : null;

  /* ── JSX ─────────────────────────────────────────────────────────────── */
  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="card border-secondary shadow-lg overflow-hidden"
        style={{ backgroundColor: 'rgba(22,26,31,0.95)' }}
      >
        <div className="card-body p-4 p-md-5">

          {/* Page title */}
          <div className="text-center mb-4">
            <h2 className="display-6 fw-bold mb-1" style={{
              background: `linear-gradient(135deg,${selectedMode.color},#22d3ee)`,
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              transition: 'all 0.4s'
            }}>
              <i className={`bi ${selectedMode.icon} me-2`}
                style={{ WebkitTextFillColor: selectedMode.color }} />
              Image Analysis
            </h2>
            <p className="text-secondary small mb-0">{selectedMode.desc}</p>
          </div>

          {/* ── Mode selector ────────────────────────────────────────────── */}
          <div className="d-flex gap-2 justify-content-center mb-4 flex-wrap">
            {MODES.map(m => (
              <button key={m.value}
                onClick={() => { setMode(m.value); setResult(null); }}
                className="btn btn-sm d-flex align-items-center gap-2 px-3 py-2 rounded-pill"
                style={{
                  border: `1.5px solid ${mode === m.value ? m.color : 'rgba(100,116,139,0.3)'}`,
                  background: mode === m.value ? `${m.color}18` : 'transparent',
                  color: mode === m.value ? m.color : '#94a3b8',
                  fontWeight: mode === m.value ? 700 : 400,
                  transition: 'all 0.2s',
                }}
              >
                <i className={`bi ${m.icon}`} />
                {m.label}
              </button>
            ))}
          </div>

          {/* ── Upload / Preview ─────────────────────────────────────────── */}
          <AnimatePresence mode="wait">
            {!preview ? (
              <motion.div key="drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div
                  className="position-relative rounded-3 p-5 text-center"
                  style={{
                    border: `2px dashed ${isDragActive ? selectedMode.color : '#495057'}`,
                    background: isDragActive ? `${selectedMode.color}0e` : 'transparent',
                    cursor: 'pointer', transition: 'all .2s'
                  }}
                  onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
                >
                  <input type="file" accept="image/*" onChange={handleFileChange}
                    className="position-absolute top-0 start-0 w-100 h-100 opacity-0"
                    style={{ cursor: 'pointer' }} />
                  <div className="d-flex flex-column align-items-center gap-2 pe-none">
                    <i className="bi bi-cloud-arrow-up" style={{ fontSize: '3rem', color: selectedMode.color }} />
                    <p className="fs-5 fw-medium text-light mb-0">
                      {isDragActive ? 'Drop image here' : 'Drag & Drop or Click to Browse'}
                    </p>
                    <p className="small text-secondary mb-0">JPG • PNG • WEBP</p>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="d-flex flex-column gap-3">
                {/* Image preview */}
                <div className="position-relative rounded-3 overflow-hidden bg-black ratio ratio-16x9">
                  <div className="d-flex align-items-center justify-content-center w-100 h-100">
                    <img src={preview} alt="Preview" className="img-fluid"
                      style={{ maxHeight: '100%', objectFit: 'contain' }} />
                  </div>
                  <div className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
                    style={{ background: 'rgba(0,0,0,0)', transition: 'background .25s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.55)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(0,0,0,0)'}>
                    <button className="btn btn-danger opacity-0"
                      style={{ transition: 'opacity .25s' }} onClick={resetUpload}
                      onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '0'}>
                      Remove Image
                    </button>
                  </div>
                </div>

                {!result && (
                  <div className="d-flex justify-content-center">
                    <button onClick={handleAnalyze} disabled={loading}
                      className="btn rounded-pill px-5 py-2 fw-semibold text-white shadow"
                      style={{ background: `linear-gradient(135deg,${selectedMode.color},#06b6d4)`, border: 'none' }}>
                      {loading
                        ? <LoadingSpinner size="sm" message="Analysing…" />
                        : <><i className={`bi ${selectedMode.icon} me-2`} />Analyse Image</>
                      }
                    </button>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Results ──────────────────────────────────────────────────── */}
          <AnimatePresence>
            {result && (
              <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="mt-4 pt-4 border-top border-secondary d-flex flex-column gap-3">

                {/* Mode badge */}
                <div className="d-flex align-items-center justify-content-between">
                  <span className="badge rounded-pill px-3 py-2"
                    style={{ background: `${selectedMode.color}22`, color: selectedMode.color, border: `1px solid ${selectedMode.color}44` }}>
                    <i className={`bi ${selectedMode.icon} me-1`} />{selectedMode.label} Mode
                  </span>
                  {result.timing_ms?.total_ms && (
                    <span className="text-secondary" style={{ fontSize: '0.72rem' }}>
                      <i className="bi bi-stopwatch me-1" />
                      {Math.round(1000 / result.timing_ms.total_ms)} FPS &nbsp;·&nbsp; {result.timing_ms.total_ms} ms
                    </span>
                  )}
                </div>

                {/* AI Summary (all modes) */}
                {result.scene_description && (
                  <div className="rounded-3 p-4" style={{ background: 'rgba(14,165,233,0.07)', border: '1px solid rgba(14,165,233,0.2)' }}>
                    <p className="small fw-bold text-info text-uppercase mb-2">
                      <i className="bi bi-stars me-2" />AI Summary
                    </p>
                    <p className="text-light fs-6 mb-0 lh-base">{result.scene_description}</p>
                  </div>
                )}

                {/* ── Mode-specific panels ─────────────────────────────── */}
                <AnimatePresence mode="wait">
                  {mode === 'surveillance' && (
                    <motion.div key="surv" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="d-flex flex-column gap-3">
                      <SurveillancePanel result={result} />
                    </motion.div>
                  )}
                  {mode === 'assistive' && (
                    <motion.div key="asst" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="d-flex flex-column gap-3">
                      <AssistivePanel result={result} />
                    </motion.div>
                  )}
                  {mode === 'self_driving' && (
                    <motion.div key="selfd" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="d-flex flex-column gap-3">
                      <SelfDrivingPanel result={result} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Navigation suggestion (surveillance + assistive) */}
                {mode !== 'self_driving' && navMeta && (
                  <div className={`p-3 rounded-3 border border-${navMeta.cls} d-flex align-items-center gap-3`}
                    style={{ background: `rgba(var(--bs-${navMeta.cls}-rgb,0,0,0),0.1)` }}>
                    <i className={`bi ${navMeta.icon} text-${navMeta.cls} fs-3`} />
                    <div>
                      <p className="fw-bold text-light mb-0">{result.navigation}</p>
                      <small className="text-secondary">
                        Clear area: {(result.safe_ratio * 100).toFixed(0)}% of frame
                      </small>
                    </div>
                  </div>
                )}

                {/* Depth + free-space thumbnails */}
                {(result.depth_map || result.free_mask) && (
                  <div className="row g-3">
                    {result.depth_map && (
                      <div className="col-6">
                        <p className="small text-info fw-bold text-uppercase mb-1" style={{ fontSize: '0.7rem' }}>
                          <i className="bi bi-layers-fill me-1" />Depth Map
                        </p>
                        <img src={`data:image/png;base64,${result.depth_map}`}
                          alt="Depth Map" className="img-fluid rounded-2 w-100" />
                      </div>
                    )}
                    {result.free_mask && (
                      <div className="col-6">
                        <p className="small text-info fw-bold text-uppercase mb-1" style={{ fontSize: '0.7rem' }}>
                          <i className="bi bi-map-fill me-1" />Free Space
                        </p>
                        <img src={`data:image/png;base64,${result.free_mask}`}
                          alt="Free Space" className="img-fluid rounded-2 w-100" />
                      </div>
                    )}
                  </div>
                )}

                {/* Reset */}
                <button onClick={resetUpload}
                  className="btn btn-link text-secondary text-decoration-none w-100 small mt-1">
                  <i className="bi bi-arrow-counterclockwise me-1" />Analyse another image
                </button>
              </motion.div>
            )}
          </AnimatePresence>

        </div>
      </motion.div>
    </div>
  );
};

export default Home;
