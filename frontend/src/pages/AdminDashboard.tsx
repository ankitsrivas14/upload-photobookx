import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { AdminUser, MagicLinkInfo, ShopifyOrder } from '../services/api';
import './AdminDashboard.css';

interface OrderWithLink extends ShopifyOrder {
  magicLink?: MagicLinkInfo;
}

export function AdminDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [orders, setOrders] = useState<OrderWithLink[]>([]);
  const [links, setLinks] = useState<MagicLinkInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [meRes, ordersRes, linksRes] = await Promise.all([
        api.getMe(),
        api.getOrders(),
        api.getMagicLinks(),
      ]);

      if (!meRes.success) {
        api.logout();
        navigate('/admin');
        return;
      }

      setUser(meRes.user || null);
      const allLinks = linksRes.links || [];
      setLinks(allLinks);
      
      // Merge orders with their active magic links
      const ordersWithLinks = (ordersRes.orders || []).map(order => {
        const activeLink = allLinks.find(l => 
          l.orderNumber.replace(/^#/, '') === order.name.replace(/^#/, '') && l.isActive
        );
        return { ...order, magicLink: activeLink };
      });
      
      setOrders(ordersWithLinks);
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

  const handleCreateLink = async (order: ShopifyOrder) => {
    setCreatingFor(order.name);

    try {
      const response = await api.createMagicLink({
        orderNumber: order.name,
        customerName: order.name, // Use order name as customer name
        // maxUploads is auto-detected from variant (12, 15, 20, or 25)
      });

      if (response.success && response.magicLink) {
        const newLink = response.magicLink;
        setLinks([newLink, ...links]);
        
        // Update the order with the new link
        setOrders(orders.map(o => 
          o.id === order.id ? { ...o, magicLink: newLink } : o
        ));
        
        // Auto-copy to clipboard
        copyToClipboard(newLink.uploadUrl, newLink.token);
      }
    } catch (err) {
      console.error('Failed to create link:', err);
    } finally {
      setCreatingFor(null);
    }
  };

  const copyToClipboard = (text: string, token: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
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
        <h2 className="page-title">Orders with Photo Uploads</h2>
        
        <div className="orders-table">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Items</th>
                <th>Photos</th>
                <th>Date</th>
                <th>Magic Link</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No orders found
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id}>
                    <td className="order-cell">{order.name}</td>
                    <td>
                      <div className="items-list">
                        {order.lineItems?.slice(0, 2).map((item, i) => (
                          <span key={i} className="item-tag">
                            {item.title} × {item.quantity}
                          </span>
                        ))}
                        {(order.lineItems?.length || 0) > 2 && (
                          <span className="more-items">+{(order.lineItems?.length || 0) - 2} more</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="photo-count">{order.maxUploads}</span>
                    </td>
                    <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                    <td>
                      {order.magicLink ? (
                        <div className="link-cell">
                          <span className="link-url">{order.magicLink.uploadUrl}</span>
                          <button 
                            className={`copy-btn ${copiedToken === order.magicLink.token ? 'copied' : ''}`}
                            onClick={() => copyToClipboard(order.magicLink!.uploadUrl, order.magicLink!.token)}
                            title="Copy link"
                          >
                            {copiedToken === order.magicLink.token ? '✓' : '📋'}
                          </button>
                        </div>
                      ) : (
                        <span className="no-link">—</span>
                      )}
                    </td>
                    <td className="actions-cell">
                      {order.magicLink ? (
                        <span className="link-status">
                          {order.magicLink.currentUploads}/{order.magicLink.maxUploads} uploads
                        </span>
                      ) : (
                        <button 
                          className="action-btn create"
                          onClick={() => handleCreateLink(order)}
                          disabled={creatingFor === order.name}
                        >
                          {creatingFor === order.name ? 'Creating...' : 'Create Magic Link'}
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
