import { useEffect, useState } from 'react';
import { Alert } from '../components/ui/pbx';
import { api, type StockLevel } from '../services/api';
import styles from './AdminLayout.module.css';

/** How often an open admin re-checks the stock. */
const RECHECK_MS = 30 * 60 * 1000;

/**
 * A warning above every admin page while a stocked book is down to its last days of stock (the
 * API's alertDays) at the pace it has been selling. Shows nothing while stock is fine.
 */
export function StockAlert() {
  const [low, setLow] = useState<StockLevel[]>([]);
  const [alertDays, setAlertDays] = useState(10);

  useEffect(() => {
    let live = true;
    const check = () =>
      api
        .getStock()
        .then((res) => {
          if (!live || !res.success) return;
          setAlertDays(res.alertDays ?? 10);
          setLow((res.items ?? []).filter((i) => i.low));
        })
        .catch(() => {});
    check();
    const timer = window.setInterval(check, RECHECK_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!low.length) return null;
  const urgent = low.some((i) => i.available <= 0 || (i.daysLeft ?? Infinity) <= 3);
  return (
    <div className={styles.stockAlert}>
      <Alert tone={urgent ? 'negative' : 'caution'} title={`Stock for ${alertDays} days or less: time to reprint`}>
        <ul className={styles.stockList}>
          {low.map((i) => (
            <li key={i.sku}>
              <strong>{i.label}</strong>
              {i.available <= 0
                ? ': none left to sell'
                : `: ${i.available.toLocaleString('en-IN')} left, about ${i.daysLeft} day${i.daysLeft === 1 ? '' : 's'} at ${i.pace} a day`}
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  );
}
