import React from 'react';

const LoadingSpinner = ({ size = 'border', message = 'Loading...', className = '' }) => {
  return (
    <div className={`d-flex flex-column justify-content-center align-items-center ${className}`}>
      <div className={`spinner-border text-primary ${size === 'sm' ? 'spinner-border-sm' : ''}`} role="status">
        <span className="visually-hidden">Loading...</span>
      </div>
      {message && <p className="mt-2 text-secondary small">{message}</p>}
    </div>
  );
};

export default LoadingSpinner;
