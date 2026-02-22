import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../context/ToastContext';
import LoadingSpinner from '../components/LoadingSpinner';
import ObjectAlertCard from '../components/ObjectAlertCard';
import { fetchHistory, deleteItem } from '../services/api';

/* ── helpers ─────────────────────────────────────────────────────── */
const NAV_META = {
  'Move Forward': { icon: 'bi-arrow-up-circle-fill', cls: 'success' },
  'Move Slightly Left': { icon: 'bi-arrow-left-circle-fill', cls: 'warning' },
  'Move Slightly Right': { icon: 'bi-arrow-right-circle-fill', cls: 'warning' },
  'Obstacle Ahead': { icon: 'bi-exclamation-triangle-fill', cls: 'danger' },
};

const formatTimestamp = (ts) => {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); }
  catch { return ts; }
};

const getImageUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('blob:')) return url;
  const cleaned = url.replace(/\\/g, '/').replace(/^\//, '');
  return `http://localhost:8000/${cleaned}`;
};

/* ── sub-component: one history card ────────────────────────────── */
const HistoryCard = ({ item, onDelete }) => {
  const [expanded, setExpanded] = useState(false);
  const id = item._id || item.id;
  const detections = Array.isArray(item.detections) ? item.detections : [];
  const navMeta = NAV_META[item.navigation] ?? null;
  const hasObjects = detections.length > 0;
  const urgentCount = detections.filter(d => d?.urgency).length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.28 }}
      className="card border-secondary h-100 shadow-sm"
      style={{ backgroundColor: 'rgba(22,26,31,0.96)', overflow: 'hidden' }}
    >
      {/* ── Image thumbnail ───────────────────────── */}
      <div className="position-relative" style={{ height: 180 }}>
        <img
          src={getImageUrl(item.file_path || item.imageUrl)}
          className="w-100 h-100"
          style={{ objectFit: 'cover' }}
          alt="Analysed frame"
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
        {/* Gradient overlay */}
        <div className="position-absolute bottom-0 start-0 w-100 px-3 py-2"
          style={{ background: 'linear-gradient(to top,rgba(0,0,0,0.85),transparent)' }}>
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-1">
            <small className="text-white-50">
              <i className="bi bi-clock me-1" />{formatTimestamp(item.timestamp)}
            </small>
            <div className="d-flex gap-1">
              {urgentCount > 0 && (
                <span className="badge bg-danger" style={{ fontSize: '0.62rem' }}>
                  {urgentCount} URGENT
                </span>
              )}
              {hasObjects && (
                <span className="badge bg-secondary bg-opacity-75" style={{ fontSize: '0.62rem' }}>
                  {detections.length} objects
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="card-body d-flex flex-column gap-3 p-3">

        {/* ── AI Summary ────────────────────────────── */}
        {item.scene_description && (
          <div className="p-2 px-3 rounded-3 border border-secondary"
            style={{ background: 'rgba(14,165,233,0.06)' }}>
            <p className="text-info fw-bold text-uppercase mb-1" style={{ fontSize: '0.62rem', letterSpacing: '0.05em' }}>
              <i className="bi bi-stars me-1" />Summary
            </p>
            <p className="text-light mb-0" style={{ fontSize: '0.82rem', lineHeight: 1.45 }}>
              {item.scene_description}
            </p>
          </div>
        )}

        {/* ── Navigation row ────────────────────────── */}
        {navMeta && (
          <div className={`d-flex align-items-center gap-2 px-3 py-2 rounded-3 border border-${navMeta.cls}`}
            style={{ background: 'rgba(0,0,0,0.2)' }}>
            <i className={`bi ${navMeta.icon} text-${navMeta.cls}`} />
            <span className={`text-${navMeta.cls} fw-semibold`} style={{ fontSize: '0.82rem' }}>
              {item.navigation}
            </span>
            {item.safe_ratio != null && (
              <span className="text-secondary ms-auto" style={{ fontSize: '0.72rem' }}>
                {(item.safe_ratio * 100).toFixed(0)}% clear
              </span>
            )}
          </div>
        )}

        {/* ── Detected objects ─────────────────────── */}
        {hasObjects && (
          <div className="flex-grow-1">
            <button
              className="btn btn-link text-info text-decoration-none p-0 mb-2 d-flex align-items-center gap-1"
              style={{ fontSize: '0.72rem', letterSpacing: '0.05em' }}
              onClick={() => setExpanded(e => !e)}
            >
              <i className={`bi bi-chevron-${expanded ? 'up' : 'down'}`} />
              <span className="text-uppercase fw-bold">
                <i className="bi bi-bounding-box me-1" />
                {detections.length} Detected Object{detections.length !== 1 ? 's' : ''}
              </span>
            </button>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                  className="overflow-hidden"
                >
                  <div className="d-flex flex-column gap-2">
                    {detections.map((det, i) => {
                      /* Handle both string-only (legacy) and object (new) detections */
                      if (typeof det === 'string') {
                        return (
                          <span key={i} className="badge bg-secondary bg-opacity-25 text-info border border-secondary fw-normal py-1 px-2">
                            {det}
                          </span>
                        );
                      }
                      return (
                        <ObjectAlertCard
                          key={i}
                          label={det.label}
                          confidence={det.confidence}
                          direction={det.direction}
                          verticalZone={det.vertical_zone}
                          distance={det.distance}
                          priorityLevel={det.priority_level}
                          urgency={det.urgency}
                          alert={det.alert}
                          animDelay={i * 0.04}
                        />
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Delete button ─────────────────────────── */}
        <button
          onClick={() => onDelete(id)}
          className="btn btn-outline-danger btn-sm w-100 d-flex align-items-center justify-content-center gap-2 mt-auto"
        >
          <i className="bi bi-trash" /> Delete
        </button>
      </div>
    </motion.div>
  );
};

/* ── main page ───────────────────────────────────────────────────── */
const History = () => {
  const [historyItems, setHistoryItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    try {
      const data = await fetchHistory();
      setHistoryItems(data);
    } catch {
      addToast('Failed to load history', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!id) return;
    try {
      await deleteItem(id);
      setHistoryItems(prev => prev.filter(item => (item._id || item.id) !== id));
      addToast('Item deleted', 'info');
    } catch {
      addToast('Failed to delete item', 'error');
    }
  };

  return (
    <div className="container-fluid px-3 px-md-4" style={{ maxWidth: 1100 }}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Header */}
        <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-2">
          <h2 className="display-6 fw-bold mb-0" style={{
            background: 'linear-gradient(135deg,#a78bfa,#e879f9)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>
            <i className="bi bi-clock-history me-2" style={{ WebkitTextFillColor: '#a78bfa' }} />
            Analysis History
          </h2>
          {!isLoading && (
            <span className="badge bg-secondary text-light">
              {historyItems.length} record{historyItems.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* States */}
        {isLoading ? (
          <div className="d-flex justify-content-center py-5">
            <LoadingSpinner message="Loading history…" />
          </div>
        ) : historyItems.length === 0 ? (
          <div className="text-center py-5">
            <i className="bi bi-journal-x text-secondary opacity-25" style={{ fontSize: '4rem' }} />
            <p className="lead text-secondary mt-3 mb-1">No history found</p>
            <p className="text-muted small">Upload an image to start building your analysis history.</p>
          </div>
        ) : (
          /* ── Grid ──────────────────────────────────────────────── */
          <div className="row g-4">
            <AnimatePresence>
              {historyItems.map(item => (
                <div className="col-sm-6 col-lg-4" key={item._id || item.id}>
                  <HistoryCard item={item} onDelete={handleDelete} />
                </div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default History;
