import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Alert, Button, TextField } from '../components/ui/pbx';
import styles from './AdminLogin.module.css';

/** Admin sign-in (and first-account registration) on the Ledger components. */
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
        navigate('/admin/dashboard');
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
    <div className={styles.page}>
      <main className={styles.panel}>
        <span className="pbx-wordmark">
          PHOTOBOOKX<span className="pbx-wordmark__suffix">Admin</span>
        </span>

        <div className={styles.heading}>
          <h1 className={styles.title}>{isLogin ? 'Sign in' : 'Create an admin account'}</h1>
          <p className={styles.lead}>{isLogin ? 'Orders, profit and the store tools.' : 'For a new member of the team.'}</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          {!isLogin && (
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
          )}
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@photobookx.com"
            autoComplete="email"
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
          />

          {error && <Alert tone="negative" title={error} />}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={isLoading}>
            {isLoading ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <p className={styles.switch}>
          {isLogin ? "Don't have an account?" : 'Already have an account?'}
          <Button variant="ghost" size="sm" onClick={() => { setIsLogin(!isLogin); setError(''); }}>
            {isLogin ? 'Register' : 'Sign in'}
          </Button>
        </p>
      </main>
    </div>
  );
}
