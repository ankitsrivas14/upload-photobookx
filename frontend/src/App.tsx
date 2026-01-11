import { useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import './App.css';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userInfo, setUserInfo] = useState<{ orderNo: string; mobile: string } | null>(null);

  const handleLogin = (orderNo: string, mobile: string) => {
    // TODO: Implement actual authentication with backend
    setUserInfo({ orderNo, mobile });
    setIsAuthenticated(true);
  };

  if (!isAuthenticated) {
    return <AuthScreen onLogin={handleLogin} />;
  }

  // Placeholder for authenticated view
  return (
    <div className="app-container">
      <h1>Welcome!</h1>
      <p>Order: {userInfo?.orderNo}</p>
      <p>Mobile: {userInfo?.mobile}</p>
      <button onClick={() => setIsAuthenticated(false)}>Logout</button>
    </div>
  );
}

export default App;
