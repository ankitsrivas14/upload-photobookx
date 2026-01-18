import { useState } from 'react';
import './MetaAdsPage.css';

export function MetaAdsPage() {
  const [isLoading] = useState(false);

  return (
    <div className="meta-ads-page">
      <div className="content-section">
        <div className="section-header">
          <h2>Meta Ads Expenses</h2>
          <p>Track and manage your Meta (Facebook/Instagram) advertising expenses</p>
        </div>

        {isLoading ? (
          <div className="loading-section">
            <div className="spinner"></div>
            <p>Loading...</p>
          </div>
        ) : (
          <div className="meta-ads-content">
            <div className="coming-soon">
              <div className="coming-soon-icon">📱</div>
              <h3>Meta Ads Management</h3>
              <p>Track your Facebook and Instagram ad spend, campaigns, and performance metrics</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
