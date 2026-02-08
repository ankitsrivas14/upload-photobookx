import { useState, useEffect } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../services/api';
import type { AdminUser, MagicLinkInfo, ShopifyOrder } from '../services/api';
import styles from './AdminDashboard.module.css';

interface OrderWithLink extends ShopifyOrder {
  magicLink?: MagicLinkInfo;
}

interface Product {
  id: number;
  title: string;
  vendor: string;
  productType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  variants: Array<{
    id: number;
    title: string;
    price: string;
    compareAtPrice?: string | null;
    sku: string;
    inventoryQuantity: number;
    weight: number;
    weightUnit: string;
  }>;
  image: string | null;
}

type ViewType = 'magic-links' | 'products' | 'settings';

export function AdminDashboard() {
  const navigate = useNavigate();
  const { view } = useParams<{ view?: string }>();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [orders, setOrders] = useState<OrderWithLink[]>([]);
  const [links, setLinks] = useState<MagicLinkInfo[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [downloadingFor, setDownloadingFor] = useState<string | null>(null);
  const [deletingFor, setDeletingFor] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteModalToken, setDeleteModalToken] = useState<string | null>(null);
  const [deleteModalOrderNumber, setDeleteModalOrderNumber] = useState<string | null>(null);
  const [deleteModalImages, setDeleteModalImages] = useState<Array<{ id: string; s3Url: string; originalName: string }>>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
  // Product filters
  const [productSearch, setProductSearch] = useState('');
  const [productStatusFilter, setProductStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [selectedProducts, setSelectedProducts] = useState<Set<number>>(new Set());
  
  // Bulk price update modal
  const [showPriceUpdateModal, setShowPriceUpdateModal] = useState(false);
  const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
  const [priceUpdateType, setPriceUpdateType] = useState<'set' | 'increase' | 'decrease'>('set');
  const [variant1Price, setVariant1Price] = useState('');
  const [variant2Price, setVariant2Price] = useState('');
  const [variant1CompareAtPrice, setVariant1CompareAtPrice] = useState('');
  const [variant2CompareAtPrice, setVariant2CompareAtPrice] = useState('');
  const [priceChangePercent, setPriceChangePercent] = useState('');
  const [priceChangeAmount, setPriceChangeAmount] = useState('');

  // Determine current view from URL or default to 'magic-links'
  const currentView: ViewType = (view as ViewType) || 'magic-links';

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (currentView === 'products' && products.length === 0) {
      loadProducts();
    }
  }, [currentView]);

  // Redirect to magic-links if no view is specified
  useEffect(() => {
    if (!view) {
      navigate('/admin/magic-links', { replace: true });
    }
  }, [view, navigate]);

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

  const loadProducts = async () => {
    setIsLoadingProducts(true);
    try {
      const response = await api.getProducts();
      if (response.success && response.products) {
        setProducts(response.products);
      }
    } catch (err) {
      console.error('Failed to load products:', err);
    } finally {
      setIsLoadingProducts(false);
    }
  };

  // Filter products
  const filteredProducts = products.filter(product => {
    const matchesSearch = product.title.toLowerCase().includes(productSearch.toLowerCase());
    
    let matchesStatus = true;
    if (productStatusFilter === 'active') {
      matchesStatus = product.status === 'active';
    } else if (productStatusFilter === 'inactive') {
      // Shopify uses 'draft' or other statuses for inactive products
      matchesStatus = product.status !== 'active';
    }
    
    return matchesSearch && matchesStatus;
  });

  const toggleProductSelection = (productId: number) => {
    setSelectedProducts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  const toggleSelectAll = () => {
    if (selectedProducts.size === filteredProducts.length && filteredProducts.length > 0) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(filteredProducts.map(p => p.id)));
    }
  };

  const allSelected = filteredProducts.length > 0 && selectedProducts.size === filteredProducts.length;

  const handleBulkPriceUpdate = () => {
    setShowPriceUpdateModal(true);
  };

  const applyPriceUpdate = async () => {
    if (selectedProducts.size === 0) return;

    setIsUpdatingPrices(true);

    try {
      const productIds = Array.from(selectedProducts);

      const updateData: any = {
        productIds,
        updateType: priceUpdateType,
      };

      if (priceUpdateType === 'set') {
        if (variant1Price) updateData.variant1Price = variant1Price;
        if (variant1CompareAtPrice !== '') {
          updateData.variant1CompareAtPrice = variant1CompareAtPrice || null;
        }
        if (variant2Price) updateData.variant2Price = variant2Price;
        if (variant2CompareAtPrice !== '') {
          updateData.variant2CompareAtPrice = variant2CompareAtPrice || null;
        }
      } else {
        if (priceChangePercent) updateData.priceChangePercent = priceChangePercent;
        if (priceChangeAmount) updateData.priceChangeAmount = priceChangeAmount;
      }

      const result = await api.bulkUpdateProductPrices(updateData);

      if (result.success && result.results && result.summary) {
        const { successful, failed, total } = result.summary;
        
        if (successful === total) {
          alert(`✅ Successfully updated prices for ${successful} product${successful !== 1 ? 's' : ''}!`);
        } else {
          alert(
            `⚠️ Updated ${successful} product${successful !== 1 ? 's' : ''}, ${failed} failed.\n\n` +
            `Failed products:\n${result.results
              .filter(r => !r.success)
              .map(r => `Product ID ${r.productId}: ${r.error}`)
              .join('\n')}`
          );
        }

        // Reload products to reflect changes
        await loadProducts();
        
        // Reset and close modal
        setShowPriceUpdateModal(false);
        setVariant1Price('');
        setVariant2Price('');
        setVariant1CompareAtPrice('');
        setVariant2CompareAtPrice('');
        setPriceChangePercent('');
        setPriceChangeAmount('');
        setSelectedProducts(new Set());
      } else {
        alert(result.error || 'Failed to update prices');
      }
    } catch (error) {
      console.error('Error updating prices:', error);
      alert('An error occurred while updating prices. Please try again.');
    } finally {
      setIsUpdatingPrices(false);
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
        customerName: order.name,
      });

      if (response.success && response.magicLink) {
        const newLink = response.magicLink;
        setLinks([newLink, ...links]);
        
        setOrders(orders.map(o => 
          o.id === order.id ? { ...o, magicLink: newLink } : o
        ));
        
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

  const handleDownloadImages = async (token: string) => {
    setDownloadingFor(token);
    try {
      await api.downloadOrderImages(token);
    } catch (err) {
      console.error('Failed to download images:', err);
      alert('Failed to download images. Please try again.');
    } finally {
      setDownloadingFor(null);
    }
  };

  const handleCloseDeleteModal = () => {
    setShowDeleteModal(false);
    // Reset state after modal animation
    setTimeout(() => {
      setDeleteModalToken(null);
      setDeleteModalOrderNumber(null);
      setDeleteModalImages([]);
    }, 200);
  };

  const handleDeleteImagesClick = async (token: string, orderNumber: string) => {
    setDeleteModalToken(token);
    setDeleteModalOrderNumber(orderNumber);
    setShowDeleteModal(true);
    
    // Fetch images for preview
    try {
      const response = await api.getUploadedImages(token);
      if (response.success && response.images) {
        // Get first 5 images
        setDeleteModalImages(response.images.slice(0, 5));
      }
    } catch (err) {
      console.error('Failed to load images for preview:', err);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteModalToken) return;
    
    setDeletingFor(deleteModalToken);
    try {
      const response = await api.deleteOrderImages(deleteModalToken);
      if (response.success) {
        // Update the orders list to reflect deletion
        setOrders(orders.map(o => {
          if (o.magicLink?.token === deleteModalToken) {
            return {
              ...o,
              magicLink: {
                ...o.magicLink,
                imagesDeleted: true,
                imagesDeletedAt: new Date().toISOString(),
              }
            };
          }
          return o;
        }));
        
        // Update links list
        setLinks(links.map(l => {
          if (l.token === deleteModalToken) {
            return {
              ...l,
              imagesDeleted: true,
              imagesDeletedAt: new Date().toISOString(),
            };
          }
          return l;
        }));
        
        alert('Images deleted successfully');
      } else {
        alert(response.error || 'Failed to delete images');
      }
    } catch (err) {
      console.error('Failed to delete images:', err);
      alert('Failed to delete images. Please try again.');
    } finally {
      setDeletingFor(null);
      handleCloseDeleteModal();
    }
  };

  if (isLoading) {
    return (
      <div className={`${styles['admin-dashboard']} ${styles.loading}`}>
        <div className={styles.spinner}></div>
      </div>
    );
  }

  const stats = [
    { 
      label: 'Total Orders', 
      value: orders.length, 
      icon: '📦',
      color: '#00B8D4'
    },
    { 
      label: 'Active Links', 
      value: links.filter(l => l.isActive).length, 
      icon: '🔗',
      color: '#7c3aed'
    },
    { 
      label: 'Total Uploads', 
      value: links.reduce((sum, l) => sum + l.currentUploads, 0), 
      icon: '📸',
      color: '#f59e0b'
    },
    { 
      label: 'Completed', 
      value: orders.filter(o => o.magicLink && o.magicLink.currentUploads >= o.magicLink.maxUploads).length, 
      icon: '✅',
      color: '#10b981'
    },
  ];

  return (
    <div className={styles['admin-dashboard']}>
      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ''}`}>
        <div className={styles['sidebar-header']}>
          <img 
            src="https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052" 
            alt="PhotoBookX" 
            className={styles['sidebar-logo']}
          />
          {!sidebarCollapsed && <span className={styles['sidebar-title']}>Admin</span>}
        </div>

        <nav className={styles['sidebar-nav']}>
          <Link 
            to="/admin/magic-links"
            className={`${styles['nav-item']} ${currentView === 'magic-links' ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            {!sidebarCollapsed && <span>Magic Links</span>}
          </Link>

          <Link 
            to="/admin/products"
            className={`${styles['nav-item']} ${currentView === 'products' ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
            {!sidebarCollapsed && <span>Products</span>}
          </Link>

          <Link 
            to="/admin/sales-management"
            className={styles['nav-item']}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18"/>
              <path d="M18 17V9"/>
              <path d="M13 17V5"/>
              <path d="M8 17v-3"/>
            </svg>
            {!sidebarCollapsed && <span>Sales Management</span>}
          </Link>

          <Link 
            to="/admin/expenses"
            className={styles['nav-item']}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            {!sidebarCollapsed && <span>Expenses</span>}
          </Link>

          <Link 
            to="/admin/gst-reports"
            className={styles['nav-item']}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            {!sidebarCollapsed && <span>GST Reports</span>}
          </Link>

          <Link 
            to="/admin/settings"
            className={`${styles['nav-item']} ${currentView === 'settings' ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6m8.66-15l-5.2 3m-2.92 5.2l-5.2 3M23 12h-6m-6 0H1m20.66 7l-5.2-3m-2.92-5.2l-5.2-3"/>
            </svg>
            {!sidebarCollapsed && <span>Settings</span>}
          </Link>
        </nav>

        <button 
          className={styles['sidebar-toggle']}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points={sidebarCollapsed ? "9 18 15 12 9 6" : "15 18 9 12 15 6"}/>
          </svg>
        </button>
      </aside>

      {/* Main Content */}
      <div className={styles['main-wrapper']}>
        <header className={styles['dashboard-header']}>
          <div className={styles['header-breadcrumb']}>
            <span className={`${styles['breadcrumb-item']} ${styles.active}`}>
              {currentView === 'magic-links' && 'Magic Links'}
              {currentView === 'products' && 'Products'}
              {currentView === 'settings' && 'Settings'}
            </span>
          </div>
          <div className={styles['header-right']}>
            <div className={styles['user-menu']}>
              <div className={styles['user-avatar']}>{user?.name?.charAt(0) || 'A'}</div>
              <span className={styles['user-name']}>{user?.name}</span>
            </div>
            <button onClick={handleLogout} className={styles['logout-btn']}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Logout
            </button>
          </div>
        </header>

        <main className={styles['dashboard-main']}>
          {currentView === 'magic-links' && (
            <>
              {/* Stats Cards */}
              <div className={styles['stats-grid']}>
                {stats.map((stat, idx) => (
                  <div key={idx} className={styles['stat-card']}>
                    <div className={styles['stat-icon']} style={{ backgroundColor: `${stat.color}15`, color: stat.color }}>
                      {stat.icon}
                    </div>
                    <div className={styles['stat-content']}>
                      <div className={styles['stat-value']}>{stat.value}</div>
                      <div className={styles['stat-label']}>{stat.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Recent Orders Section */}
              <div className={styles['content-section']}>
                <div className={styles['section-header']}>
                  <h2>Recent Orders</h2>
                  <p>Orders that require photo uploads from customers</p>
                </div>

                <div className={styles['table-card']}>
                  <table className={styles['data-table']}>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Items</th>
                        <th>Photos</th>
                        <th>Date</th>
                        <th>Magic Link</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.length === 0 ? (
                        <tr>
                          <td colSpan={7} className={styles['empty-state']}>
                            <div className={styles['empty-icon']}>📦</div>
                            <div className={styles['empty-text']}>No orders found</div>
                          </td>
                        </tr>
                      ) : (
                        orders.map((order) => (
                          <tr key={order.id}>
                            <td className={styles['order-cell']}>
                              <span className={styles['order-number']}>{order.name}</span>
                            </td>
                            <td>
                              <div className={styles['items-list']}>
                                {order.lineItems?.slice(0, 1).map((item, i) => (
                                  <span key={i} className={styles['item-tag']}>
                                    {item.title} × {item.quantity}
                                  </span>
                                ))}
                                {(order.lineItems?.length || 0) > 1 && (
                                  <span className={styles['more-items']}>+{(order.lineItems?.length || 0) - 1}</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <span className={styles['photo-badge']}>{order.maxUploads}</span>
                            </td>
                            <td className={styles['date-cell']}>{new Date(order.createdAt).toLocaleDateString()}</td>
                            <td>
                              {order.magicLink ? (
                                <div className={styles['link-cell']}>
                                  <span className={styles['link-url']}>{order.magicLink.uploadUrl}</span>
                                  <button 
                                    className={`${styles['icon-btn']} ${styles.copy} ${copiedToken === order.magicLink.token ? styles.copied : ''}`}
                                    onClick={() => copyToClipboard(order.magicLink!.uploadUrl, order.magicLink!.token)}
                                    title="Copy link"
                                  >
                                    {copiedToken === order.magicLink.token ? (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <polyline points="20 6 9 17 4 12"/>
                                      </svg>
                                    ) : (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                      </svg>
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <span className={styles['no-link']}>—</span>
                              )}
                            </td>
                            <td className={styles['status-cell']}>
                              {order.magicLink ? (
                                <div className={styles['status-badge']}>
                                  <div className={styles['progress-ring']}>
                                    <span>{order.magicLink.currentUploads}/{order.magicLink.maxUploads}</span>
                                  </div>
                                </div>
                              ) : (
                                <button 
                                  className={`${styles['action-btn']} ${styles.primary}`}
                                  onClick={() => handleCreateLink(order)}
                                  disabled={creatingFor === order.name}
                                >
                                  {creatingFor === order.name ? 'Creating...' : 'Create Link'}
                                </button>
                              )}
                            </td>
                            <td>
                              {order.magicLink && order.magicLink.currentUploads === order.magicLink.maxUploads && !order.magicLink.imagesDeleted ? (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button 
                                    className={`${styles['icon-btn']} ${styles.download}`}
                                    onClick={() => handleDownloadImages(order.magicLink!.token)}
                                    disabled={downloadingFor === order.magicLink!.token || deletingFor === order.magicLink!.token}
                                    title="Download all images"
                                  >
                                    {downloadingFor === order.magicLink!.token ? (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.spinner}>
                                        <circle cx="12" cy="12" r="10" opacity="0.25"/>
                                        <path d="M4 12a8 8 0 018-8" opacity="0.75"/>
                                      </svg>
                                    ) : (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7 10 12 15 17 10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                      </svg>
                                    )}
                                  </button>
                                  <button 
                                    className={`${styles['icon-btn']} ${styles.delete}`}
                                    onClick={() => handleDeleteImagesClick(order.magicLink!.token, order.name)}
                                    disabled={deletingFor === order.magicLink!.token || downloadingFor === order.magicLink!.token}
                                    title="Delete images after printing"
                                  >
                                    {deletingFor === order.magicLink!.token ? (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.spinner}>
                                        <circle cx="12" cy="12" r="10" opacity="0.25"/>
                                        <path d="M4 12a8 8 0 018-8" opacity="0.75"/>
                                      </svg>
                                    ) : (
                                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="18" y1="6" x2="6" y2="18"/>
                                        <line x1="6" y1="6" x2="18" y2="18"/>
                                      </svg>
                                    )}
                                  </button>
                                </div>
                              ) : order.magicLink?.imagesDeleted ? (
                                <span className={styles['deleted-badge']}>Images Deleted</span>
                              ) : (
                                <span className={styles['no-action']}>—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {currentView === 'products' && (
            <div className={styles['content-section']}>
              <div className={styles['section-header']}>
                <h2>Products Management</h2>
                <p>Manage your photobook products and variants</p>
              </div>

              {isLoadingProducts ? (
                <div className={styles['loading-section']}>
                  <div className={styles.spinner}></div>
                  <p>Loading products...</p>
                </div>
              ) : (
                <>
                  <div className={styles['filters-bar']}>
                    <div className={styles['filter-search']}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                      </svg>
                      <input
                        type="text"
                        placeholder="Search products..."
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                      />
                    </div>

                    <div className={styles['filter-group']}>
                      <label>Status:</label>
                      <select 
                        value={productStatusFilter} 
                        onChange={(e) => setProductStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                      >
                        <option value="all">All</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>

                    {selectedProducts.size > 0 && (
                      <div className={styles['selection-info']}>
                        <span>{selectedProducts.size} selected</span>
                        <button 
                          className={styles['bulk-action-btn']}
                          onClick={handleBulkPriceUpdate}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="1" x2="12" y2="23"/>
                            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                          </svg>
                          Update Prices
                        </button>
                        <button 
                          className={styles['clear-selection-btn']}
                          onClick={() => setSelectedProducts(new Set())}
                        >
                          Clear
                        </button>
                      </div>
                    )}

                    <div className={styles['filter-results']}>
                      <span>{filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  <div className={styles['table-card']}>
                    <table className={`${styles['data-table']} ${styles['products-table']} ${styles.compact}`}>
                      <thead>
                        <tr>
                          <th style={{ width: '40px' }}>
                            <input
                              type="checkbox"
                              className={styles['table-checkbox']}
                              checked={allSelected}
                              onChange={toggleSelectAll}
                            />
                          </th>
                          <th>Product</th>
                          <th>{products[0]?.variants[0]?.title || 'Variant 1'}</th>
                          <th>{products[0]?.variants[1]?.title || 'Variant 2'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredProducts.length === 0 ? (
                          <tr>
                            <td colSpan={4} className={styles['empty-state']}>
                              <div className={styles['empty-icon']}>📦</div>
                              <div className={styles['empty-text']}>
                                {productSearch || productStatusFilter !== 'all' 
                                  ? 'No products match your filters' 
                                  : 'No products found'}
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredProducts.map((product) => {
                            const isSelected = selectedProducts.has(product.id);
                            return (
                              <tr key={product.id} className={`${styles['product-row']} ${isSelected ? styles.selected : ''}`}>
                                <td>
                                  <input
                                    type="checkbox"
                                    className={styles['table-checkbox']}
                                    checked={isSelected}
                                    onChange={() => toggleProductSelection(product.id)}
                                  />
                                </td>
                                <td>
                                  <div className={styles['product-cell']}>
                                    <span className={`${styles['status-indicator']} ${product.status === 'active' ? styles.active : styles.inactive}`}></span>
                                    {product.image && (
                                      <img src={product.image} alt={product.title} className={styles['product-image']} />
                                    )}
                                    <div className={styles['product-info']}>
                                      <span className={styles['product-title']}>{product.title}</span>
                                      <span className={styles['product-meta']}>ID: {product.id}</span>
                                    </div>
                                  </div>
                                </td>
                                <td className={styles['variant-column']}>
                                  {product.variants[0] ? (
                                    <span className={styles['variant-price']}>₹{product.variants[0].price}</span>
                                  ) : (
                                    <span className={styles['no-variant']}>—</span>
                                  )}
                                </td>
                                <td className={styles['variant-column']}>
                                  {product.variants[1] ? (
                                    <span className={styles['variant-price']}>₹{product.variants[1].price}</span>
                                  ) : (
                                    <span className={styles['no-variant']}>—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {currentView === 'settings' && (
            <div className={styles['content-section']}>
              <div className={styles['section-header']}>
                <h2>Settings</h2>
                <p>Configure your admin portal preferences</p>
              </div>

              <div className={styles['settings-grid']}>
                <div className={styles['settings-card']}>
                  <div className={styles['settings-card-header']}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                      <circle cx="8.5" cy="7" r="4"/>
                      <polyline points="17 11 19 13 23 9"/>
                    </svg>
                    <h3>Account</h3>
                  </div>
                  <div className={styles['settings-card-body']}>
                    <div className={styles['setting-item']}>
                      <label>Name</label>
                      <input type="text" value={user?.name || ''} disabled />
                    </div>
                    <div className={styles['setting-item']}>
                      <label>Email</label>
                      <input type="email" value={user?.email || ''} disabled />
                    </div>
                  </div>
                </div>

                <div className={styles['settings-card']}>
                  <div className={styles['settings-card-header']}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                      <circle cx="12" cy="10" r="3"/>
                    </svg>
                    <h3>Link Settings</h3>
                  </div>
                  <div className={styles['settings-card-body']}>
                    <div className={styles['setting-item']}>
                      <label>Default Expiry (days)</label>
                      <input type="number" value="7" disabled />
                    </div>
                    <div className={styles['setting-item']}>
                      <label>Max File Size (MB)</label>
                      <input type="number" value="30" disabled />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Bulk Price Update Modal */}
      {showPriceUpdateModal && (
        <div className={styles['modal-overlay']} onClick={() => setShowPriceUpdateModal(false)}>
          <div className={`${styles['modal-content']} ${styles['price-update-modal']}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles['modal-header']}>
              <h2>Update Prices</h2>
              <button className={styles['modal-close']} onClick={() => setShowPriceUpdateModal(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className={styles['modal-body']}>
              <div className={styles['price-update-tabs']}>
                <button 
                  className={`${styles['tab-btn']} ${priceUpdateType === 'set' ? styles.active : ''}`}
                  onClick={() => setPriceUpdateType('set')}
                >
                  Set Price
                </button>
                <button 
                  className={`${styles['tab-btn']} ${priceUpdateType === 'increase' ? styles.active : ''}`}
                  onClick={() => setPriceUpdateType('increase')}
                >
                  + Increase
                </button>
                <button 
                  className={`${styles['tab-btn']} ${priceUpdateType === 'decrease' ? styles.active : ''}`}
                  onClick={() => setPriceUpdateType('decrease')}
                >
                  − Decrease
                </button>
              </div>

              {priceUpdateType === 'set' && (
                <div className={styles['price-inputs']}>
                  <div className={styles['variant-price-section']}>
                    <label className={styles['variant-section-label']}>{products[0]?.variants[0]?.title || 'Variant 1'}</label>
                    <div className={styles['variant-inputs-row']}>
                      <div className={`${styles['input-group']} ${styles.compact}`}>
                        <label>Price</label>
                        <div className={styles['input-with-prefix']}>
                          <span className={styles['input-prefix']}>₹</span>
                          <input
                            type="number"
                            placeholder="New price"
                            value={variant1Price}
                            onChange={(e) => setVariant1Price(e.target.value)}
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </div>
                      <div className={`${styles['input-group']} ${styles.compact}`}>
                        <label>Compare at</label>
                        <div className={styles['input-with-prefix']}>
                          <span className={styles['input-prefix']}>₹</span>
                          <input
                            type="number"
                            placeholder="Compare at"
                            value={variant1CompareAtPrice}
                            onChange={(e) => setVariant1CompareAtPrice(e.target.value)}
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={styles['variant-price-section']}>
                    <label className={styles['variant-section-label']}>{products[0]?.variants[1]?.title || 'Variant 2'}</label>
                    <div className={styles['variant-inputs-row']}>
                      <div className={`${styles['input-group']} ${styles.compact}`}>
                        <label>Price</label>
                        <div className={styles['input-with-prefix']}>
                          <span className={styles['input-prefix']}>₹</span>
                          <input
                            type="number"
                            placeholder="New price"
                            value={variant2Price}
                            onChange={(e) => setVariant2Price(e.target.value)}
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </div>
                      <div className={`${styles['input-group']} ${styles.compact}`}>
                        <label>Compare at</label>
                        <div className={styles['input-with-prefix']}>
                          <span className={styles['input-prefix']}>₹</span>
                          <input
                            type="number"
                            placeholder="Compare at"
                            value={variant2CompareAtPrice}
                            onChange={(e) => setVariant2CompareAtPrice(e.target.value)}
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className={styles['input-hint']}>Leave blank to skip • Applies to {selectedProducts.size} product{selectedProducts.size !== 1 ? 's' : ''}</p>
                </div>
              )}

              {(priceUpdateType === 'increase' || priceUpdateType === 'decrease') && (
                <div className={styles['price-inputs']}>
                  <div className={styles['input-group']}>
                    <label>Percentage</label>
                    <div className={styles['input-with-suffix']}>
                      <input
                        type="number"
                        placeholder="10"
                        value={priceChangePercent}
                        onChange={(e) => {
                          setPriceChangePercent(e.target.value);
                          setPriceChangeAmount('');
                        }}
                        step="0.1"
                        min="0"
                        max="100"
                      />
                      <span className={styles['input-suffix']}>%</span>
                    </div>
                  </div>

                  <div className={styles.divider}>OR</div>

                  <div className={styles['input-group']}>
                    <label>Fixed Amount</label>
                    <div className={styles['input-with-prefix']}>
                      <span className={styles['input-prefix']}>₹</span>
                      <input
                        type="number"
                        placeholder="100"
                        value={priceChangeAmount}
                        onChange={(e) => {
                          setPriceChangeAmount(e.target.value);
                          setPriceChangePercent('');
                        }}
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>

                  <p className={styles['input-hint']}>Applies to both price & compare at price • {selectedProducts.size} product{selectedProducts.size !== 1 ? 's' : ''} selected</p>
                </div>
              )}
            </div>

            <div className={styles['modal-footer']}>
              <button 
                className={`${styles['modal-btn']} ${styles.cancel}`}
                onClick={() => setShowPriceUpdateModal(false)}
              >
                Cancel
              </button>
              <button 
                className={`${styles['modal-btn']} ${styles.confirm}`}
                onClick={applyPriceUpdate}
                disabled={
                  isUpdatingPrices ||
                  (priceUpdateType === 'set' 
                    ? !variant1Price && !variant2Price && !variant1CompareAtPrice && !variant2CompareAtPrice
                    : !priceChangePercent && !priceChangeAmount)
                }
              >
                {isUpdatingPrices ? (
                  <>
                    <div className={styles['btn-loader']}></div>
                    Updating...
                  </>
                ) : (
                  'Update Prices'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Images Confirmation Modal */}
      {showDeleteModal && (
        <div className={styles['modal-overlay']} onClick={handleCloseDeleteModal}>
          <div className={`${styles['modal-content']} ${styles['delete-modal']}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles['modal-header']}>
              <h2>Delete Images</h2>
              <button className={styles['modal-close']} onClick={handleCloseDeleteModal}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className={styles['modal-body']}>
              {/* Warning Section */}
              <div className={styles['warning-section']}>
                <div className={styles['warning-icon']}>⚠️</div>
                <div className={styles['warning-content']}>
                  <p className={styles['warning-text']}>
                    Permanently delete all images for this order?
                  </p>
                  <p className={styles['warning-subtext']}>
                    This action cannot be undone. Images will be removed from our server forever.
                  </p>
                </div>
              </div>

              {/* Order Details Section */}
              <div className={styles['order-details-section']}>
                <div className={styles['order-details-header']}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                  </svg>
                  <h3>Order Details</h3>
                </div>
                <div className={styles['order-info-badge']}>
                  Order Number: <strong>{deleteModalOrderNumber}</strong>
                </div>
              </div>
              
              {/* Images Preview Section */}
              {deleteModalImages.length > 0 && (
                <div className={styles['images-preview-section']}>
                  <div className={styles['images-preview-header']}>
                    <div className={styles['images-preview-title']}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <polyline points="21 15 16 10 5 21"/>
                      </svg>
                      <h3>Preview Images</h3>
                    </div>
                    <span className={styles['images-count']}>
                      Showing {deleteModalImages.length} of many
                    </span>
                  </div>
                  <div className={styles['preview-images']}>
                    {deleteModalImages.map((img) => (
                      <div key={img.id} className={styles['preview-thumbnail']}>
                        <img src={img.s3Url} alt={img.originalName} />
                      </div>
                    ))}
                  </div>
                  {deleteModalImages.length >= 5 && (
                    <div className={styles['more-images-badge']}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '16px', height: '16px' }}>
                        <path d="M12 5v14M5 12h14"/>
                      </svg>
                      More images will also be deleted
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className={styles['modal-footer']}>
              <button 
                className={`${styles['modal-btn']} ${styles.cancel}`}
                onClick={handleCloseDeleteModal}
                disabled={deletingFor !== null}
              >
                Cancel
              </button>
              <button 
                className={`${styles['modal-btn']} ${styles.danger}`}
                onClick={handleConfirmDelete}
                disabled={deletingFor !== null}
              >
                {deletingFor !== null ? (
                  <>
                    <div className={styles['btn-loader']}></div>
                    Deleting...
                  </>
                ) : (
                  'Delete Images'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
