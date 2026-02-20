import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Home from './pages/Home';
import History from './pages/History';
import LiveCamera from './pages/LiveCamera';
import Navbar from './components/Navbar';

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/live" element={<LiveCamera />} />
        <Route path="/history" element={<History />} />
      </Routes>
    </AnimatePresence>
  );
};

function App() {
  return (
    <Router>
      <div className="d-flex flex-column min-vh-100 text-light overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #000000 100%)' }}>
        <Navbar />

        {/* Main Content Container */}
        <main className="flex-grow-1 container py-5 mt-5">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="w-100 h-100"
          >
            <AnimatedRoutes />
          </motion.div>
        </main>

        {/* Global Footer */}
        <footer className="w-100 text-center py-4 text-secondary border-top border-secondary" style={{ backgroundColor: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(5px)' }}>
          <p className="mb-0 small">&copy; {new Date().getFullYear()} ROD IDS. All rights reserved.</p>
        </footer>
      </div>
    </Router>
  );
}

export default App;
