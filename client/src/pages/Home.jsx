import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LoadingSpinner from '../components/LoadingSpinner';
import { useToast } from '../context/ToastContext';
import { uploadImage } from '../services/api';
import ObjectAlertCard from '../components/ObjectAlertCard';
import ResultCard from '../components/ResultCard';

/* ── API base ─────────────────────────────────────────────────────────────── */
const API_BASE = 'http://localhost:8000';

import ModeSelector, { MODES } from '../components/ModeSelector';

/* ── helpers ─────────────────────────────────────────────────────────────── */

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

/** Video Analysis — global summary, object counts, and deduplicated timeline */
function VideoAnalysisPanel({ result }) {
  if (!result) return null;

  return (
    <div className="d-flex flex-column gap-4">
      {/* Global Summary */}
      <div className="rounded-4 p-4 shadow-sm"
        style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
        <div className="d-flex align-items-center gap-2 mb-2">
          <i className="bi bi-stars text-primary fs-5" />
          <p className="small fw-bold text-primary text-uppercase mb-0" style={{ letterSpacing: '0.05em' }}>
            AI Intelligence Summary
          </p>
        </div>
        <p className="text-light fs-5 mb-0 fw-semibold lh-base">{result.video_summary}</p>
      </div>

      <div className="row g-4">
        {/* Statistics Overview */}
        <div className="col-lg-5">
          <div className="d-flex flex-column gap-3 h-100">
            {/* Total Analyzed */}
            <div className="card bg-dark border-secondary">
              <div className="card-body p-3 d-flex align-items-center justify-content-between">
                <div className="d-flex align-items-center gap-2">
                  <i className="bi bi-camera-reels text-info" />
                  <span className="small text-secondary fw-bold">ANALYZED</span>
                </div>
                <span className="text-light fw-bold fs-5">{result.total_frames_analyzed} Frames</span>
              </div>
            </div>

            {/* Object Counts */}
            <div className="card bg-dark border-secondary flex-grow-1">
              <div className="card-body p-3">
                <p className="small fw-bold text-secondary text-uppercase mb-3">
                  <i className="bi bi-graph-up-arrow me-2" />Object Frequency
                </p>
                <div className="d-flex flex-wrap gap-2">
                  {Object.entries(result.object_counts || {}).map(([label, count]) => (
                    <div key={label} className="badge rounded-pill px-3 py-2 bg-black border border-secondary d-flex align-items-center gap-2">
                      <span className="text-info fw-bold">{count}</span>
                      <span className="text-secondary text-capitalize">{label}</span>
                    </div>
                  ))}
                  {(!result.object_counts || Object.keys(result.object_counts).length === 0) && (
                    <p className="text-secondary small fst-italic">No objects detected</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Timeline vs Accordion */}
        <div className="col-lg-7">
          <div className="card bg-dark border-secondary h-100">
            <div className="card-body p-3">
              <p className="small fw-bold text-secondary text-uppercase mb-3">
                <i className="bi bi-clock-history me-2" />Event Timeline
              </p>

              <div className="accordion accordion-flush" id="videoTimeline">
                {result.frame_summaries?.map((frame, idx) => (
                  <div className="accordion-item bg-transparent border-bottom border-secondary-subtle" key={idx}>
                    <h2 className="accordion-header">
                      <button className="accordion-button collapsed bg-transparent text-light py-2 px-0 shadow-none border-0 d-flex align-items-center gap-3"
                        type="button" data-bs-toggle="collapse" data-bs-target={`#collapse${idx}`} aria-expanded="false">
                        <span className="badge bg-secondary-subtle text-secondary">{frame.timestamp_sec}s</span>
                        <span className="text-truncate flex-grow-1 small opacity-75">{frame.summary}</span>
                      </button>
                    </h2>
                    <div id={`collapse${idx}`} className="accordion-collapse collapse" data-bs-parent="#videoTimeline">
                      <div className="accordion-body px-0 py-3 text-secondary-subtle small border-top border-secondary">
                        <p className="mb-2 text-light">{frame.caption || frame.summary}</p>
                        <div className="d-flex flex-wrap gap-2">
                          {frame.detections?.map((d, i) => (
                            <span key={i} className="badge bg-black border border-secondary text-info fw-normal">
                              {d.label} ({Math.round(d.confidence * 100)}%)
                            </span>
                          ))}
                        </div>
                        {frame.processing_ms && (
                          <div className="mt-3 pt-2 border-top border-secondary-subtle d-flex align-items-center gap-2 opacity-50">
                            <i className="bi bi-cpu" />
                            <span>Inference delay: {frame.processing_ms}ms</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

const Home = () => {
  const [activeTab, setActiveTab] = useState('image'); // 'image' or 'video'
  const [mode, setMode] = useState('surveillance');
  const [isDragActive, setIsDragActive] = useState(false);

  // Image Specific State
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageResult, setImageResult] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);

  // Video Specific State
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreview, setVideoPreview] = useState(null);
  const [videoResult, setVideoResult] = useState(null);
  const [videoLoading, setVideoLoading] = useState(false);

  const { addToast } = useToast();

  const selectedMode = MODES.find(m => m.value === mode);

  // Derived state for current view
  const file = activeTab === 'image' ? imageFile : videoFile;
  const preview = activeTab === 'image' ? imagePreview : videoPreview;
  const result = activeTab === 'image' ? imageResult : videoResult;
  const loading = activeTab === 'image' ? imageLoading : videoLoading;

  /* Tab switching cleanup - No longer resetting upload to maintain state persistence */
  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  /* drag-and-drop */
  const onDragOver = useCallback((e) => { e.preventDefault(); setIsDragActive(true); }, []);
  const onDragLeave = useCallback((e) => { e.preventDefault(); setIsDragActive(false); }, []);
  const onDrop = useCallback((e) => {
    e.preventDefault(); setIsDragActive(false);
    const f = e.dataTransfer.files[0];
    if (activeTab === 'image') {
      if (f?.type.startsWith('image/')) handleFileSelect(f, 'image');
      else addToast('Please upload a valid image file.', 'error');
    } else {
      if (f?.type.startsWith('video/')) handleFileSelect(f, 'video');
      else addToast('Please upload a valid MP4 video.', 'error');
    }
  }, [addToast, activeTab]);

  const handleFileChange = (e) => {
    if (e.target.files?.[0]) handleFileSelect(e.target.files[0], activeTab);
  };

  const handleFileSelect = (f, type = activeTab) => {
    const url = URL.createObjectURL(f);
    if (type === 'image') {
      setImageFile(f);
      setImagePreview(url);
      setImageResult(null); // Clear previous result on new upload
    } else {
      setVideoFile(f);
      setVideoPreview(url);
      setVideoResult(null); // Clear previous result on new upload
    }
    addToast(`${type === 'image' ? 'Image' : 'Video'} selected.`, 'info');
  };

  const handleAnalyze = async () => {
    const currentFile = activeTab === 'image' ? imageFile : videoFile;
    if (!currentFile) {
      addToast(`Please upload ${activeTab === 'image' ? 'an image' : 'a video'} first.`, 'error');
      return;
    }

    // Prevent overlapping calls for same tab
    const isLoading = activeTab === 'image' ? imageLoading : videoLoading;
    if (isLoading) return;

    if (activeTab === 'image') setImageLoading(true);
    else setVideoLoading(true);

    try {
      const fd = new FormData();
      fd.append('file', currentFile);
      fd.append('mode', mode);

      const endpoint = activeTab === 'image' ? '/process-frame' : '/process-video';
      const res = await fetch(`${API_BASE}${endpoint}`, { method: 'POST', body: fd });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (activeTab === 'image') setImageResult(data);
      else setVideoResult(data);

      addToast('Analysis complete!', 'success');
    } catch (err) {
      addToast(err.message || 'Failed to analyze.', 'error');
    } finally {
      if (activeTab === 'image') setImageLoading(false);
      else setVideoLoading(false);
    }
  };

  const resetUpload = () => {
    if (activeTab === 'image') {
      setImageFile(null); setImagePreview(null); setImageResult(null);
    } else {
      setVideoFile(null); setVideoPreview(null); setVideoResult(null);
    }
  };


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

          {/* ── Tabs selector ────────────────────────────────────────────── */}
          <ul className="nav nav-pills nav-justified bg-dark p-1 rounded-pill mb-4 border border-secondary"
            style={{ backgroundColor: 'rgba(0,0,0,0.2) !important' }}>
            <li className="nav-item">
              <button className={`nav-link rounded-pill py-2 btn-sm ${activeTab === 'image' ? 'active' : 'text-secondary'}`}
                style={activeTab === 'image' ? { background: selectedMode.color } : {}}
                onClick={() => handleTabChange('image')}>
                <i className="bi bi-image me-2" />Image Captioning
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link rounded-pill py-2 btn-sm ${activeTab === 'video' ? 'active' : 'text-secondary'}`}
                style={activeTab === 'video' ? { background: selectedMode.color } : {}}
                onClick={() => handleTabChange('video')}>
                <i className="bi bi-play-circle me-2" />Video Captioning
              </button>
            </li>
          </ul>

          <div className="text-center mb-4">
            <h2 className="display-6 fw-bold mb-1" style={{
              color: selectedMode.color,
              textShadow: '0 2px 15px rgba(0,0,0,0.4)',
              transition: 'all 0.4s'
            }}>
              <i className={`bi ${activeTab === 'image' ? selectedMode.icon : 'bi-camera-reels-fill'} me-2`} />
              {activeTab === 'image' ? 'Image Analysis' : 'Video Intelligence'}
            </h2>
            <p className="text-secondary small mb-0">
              {activeTab === 'image' ? selectedMode.desc : 'Analyze video timeline · aggregate object counts · professional summary'}
            </p>
          </div>

          {/* ── Mode selector ────────────────────────────────────────────── */}
          <div className="d-flex justify-content-center mb-4">
            <ModeSelector activeMode={mode} onChange={(m) => setMode(m)} />
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
                  <input type="file" accept={activeTab === 'image' ? 'image/*' : 'video/mp4'} onChange={handleFileChange}
                    className="position-absolute top-0 start-0 w-100 h-100 opacity-0"
                    style={{ cursor: 'pointer' }} />
                  <div className="d-flex flex-column align-items-center gap-2 pe-none">
                    <i className={`bi ${activeTab === 'image' ? 'bi-cloud-arrow-up' : 'bi-file-earmark-play'}`}
                      style={{ fontSize: '3.5rem', color: selectedMode.color }} />
                    <p className="fs-5 fw-medium text-light mb-0">
                      {isDragActive ? `Drop ${activeTab} here` : `Drag & Drop or Click to Browse ${activeTab}`}
                    </p>
                    <p className="small text-secondary mb-0">
                      {activeTab === 'image' ? 'JPG • PNG • WEBP' : 'MP4 VIDEO'}
                    </p>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="d-flex flex-column gap-3">
                {/* Preview */}
                <div className="position-relative rounded-3 overflow-hidden bg-black ratio ratio-16x9 shadow-lg">
                  <div className="d-flex align-items-center justify-content-center w-100 h-100">
                    {activeTab === 'image' ? (
                      <img src={preview} alt="Preview" className="img-fluid"
                        style={{ maxHeight: '100%', objectFit: 'contain' }} />
                    ) : (
                      <video src={preview} controls className="w-100 h-100" style={{ objectFit: 'contain' }} />
                    )}
                  </div>
                  <div className="position-absolute top-0 end-0 p-2" style={{ zIndex: 10 }}>
                    <button className="btn btn-danger btn-sm rounded-circle shadow"
                      onClick={resetUpload} title="Remove file">
                      <i className="bi bi-x-lg" />
                    </button>
                  </div>
                </div>

                {!result && (
                  <div className="d-flex justify-content-center">
                    <button onClick={handleAnalyze} disabled={loading}
                      className="btn rounded-pill px-5 py-2 fw-semibold text-white shadow-lg"
                      style={{ background: `linear-gradient(135deg,${selectedMode.color},#06b6d4)`, border: 'none' }}>
                      {loading
                        ? <LoadingSpinner size="sm" message={`Analysing ${activeTab}…`} />
                        : <><i className={`bi ${activeTab === 'image' ? selectedMode.icon : 'bi-play-fill'} me-2`} />Analyse {activeTab === 'image' ? 'Image' : 'Video'}</>
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

                {/* ── Mode-specific Results Content ────────────────────────── */}
                <AnimatePresence mode="wait">
                  {/* Image specific meta */}
                  {activeTab === 'image' && (
                    <motion.div key="image-meta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <div className="d-flex align-items-center justify-content-between mb-3">
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

                      {/* Reusable ResultCard for AI Summary + Badges + Navigation */}
                      <ResultCard
                        summary={result.scene_description}
                        detections={result.detections}
                        navigation={result.navigation}
                        mode={mode}
                        safeRatio={result.safe_ratio}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence mode="wait">
                  {activeTab === 'image' ? (
                    <motion.div key="image-panels" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="d-flex flex-column gap-3">
                      {mode === 'surveillance' && <SurveillancePanel result={result} />}
                      {mode === 'assistive' && <AssistivePanel result={result} />}
                      {mode === 'self_driving' && <SelfDrivingPanel result={result} />}
                    </motion.div>
                  ) : (
                    <motion.div key="video-panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      <VideoAnalysisPanel result={result} />
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Depth + free-space thumbnails (Image mode only) */}
                {activeTab === 'image' && (result.depth_map || result.free_mask) && (
                  <div className="row g-3">
                    {result.depth_map && (
                      <div className="col-6">
                        <div className="card bg-black border-secondary overflow-hidden">
                          <div className="card-header border-secondary bg-transparent py-1">
                            <p className="small text-info fw-bold text-uppercase mb-0" style={{ fontSize: '0.65rem' }}>
                              <i className="bi bi-layers-fill me-1" />Depth Topology
                            </p>
                          </div>
                          <img src={`data:image/png;base64,${result.depth_map}`}
                            alt="Depth Map" className="img-fluid w-100" />
                        </div>
                      </div>
                    )}
                    {result.free_mask && (
                      <div className="col-6">
                        <div className="card bg-black border-secondary overflow-hidden">
                          <div className="card-header border-secondary bg-transparent py-1">
                            <p className="small text-info fw-bold text-uppercase mb-0" style={{ fontSize: '0.65rem' }}>
                              <i className="bi bi-map-fill me-1" />Safety Mask
                            </p>
                          </div>
                          <img src={`data:image/png;base64,${result.free_mask}`}
                            alt="Free Space" className="img-fluid w-100" />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Reset */}
                <button onClick={resetUpload}
                  className="btn btn-link text-secondary text-decoration-none w-100 small mt-1 py-0">
                  <i className="bi bi-arrow-counterclockwise me-1" />Analyze another {activeTab}
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
