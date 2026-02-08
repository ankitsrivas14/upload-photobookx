import { useState, useEffect } from 'react';
import styles from './GSTMonthlyReports.module.css';

export function GSTMonthlyReports() {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');

  // Initialize with current month and year
  useEffect(() => {
    const now = new Date();
    setSelectedMonth((now.getMonth() + 1).toString().padStart(2, '0'));
    setSelectedYear(now.getFullYear().toString());
  }, []);

  // Generate month options
  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' },
  ];

  // Generate year options (current year and 2 years back)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => currentYear - i);

  return (
    <div className={styles['monthly-reports']}>
      <div className={styles['page-header']}>
        <div className={styles['page-title-section']}>
          <h1 className={styles['page-title']}>Monthly GST Reports</h1>
          <p className={styles['page-subtitle']}>
            Generate and view GST reports for your business operations
          </p>
        </div>
      </div>

      <div className={styles['report-controls']}>
        <div className={styles['filter-section']}>
          <div className={styles['filter-group']}>
            <label className={styles['filter-label']}>Month</label>
            <select 
              className={styles['filter-select']}
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles['filter-group']}>
            <label className={styles['filter-label']}>Year</label>
            <select 
              className={styles['filter-select']}
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <button className={styles['generate-btn']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Generate Report
          </button>
        </div>
      </div>

      <div className={styles['report-content']}>
        <div className={styles['empty-state']}>
          <div className={styles['empty-icon']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <h3 className={styles['empty-title']}>No Report Generated</h3>
          <p className={styles['empty-text']}>
            Select a month and year, then click "Generate Report" to view GST details
          </p>
        </div>
      </div>
    </div>
  );
}
