import { useState, useEffect } from 'react';
import './COGSPage.css';

export function COGSPage() {
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Simulate loading
    setIsLoading(false);
  }, []);

  if (isLoading) {
    return (
      <div className="loading-section">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="cogs-page">
      <div className="content-section">
        <div className="section-header">
          <h2>Cost of Goods Sold (COGS)</h2>
          <p>Track and manage your cost of goods sold</p>
        </div>

        {/* Main COGS Metric */}
        <div className="hero-stat">
          <div className="hero-stat-content">
            <div className="hero-stat-label">Total COGS</div>
            <div className="hero-stat-value">₹0.00</div>
            <div className="hero-stat-description">
              COGS data coming soon
            </div>
          </div>
        </div>

        {/* Placeholder for future content */}
        <div className="future-stats-placeholder">
          {/* COGS stats and charts will be added here */}
        </div>
      </div>
    </div>
  );
}
