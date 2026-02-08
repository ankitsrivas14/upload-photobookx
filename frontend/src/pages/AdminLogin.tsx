import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import styles from './AdminLogin.module.css';

export function AdminLogin() {
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required');
      return;
    }

    if (!isLogin && !name.trim()) {
      setError('Name is required');
      return;
    }

    setIsLoading(true);

    try {
      const response = isLogin 
        ? await api.login(email, password)
        : await api.register(email, password, name);

      if (response.success) {
        navigate('/admin/orders');
      } else {
        setError(response.error || 'Authentication failed');
      }
    } catch {
      setError('Unable to connect to server');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles['admin-login-container']}>
      <div className={styles['admin-login-card']}>
        <div className={styles['admin-login-header']}>
          <img 
            src="https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052" 
            alt="PhotoBookX" 
            className={styles['admin-logo']}
          />
          <h1>Admin Portal</h1>
          <p className={styles.subtitle}>{isLogin ? 'Sign in to manage orders' : 'Create admin account'}</p>
        </div>

        <form onSubmit={handleSubmit} className={styles['admin-login-form']}>
          {!isLogin && (
            <div className={styles['input-group']}>
              <label htmlFor="name">Name</label>
              <input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
            </div>
          )}

          <div className={styles['input-group']}>
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@photobookx.com"
              autoComplete="email"
            />
          </div>

          <div className={styles['input-group']}>
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          {error && <div className={styles['error-message']}>{error}</div>}

          <button type="submit" className={styles['submit-btn']} disabled={isLoading}>
            {isLoading ? 'Please wait...' : (isLogin ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <p className={styles['toggle-mode']}>
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" onClick={() => setIsLogin(!isLogin)}>
            {isLogin ? 'Register' : 'Sign In'}
          </button>
        </p>
      </div>
    </div>
  );
}
