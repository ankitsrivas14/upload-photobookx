import { useState, useEffect } from 'react';
import styles from './COGSPage.module.css';

export function COGSPage() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate loading
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return (
      <div className={styles['loading-section']}>
        <div className={styles.spinner}></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles['cogs-page']}>
      <div className={styles['page-header']}>
      </div>

      <div className={styles['stats-card']}>
        <div className={styles['stat-label']}>TOTAL COGS</div>
        <div className={styles['stat-value']}>₹0.00</div>
        <div className={styles['stat-description']}>
          Data tracking coming soon
        </div>
      </div>
    </div>
  );
}
