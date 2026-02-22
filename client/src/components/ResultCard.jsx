import React from 'react';
import { motion } from 'framer-motion';

const NAV_META = {
  'Move Forward': { icon: 'bi-arrow-up-circle-fill', cls: 'success' },
  'Move Slightly Left': { icon: 'bi-arrow-left-circle-fill', cls: 'warning' },
  'Move Slightly Right': { icon: 'bi-arrow-right-circle-fill', cls: 'warning' },
  'Obstacle Ahead': { icon: 'bi-exclamation-triangle-fill', cls: 'danger' },
  'Turn Left': { icon: 'bi-arrow-left-circle-fill', cls: 'warning' },
  'Turn Right': { icon: 'bi-arrow-right-circle-fill', cls: 'warning' },
  'Stop': { icon: 'bi-stop-circle-fill', cls: 'danger' },
};

const ResultCard = ({ summary, detections, navigation, mode, safeRatio }) => {
  const navMeta = navigation ? (NAV_META[navigation] ?? null) : null;
  const isSurveillance = mode === 'surveillance';

  return (
    <div className="d-flex flex-column gap-3">
      {/* AI Summary Section */}
      {summary && (
        <div className="rounded-4 p-4 shadow-sm"
          style={{ background: 'rgba(14,165,233,0.07)', border: '1px solid rgba(14,165,233,0.2)' }}>
          <div className="d-flex align-items-center gap-2 mb-2">
            <i className="bi bi-stars text-info fs-5" />
            <p className="small fw-bold text-info text-uppercase mb-0" style={{ letterSpacing: '0.05em' }}>
              AI Intelligence Description
            </p>
          </div>
          <p className="text-light fs-6 mb-3 lh-base fw-medium">{summary}</p>

          {/* Object Badges inside the same card for context */}
          {detections?.length > 0 && (
            <div className="d-flex flex-wrap gap-2 pt-2 border-top border-info border-opacity-10">
              {detections.slice(0, 8).map((det, i) => (
                <span key={i} className="badge bg-black border border-secondary text-info fw-normal rounded-pill px-3 py-2"
                  style={{ fontSize: '0.75rem' }}>
                  {det.label} <span className="opacity-50 ms-1">{Math.round((det.confidence || 0) * 100)}%</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Navigation Signal (Hidden in Surveillance) */}
      {!isSurveillance && navMeta && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`p-4 rounded-4 border border-${navMeta.cls} d-flex align-items-center gap-3 shadow-sm`}
          style={{ background: `rgba(var(--bs-${navMeta.cls}-rgb,0,0,0),0.08)` }}
        >
          <div className={`rounded-circle p-3 d-flex align-items-center justify-content-center bg-${navMeta.cls} bg-opacity-10`}>
            <i className={`bi ${navMeta.icon} text-${navMeta.cls} fs-1`} />
          </div>
          <div className="flex-grow-1">
            <p className="small fw-bold text-uppercase mb-1" style={{ color: `var(--bs-${navMeta.cls})`, opacity: 0.8, letterSpacing: '0.05em' }}>
              Tactical Navigation Signal
            </p>
            <p className="fw-bold text-light mb-0 fs-4">{navigation}</p>
            {safeRatio !== undefined && (
              <div className="mt-2 d-flex align-items-center gap-2">
                <div className="progress flex-grow-1" style={{ height: 4, background: 'rgba(255,255,255,0.05)', maxWidth: 100 }}>
                  <div className={`progress-bar bg-${navMeta.cls}`} style={{ width: `${safeRatio * 100}%` }} />
                </div>
                <small className="text-secondary opacity-75" style={{ fontSize: '0.7rem' }}>
                  {Math.round(safeRatio * 100)}% Path Clearance
                </small>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default ResultCard;
