import { useState, useEffect } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { api } from './services/api';
import type { AuthResponse } from './services/api';
import './App.css';

type OrderData = AuthResponse['order'];

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [orderData, setOrderData] = useState<OrderData | null>(null);

  // Check for existing auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (api.isAuthenticated()) {
        try {
          const response = await api.getCurrentUser();
          if (response.success) {
            setIsAuthenticated(true);
            // Note: We don't have full order data from /me endpoint
            // You may want to store order data in localStorage or fetch it again
          }
        } catch (error) {
          console.error('Auth check failed:', error);
          api.logout();
        }
      }
      setIsLoading(false);
    };

    checkAuth();
  }, []);

  const handleLogin = (order: OrderData) => {
    setOrderData(order);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    api.logout();
    setIsAuthenticated(false);
    setOrderData(null);
  };

  if (isLoading) {
    return (
      <div className="app-container">
        <div className="loader-large"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  // Authenticated view - placeholder for upload interface
  return (
    <div className="app-container">
      <header className="app-header">
        <img 
          src="https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052" 
          alt="PhotoBookX" 
          className="header-logo"
        />
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </header>
      
      <main className="app-main">
        <div className="welcome-card">
          <h1>Welcome, {orderData?.customerName || 'Customer'}!</h1>
          <p className="order-info">Order: <strong>{orderData?.orderNumber}</strong></p>
          
          {orderData?.lineItems && orderData.lineItems.length > 0 && (
            <div className="order-items">
              <h3>Your Photobooks</h3>
              <ul>
                {orderData.lineItems.map((item) => (
                  <li key={item.id}>
                    {item.title} × {item.quantity}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <div className="upload-section">
            <p>Photo upload feature coming soon...</p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
