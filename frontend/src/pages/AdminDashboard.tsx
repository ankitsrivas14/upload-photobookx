import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { AdminUser, MagicLinkInfo } from '../services/api';
import './AdminDashboard.css';

export function AdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [links, setLinks] = useState<MagicLinkInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  
  // Create form state
  const [orderNumber, setOrderNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [maxUploads, setMaxUploads] = useState('50');
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [meRes, linksRes] = await Promise.all([
        api.getMe(),
        api.getMagicLinks(),
      ]);

      if (!meRes.success) {
        api.logout();
        navigate('/admin');
        return;
      }

      setUser(meRes.user || null);
      setLinks(linksRes.links || []);
    } catch (err) {
      console.error('Failed to load data:', err);
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

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');

    if (!orderNumber.trim() || !customerName.trim()) {
      setCreateError('Order number and customer name are required');
      return;
    }

    setIsCreating(true);

    try {
      const response = await api.createMagicLink({
        orderNumber: orderNumber.trim(),
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        maxUploads: parseInt(maxUploads, 10) || 50,
      });

      if (response.success && response.magicLink) {
        setLinks([response.magicLink, ...links]);
        setShowCreateForm(false);
        resetForm();
      } else {
        setCreateError(response.error || 'Failed to create link');
      }
    } catch (err) {
      setCreateError('Failed to create link');
    } finally {
      setIsCreating(false);
    }
  };

  const resetForm = () => {
    setOrderNumber('');
    setCustomerName('');
    setCustomerEmail('');
    setCustomerPhone('');
    setMaxUploads('50');
    setCreateError('');
  };

  const handleDeactivate = async (token: string) => {
    if (!confirm('Are you sure you want to deactivate this link?')) return;

    try {
      await api.deactivateMagicLink(token);
      setLinks(links.map(l => l.token === token ? { ...l, isActive: false } : l));
    } catch (err) {
      console.error('Failed to deactivate:', err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  if (isLoading) {
    return (
      <div className="admin-dashboard loading">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <img 
            src="https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052" 
            alt="PhotoBookX" 
            className="header-logo"
          />
          <span className="header-title">Admin Portal</span>
        </div>
        <div className="header-right">
          <span className="user-name">{user?.name}</span>
          <button onClick={handleLogout} className="logout-btn">Logout</button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-actions">
          <h2>Magic Links</h2>
          <button 
            className="create-btn"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            {showCreateForm ? 'Cancel' : '+ Create New Link'}
          </button>
        </div>

        {showCreateForm && (
          <div className="create-form-card">
            <h3>Create Magic Link</h3>
            <form onSubmit={handleCreateLink}>
              <div className="form-row">
                <div className="form-group">
                  <label>Order Number *</label>
                  <input
                    type="text"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    placeholder="#PB1001"
                  />
                </div>
                <div className="form-group">
                  <label>Customer Name *</label>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="John Doe"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="customer@email.com"
                  />
                </div>
                <div className="form-group">
                  <label>Phone</label>
                  <input
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="9876543210"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Max Uploads</label>
                  <input
                    type="number"
                    value={maxUploads}
                    onChange={(e) => setMaxUploads(e.target.value)}
                    min="1"
                    max="500"
                  />
                </div>
              </div>
              {createError && <div className="form-error">{createError}</div>}
              <button type="submit" className="submit-btn" disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create Link'}
              </button>
            </form>
          </div>
        )}

        <div className="links-table">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Uploads</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No magic links created yet
                  </td>
                </tr>
              ) : (
                links.map((link) => (
                  <tr key={link.token} className={!link.isActive ? 'inactive' : ''}>
                    <td className="order-cell">{link.orderNumber}</td>
                    <td>
                      <div className="customer-info">
                        <span className="customer-name">{link.customerName}</span>
                        {link.customerEmail && (
                          <span className="customer-email">{link.customerEmail}</span>
                        )}
                      </div>
                    </td>
                    <td>{link.currentUploads} / {link.maxUploads}</td>
                    <td>
                      <span className={`status-badge ${link.isActive ? 'active' : 'inactive'}`}>
                        {link.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{new Date(link.expiresAt).toLocaleDateString()}</td>
                    <td className="actions-cell">
                      <button 
                        className="action-btn copy"
                        onClick={() => copyToClipboard(link.uploadUrl)}
                        title="Copy link"
                      >
                        📋
                      </button>
                      {link.isActive && (
                        <button 
                          className="action-btn deactivate"
                          onClick={() => handleDeactivate(link.token)}
                          title="Deactivate"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
