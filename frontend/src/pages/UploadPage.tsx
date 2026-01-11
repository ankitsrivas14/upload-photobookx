import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../services/api';
import type { UploadInfo } from '../services/api';
import './UploadPage.css';

export function UploadPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (token) {
      validateToken(token);
    }
  }, [token]);

  const validateToken = async (t: string) => {
    try {
      const response = await api.validateUploadToken(t);
      if (response.success) {
        setInfo(response);
      } else {
        setError(response.error || 'Invalid or expired link');
      }
    } catch (err) {
      setError('Unable to validate link');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="upload-page loading">
        <div className="spinner"></div>
        <p>Validating your link...</p>
      </div>
    );
  }

  if (error || !info) {
    return (
      <div className="upload-page error">
        <div className="error-card">
          <div className="error-icon">⚠️</div>
          <h1>Link Invalid</h1>
          <p>{error || 'This upload link is invalid or has expired.'}</p>
          <a href="https://photobookx.com" className="back-link">
            Visit PhotoBookX
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="upload-page">
      <header className="upload-header">
        <img 
          src="https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052" 
          alt="PhotoBookX" 
          className="upload-logo"
        />
      </header>

      <main className="upload-main">
        <div className="upload-card">
          <div className="upload-info">
            <h1>Upload Your Photos</h1>
            <p className="welcome-text">
              Hello <strong>{info.customerName}</strong>! Upload photos for order <strong>{info.orderNumber}</strong>
            </p>
            
            <div className="upload-stats">
              <div className="stat">
                <span className="stat-value">{info.remainingUploads}</span>
                <span className="stat-label">Remaining</span>
              </div>
              <div className="stat">
                <span className="stat-value">{info.currentUploads}</span>
                <span className="stat-label">Uploaded</span>
              </div>
              <div className="stat">
                <span className="stat-value">{info.maxUploads}</span>
                <span className="stat-label">Maximum</span>
              </div>
            </div>
          </div>

          <div className="upload-zone">
            <div className="upload-placeholder">
              <div className="upload-icon">📷</div>
              <p>Photo upload coming soon...</p>
              <p className="upload-hint">Drag and drop or click to select photos</p>
            </div>
          </div>

          <p className="expires-info">
            This link expires on {new Date(info.expiresAt!).toLocaleDateString()}
          </p>
        </div>
      </main>
    </div>
  );
}
