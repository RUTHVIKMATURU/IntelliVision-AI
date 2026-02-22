import React from 'react';

export const MODES = [
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

const ModeSelector = ({ activeMode, onChange }) => {
  const selected = MODES.find(m => m.value === activeMode) || MODES[0];

  return (
    <div className="dropdown">
      <button
        className="btn btn-sm d-flex align-items-center gap-3 px-4 py-2 rounded-pill shadow-sm dropdown-toggle border-secondary"
        type="button"
        data-bs-toggle="dropdown"
        aria-expanded="false"
        style={{
          background: 'rgba(30, 41, 59, 0.7)',
          backdropFilter: 'blur(10px)',
          color: selected.color,
          border: `1px solid ${selected.color}44`,
          transition: 'all 0.3s ease'
        }}
      >
        <div className="d-flex align-items-center gap-2">
          <i className={`bi ${selected.icon} fs-5`} />
          <div className="text-start">
            <span className="d-block fw-bold" style={{ fontSize: '0.85rem' }}>{selected.label}</span>
          </div>
        </div>
      </button>

      <ul className="dropdown-menu dropdown-menu-dark p-2 border-secondary shadow-lg mt-2 overflow-hidden"
        style={{
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(12px)',
          borderRadius: '1rem',
          minWidth: '240px'
        }}>
        <div className="px-3 py-1 mb-2">
          <small className="text-secondary fw-bold text-uppercase" style={{ fontSize: '0.65rem', letterSpacing: '0.05em' }}>
            Select Analysis Mode
          </small>
        </div>
        {MODES.map((m) => (
          <li key={m.value}>
            <button
              className={`dropdown-item rounded-3 mb-1 p-3 d-flex align-items-center gap-3 ${activeMode === m.value ? 'active' : ''}`}
              onClick={() => onChange(m.value)}
              style={activeMode === m.value ? { background: `${m.color}22`, color: m.color } : {}}
            >
              <i className={`bi ${m.icon} fs-4`} style={{ color: activeMode === m.value ? m.color : '#94a3b8' }} />
              <div>
                <span className="d-block fw-bold mb-0" style={{ fontSize: '0.9rem' }}>{m.label}</span>
                <small className="text-secondary d-block" style={{ fontSize: '0.7rem', lineHeight: '1.2' }}>{m.desc}</small>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ModeSelector;
