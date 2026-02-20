import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const ToastContainer = ({ toasts, removeToast }) => {
  return (
    <div className="toast-container position-fixed top-0 end-0 p-3" style={{ zIndex: 1060 }}>
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 50, scale: 0.9 }}
            layout
            className={`toast show align-items-center text-white bg-${toast.type === 'error' ? 'danger' : toast.type} border-0 mb-2 shadow`}
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            style={{ backgroundColor: toast.type === 'success' ? '#198754' : toast.type === 'info' ? '#0dcaf0' : undefined }}
          >
            <div className="d-flex">
              <div className="toast-body d-flex align-items-center gap-2">
                {toast.type === 'success' && <i className="bi bi-check-circle-fill"></i>}
                {toast.type === 'error' && <i className="bi bi-exclamation-triangle-fill"></i>}
                {toast.type === 'info' && <i className="bi bi-info-circle-fill"></i>}
                {toast.message}
              </div>
              <button
                type="button"
                className="btn-close btn-close-white me-2 m-auto"
                onClick={() => removeToast(toast.id)}
                aria-label="Close"
              ></button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ToastContainer;
