import { useState } from 'react';
import { api } from '../services/api';
import type { AuthResponse } from '../services/api';
import './AuthScreen.css';

interface AuthScreenProps {
  onLogin: (orderData: AuthResponse['order']) => void;
}

export function AuthScreen({ onLogin }: AuthScreenProps) {
  const [orderNo, setOrderNo] = useState('');
  const [mobile, setMobile] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!orderNo.trim()) {
      setError('Please enter your order number');
      return;
    }

    if (!mobile.trim() || mobile.length < 10) {
      setError('Please enter a valid mobile number');
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await api.verifyAuth(orderNo.trim(), mobile.trim());
      
      if (response.success && response.order) {
        onLogin(response.order);
      } else {
        setError(response.error || 'Authentication failed. Please check your details.');
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError('Unable to connect to server. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-backdrop">
        <div className="backdrop-shape shape-1"></div>
        <div className="backdrop-shape shape-2"></div>
        <div className="backdrop-shape shape-3"></div>
      </div>
      
      <div className="auth-card">
        <div className="auth-header">
          <div className="logo-container">
            <img 
              src="https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052" 
              alt="PhotoBookX" 
              className="logo-image"
            />
          </div>
          <h1>Upload Your Photos</h1>
          <p className="subtitle">Access your order to upload photos</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="input-group">
            <label htmlFor="orderNo">Order Number</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5C15 6.10457 14.1046 7 13 7H11C9.89543 7 9 6.10457 9 5Z" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M9 12H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  <path d="M9 16H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </span>
              <input
                type="text"
                id="orderNo"
                value={orderNo}
                onChange={(e) => setOrderNo(e.target.value)}
                placeholder="e.g., #PB1001"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="mobile">Mobile Number</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="5" y="2" width="14" height="20" rx="3" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M10 18H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </span>
              <input
                type="tel"
                id="mobile"
                value={mobile}
                onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="10-digit mobile number"
                autoComplete="tel"
              />
            </div>
          </div>

          {error && (
            <div className="error-message">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 8V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="12" cy="16" r="1" fill="currentColor"/>
              </svg>
              {error}
            </div>
          )}

          <button type="submit" className="submit-btn" disabled={isLoading}>
            {isLoading ? (
              <span className="loader"></span>
            ) : (
              <>
                Continue
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </>
            )}
          </button>
        </form>

        <p className="help-text">
          Can't find your order number? Check your confirmation email or SMS.
        </p>
      </div>
    </div>
  );
}
