import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { AdminUser } from '../services/api';
import { SalesPage } from './SalesPage';
import styles from './ExpensesPage.module.css';

export function SalesManagementPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  const loadUser = async () => {
    try {
      const meRes = await api.getMe();
      if (!meRes.success) {
        api.logout();
        navigate('/admin');
        return;
      }
      setUser(meRes.user || null);
    } catch (err) {
      console.error('Failed to load user:', err);
      api.logout();
      navigate('/admin');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    navigate('/admin');
  };

  if (isLoading) {
    return (
      <div className={`${styles['expenses-page']} ${styles.loading}`}>
        <div className={styles.spinner}></div>
      </div>
    );
  }

  return (
    <div className={styles['main-wrapper']}>
      <header className={styles['dashboard-header']}>
        <div className={styles['header-breadcrumb']}>
          <span className={`${styles['breadcrumb-item']} ${styles.active}`}>Sales Management</span>
        </div>
        <div className={styles['header-right']}>
          <div className={styles['user-menu']}>
            <div className={styles['user-avatar']}>{user?.name?.charAt(0) || 'A'}</div>
            <span className={styles['user-name']}>{user?.name}</span>
          </div>
          <button onClick={handleLogout} className={styles['logout-btn']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Logout
          </button>
        </div>
      </header>

      <main className={styles['dashboard-main']}>
        <SalesPage />
      </main>
    </div>
  );
}
