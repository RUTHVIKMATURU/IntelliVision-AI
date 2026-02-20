import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const Navbar = () => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Handle scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const links = [
    { name: 'Upload', path: '/' },
    { name: 'Live Camera', path: '/live' },
    { name: 'History', path: '/history' },
  ];

  const navbarClass = `navbar navbar-expand-lg fixed-top ${scrolled || isOpen ? 'bg-dark shadow' : 'bg-transparent'
    }`;

  return (
    <nav className={navbarClass} style={{ backdropFilter: 'blur(10px)', backgroundColor: scrolled || isOpen ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.4)', borderBottom: '1px solid #333' }}>
      <div className="container">
        {/* Logo */}
        <Link
          to="/"
          className="navbar-brand fw-bold"
          onClick={() => setIsOpen(false)}
          style={{
            background: 'linear-gradient(to right, #60a5fa, #06b6d4, #3b82f6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '1.5rem'
          }}
        >
          Caption Vision
        </Link>

        {/* Mobile Toggle */}
        <button
          className="navbar-toggler border-0 shadow-none"
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Toggle navigation"
        >
          <span className="navbar-toggler-icon" style={{ filter: 'invert(1)' }}></span>
        </button>

        {/* Collapse Content */}
        <div className={`collapse navbar-collapse ${isOpen ? 'show' : ''}`} id="navbarNav">
          <ul className="navbar-nav ms-auto align-items-center gap-3">
            {links.map((link) => (
              <li className="nav-item" key={link.path}>
                <Link
                  to={link.path}
                  className={`nav-link px-3 py-2 position-relative ${location.pathname === link.path ? 'active text-info' : 'text-secondary'}`}
                  onClick={() => setIsOpen(false)}
                  style={{ transition: 'color 0.3s' }}
                  onMouseEnter={(e) => e.currentTarget.classList.add('text-white')}
                  onMouseLeave={(e) => {
                    if (location.pathname !== link.path) e.currentTarget.classList.remove('text-white');
                  }}
                >
                  {link.name}
                  {location.pathname === link.path && (
                    <motion.div
                      layoutId="navbar-indicator"
                      className="position-absolute bottom-0 start-0 w-100 bg-info"
                      style={{ height: '2px' }}
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                    />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
