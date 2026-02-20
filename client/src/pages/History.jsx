import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../context/ToastContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { fetchHistory, deleteItem } from '../services/api';

const History = () => {
  const [historyItems, setHistoryItems] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const data = await fetchHistory();
      setHistoryItems(data);
    } catch (error) {
      console.error('Error fetching history:', error);
      addToast('Failed to load history', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const getImageUrl = (url) => {
    if (!url) return '';
    if (url.startsWith('http') || url.startsWith('blob:')) return url;
    // Normalize backslashes to forward slashes for Windows paths
    const normalizedUrl = url.replace(/\\/g, '/');
    return `http://localhost:8000/${normalizedUrl.startsWith('/') ? normalizedUrl.slice(1) : normalizedUrl}`;
  };

  const handleDelete = async (id) => {
    if (!id) return;

    try {
      await deleteItem(id);
      setHistoryItems(prev => prev.filter(item => (item._id || item.id) !== id));
      addToast('Item deleted from history', 'info');
    } catch (error) {
      console.error('Error deleting item:', error);
      addToast('Failed to delete item', 'error');
    }
  };

  return (
    <div className="container">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.5 }}
      >
        <div className="d-flex justify-content-between align-items-center mb-5">
          <h2 className="display-6 fw-bold mb-0" style={{
            background: 'linear-gradient(to right, #a78bfa, #c084fc, #e879f9)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            Analysis History
          </h2>
          <span className="badge bg-secondary text-light">{historyItems.length} Items</span>
        </div>

        {isLoading ? (
          <div className="d-flex justify-content-center py-5">
            <LoadingSpinner message="Loading history..." />
          </div>
        ) : historyItems.length === 0 ? (
          <div className="text-center py-5">
            <i className="bi bi-journal-x text-secondary display-1 mb-3"></i>
            <p className="lead text-secondary">No history found.</p>
            <p className="text-muted small">Uploaded images and analysis results will appear here.</p>
          </div>
        ) : (
          <div className="row g-4">
            <AnimatePresence>
              {historyItems.map((item) => (
                <div className="col-md-6 col-lg-4" key={item.id || item._id}>
                  <motion.div
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="card bg-dark border-secondary h-100 shadow-sm"
                    style={{ backgroundColor: 'rgba(33, 37, 41, 0.8)', overflow: 'hidden', transition: 'box-shadow 0.3s' }}
                  >
                    <div className="position-relative" style={{ height: '200px' }}>
                      <img
                        src={getImageUrl(item.file_path || item.imageUrl)}
                        className="card-img-top w-100 h-100"
                        style={{ objectFit: 'cover' }}
                        alt={item.caption}
                      />
                      <div className="position-absolute bottom-0 start-0 w-100 p-2"
                        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)' }}>
                        <small className="text-white-50"><i className="bi bi-clock me-1"></i>{item.timestamp}</small>
                      </div>
                    </div>
                    <div className="card-body d-flex flex-column">
                      <p className="card-text text-light mb-3 flex-grow-1">"{item.caption}"</p>
                      <div className="mb-3">
                        {item.detections.map((tag, idx) => (
                          <span key={idx} className="badge bg-secondary bg-opacity-25 text-info border border-secondary border-opacity-25 me-1 mb-1 fw-normal">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <button
                        onClick={() => handleDelete(item._id || item.id)}
                        className="btn btn-outline-danger btn-sm w-100 mt-auto d-flex align-items-center justify-content-center gap-2"
                      >
                        <i className="bi bi-trash"></i> Delete
                      </button>
                    </div>
                  </motion.div>
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
