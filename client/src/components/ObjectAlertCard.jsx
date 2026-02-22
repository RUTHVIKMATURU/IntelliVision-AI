/**
 * ObjectAlertCard
 * Reusable card for displaying a single detected object.
 *
 * Props:
 *   label         {string}  – object name, e.g. "person"
 *   confidence    {number}  – 0-1 confidence score
 *   direction     {string}  – "Left" | "Center" | "Right"
 *   verticalZone  {string}  – "Upper" | "Middle" | "Lower"
 *   distance      {string}  – "Very Close" | "Near" | "Medium" | "Far"
 *   priorityLevel {string}  – "Critical" | "High" | "Medium" | "Low" | "Minimal"
 *   urgency       {boolean} – true → red highlight
 *   alert         {string}  – natural-language sentence
 *   animDelay     {number}  – optional stagger delay in seconds (default 0)
 */

import { motion } from 'framer-motion';

/* ── inject flash keyframes once ─────────────────────────────────── */
(() => {
  if (document.getElementById('oac-flash-style')) return;
  const el = document.createElement('style');
  el.id = 'oac-flash-style';
  el.textContent = `
    @keyframes urgency-flash {
      0%   { box-shadow: 0 0 0 0   rgba(220,53,69,0);   }
      35%  { box-shadow: 0 0 0 4px rgba(220,53,69,0.45); }
      100% { box-shadow: 0 0 0 0   rgba(220,53,69,0);   }
    }
    .oac-urgent-flash {
      animation: urgency-flash 0.6s ease-out 1;
    }
  `;
  document.head.appendChild(el);
})();

/* ── urgency-tier helpers ─────────────────────────────────────────── */
const urgencyTier = (priorityLevel, urgency) => {
  if (urgency || ['Critical', 'High'].includes(priorityLevel)) return 'high';
  if (priorityLevel === 'Medium') return 'medium';
  return 'low';
};

const TIER_STYLE = {
  high: {
    borderColor: '#dc3545',
    background: 'rgba(220,53,69,0.09)',
    badgeCls: 'danger',
    badgeLabel: 'High Urgency',
    icon: 'bi-exclamation-triangle-fill',
    iconColor: '#dc3545',
  },
  medium: {
    borderColor: '#ffc107',
    background: 'rgba(255,193,7,0.08)',
    badgeCls: 'warning',
    badgeLabel: 'Medium Urgency',
    icon: 'bi-exclamation-circle-fill',
    iconColor: '#ffc107',
  },
  low: {
    borderColor: '#198754',
    background: 'rgba(25,135,84,0.07)',
    badgeCls: 'success',
    badgeLabel: 'Low Urgency',
    icon: 'bi-check-circle-fill',
    iconColor: '#198754',
  },
};

const DIRECTION_ICON = {
  Left: 'bi-arrow-left',
  Center: 'bi-arrow-up',
  Right: 'bi-arrow-right',
};

/* ── component ───────────────────────────────────────────────────── */
const ObjectAlertCard = ({
  label = 'object',
  confidence = 0,
  direction = 'Center',
  verticalZone = '',
  distance = 'Unknown',
  priorityLevel = 'Low',
  urgency = false,
  alert = '',
  animDelay = 0,
}) => {
  const tier = urgencyTier(priorityLevel, urgency);
  const style = TIER_STYLE[tier];
  const dirIcon = DIRECTION_ICON[direction] ?? 'bi-arrow-up';

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      transition={{ delay: animDelay, duration: 0.22 }}
      className={`d-flex align-items-start gap-3 p-3 rounded-3${tier === 'high' ? ' oac-urgent-flash' : ''}`}
      style={{
        background: style.background,
        borderLeft: `4px solid ${style.borderColor}`,
        border: `1px solid ${style.borderColor}33`,
        borderLeftWidth: '4px',       /* override shorthand */
      }}
    >
      {/* ── Icon ──────────────────────────────────────────────── */}
      <div className="flex-shrink-0 pt-1">
        <i className={`bi ${style.icon}`}
          style={{ fontSize: '1.2rem', color: style.iconColor }} />
      </div>

      {/* ── Body ──────────────────────────────────────────────── */}
      <div className="flex-grow-1 min-w-0">
        {/* Label row */}
        <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
          <span className="fw-semibold text-light text-capitalize"
            style={{ fontSize: '0.95rem' }}>
            {label}
          </span>
          {confidence > 0 && (
            <span className="text-secondary" style={{ fontSize: '0.75rem' }}>
              {(confidence * 100).toFixed(0)}% conf
            </span>
          )}
          {urgency && (
            <span className="badge bg-danger ms-1" style={{ fontSize: '0.65rem' }}>
              URGENT
            </span>
          )}
        </div>

        {/* Alert sentence */}
        {alert && (
          <p className="text-secondary fst-italic mb-2"
            style={{ fontSize: '0.8rem', lineHeight: 1.45 }}>
            {alert}
          </p>
        )}

        {/* Badge row: direction · distance · urgency ────────── */}
        <div className="d-flex flex-wrap gap-1 align-items-center">
          {/* Direction */}
          <span className="badge border border-secondary text-info"
            style={{ background: 'rgba(0,0,0,0.4)', fontSize: '0.67rem' }}>
            <i className={`bi ${dirIcon} me-1`} />
            {verticalZone ? `${verticalZone} ${direction}` : direction}
          </span>

          {/* Distance */}
          <span className="badge border border-secondary text-light"
            style={{ background: 'rgba(0,0,0,0.4)', fontSize: '0.67rem' }}>
            <i className="bi bi-rulers me-1" />{distance}
          </span>

          {/* Urgency tier */}
          <span className={`badge bg-${style.badgeCls} text-uppercase`}
            style={{ fontSize: '0.67rem' }}>
            ● {style.badgeLabel}
          </span>
        </div>
      </div>
    </motion.div>
  );
};

export default ObjectAlertCard;
