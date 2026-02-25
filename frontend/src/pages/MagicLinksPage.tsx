import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, Link, Routes, Route, Navigate } from 'react-router-dom';
import { api } from '../services/api';
import type { AdminUser, MagicLinkInfo, ShopifyOrder } from '../services/api';
import styles from './AdminDashboard.module.css'; // Reusing dashboard styles

interface OrderWithLink extends ShopifyOrder {
    magicLink?: MagicLinkInfo;
}

export function MagicLinksPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const [user, setUser] = useState<AdminUser | null>(null);
    const [orders, setOrders] = useState<OrderWithLink[]>([]);
    const [links, setLinks] = useState<MagicLinkInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [creatingFor, setCreatingFor] = useState<string | null>(null);
    const [copiedToken, setCopiedToken] = useState<string | null>(null);
    const [downloadingFor, setDownloadingFor] = useState<string | null>(null);
    const [deletingFor, setDeletingFor] = useState<string | null>(null);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteModalToken, setDeleteModalToken] = useState<string | null>(null);
    const [deleteModalOrderNumber, setDeleteModalOrderNumber] = useState<string | null>(null);
    const [deleteModalImages, setDeleteModalImages] = useState<Array<{ id: string; s3Url: string; originalName: string }>>([]);

    const currentPath = location.pathname;
    const isOrdersTab = currentPath.includes('/admin/magic-links/orders');
    const isLinksTab = currentPath.includes('/admin/magic-links/list');

    // Redirect root to orders tab
    useEffect(() => {
        if (currentPath === '/admin/magic-links' || currentPath === '/admin/magic-links/') {
            navigate('/admin/magic-links/orders', { replace: true });
        }
    }, [currentPath, navigate]);

    const loadData = useCallback(async () => {
        try {
            const [meRes, ordersRes, linksRes] = await Promise.all([
                api.getMe(),
                api.getOrders(2500, true), // Fetch 250 all orders
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
    }, [navigate]);

    useEffect(() => {
        loadData();
    }, [loadData]);

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

        try {
            const response = await api.getUploadedImages(token);
            if (response.success && response.images) {
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

    // --- Components for Tabs ---

    const OrdersList = () => (
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
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                    ) : (
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
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
                                                            <circle cx="12" cy="12" r="10" opacity="0.25" />
                                                            <path d="M4 12a8 8 0 018-8" opacity="0.75" />
                                                        </svg>
                                                    ) : (
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                            <polyline points="7 10 12 15 17 10" />
                                                            <line x1="12" y1="15" x2="12" y2="3" />
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
                                                            <circle cx="12" cy="12" r="10" opacity="0.25" />
                                                            <path d="M4 12a8 8 0 018-8" opacity="0.75" />
                                                        </svg>
                                                    ) : (
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <line x1="18" y1="6" x2="6" y2="18" />
                                                            <line x1="6" y1="6" x2="18" y2="18" />
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
    );

    const MagicLinksList = () => (
        <div className={styles['content-section']}>
            <div className={styles['section-header']}>
                <h2>Active Magic Links</h2>
                <p>Manage existing magic links</p>
            </div>
            <div className={styles['table-card']}>
                <table className={styles['data-table']}>
                    <thead>
                        <tr>
                            <th>Order Number</th>
                            <th>Link</th>
                            <th>Uploads</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {links.map(link => (
                            <tr key={link.token}>
                                <td className={styles['order-cell']}>{link.orderNumber}</td>
                                <td>
                                    <div className={styles['link-cell']}>
                                        <span className={styles['link-url']}>{link.uploadUrl}</span>
                                        <button
                                            className={`${styles['icon-btn']} ${styles.copy} ${copiedToken === link.token ? styles.copied : ''}`}
                                            onClick={() => copyToClipboard(link.uploadUrl, link.token)}
                                            title="Copy link"
                                        >
                                            {copiedToken === link.token ? (
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <polyline points="20 6 9 17 4 12" />
                                                </svg>
                                            ) : (
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                </svg>
                                            )}
                                        </button>
                                    </div>
                                </td>
                                <td>{link.currentUploads}/{link.maxUploads}</td>
                                <td>
                                    {/* Can add delete/other actions if needed */}
                                    <span className={styles['no-action']}>—</span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );

    return (
        <>
            <div className={styles['main-wrapper']}>
                <header className={styles['dashboard-header']}>
                    <div className={styles['header-breadcrumb']}>
                        <span className={`${styles['breadcrumb-item']} ${styles.active}`}>
                            Magic Links
                        </span>
                    </div>
                    <div className={styles['header-right']}>
                        <div className={styles['user-menu']}>
                            <div className={styles['user-avatar']}>{user?.name?.charAt(0) || 'A'}</div>
                            <span className={styles['user-name']}>{user?.name}</span>
                        </div>
                        <button onClick={handleLogout} className={styles['logout-btn']}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                <polyline points="16 17 21 12 16 7" />
                                <line x1="21" y1="12" x2="9" y2="12" />
                            </svg>
                            Logout
                        </button>
                    </div>
                </header>

                <main className={styles['dashboard-main']}>
                    {/* Stats Cards - kept for context */}
                    <div className={styles['stats-grid']}>
                        <div className={styles['stat-card']}>
                            <div className={styles['stat-icon']} style={{ backgroundColor: '#00B8D415', color: '#00B8D4' }}>📦</div>
                            <div className={styles['stat-content']}>
                                <div className={styles['stat-value']}>{orders.length}</div>
                                <div className={styles['stat-label']}>Total Orders</div>
                            </div>
                        </div>
                        <div className={styles['stat-card']}>
                            <div className={styles['stat-icon']} style={{ backgroundColor: '#7c3aed15', color: '#7c3aed' }}>🔗</div>
                            <div className={styles['stat-content']}>
                                <div className={styles['stat-value']}>{links.filter(l => l.isActive).length}</div>
                                <div className={styles['stat-label']}>Active Links</div>
                            </div>
                        </div>
                        <div className={styles['stat-card']}>
                            <div className={styles['stat-icon']} style={{ backgroundColor: '#f59e0b15', color: '#f59e0b' }}>📸</div>
                            <div className={styles['stat-content']}>
                                <div className={styles['stat-value']}>{links.reduce((sum, l) => sum + l.currentUploads, 0)}</div>
                                <div className={styles['stat-label']}>Total Uploads</div>
                            </div>
                        </div>
                        <div className={styles['stat-card']}>
                            <div className={styles['stat-icon']} style={{ backgroundColor: '#10b98115', color: '#10b981' }}>✅</div>
                            <div className={styles['stat-content']}>
                                <div className={styles['stat-value']}>{orders.filter(o => o.magicLink && o.magicLink.currentUploads >= o.magicLink.maxUploads).length}</div>
                                <div className={styles['stat-label']}>Completed</div>
                            </div>
                        </div>
                    </div>

                    <div className={styles['tools-nav']} style={{ marginTop: '2rem' }}>
                        <Link
                            to="/admin/magic-links/orders"
                            className={`${styles['tools-nav-item']} ${isOrdersTab ? styles.active : ''}`}
                        >
                            Order Links
                        </Link>
                        <Link
                            to="/admin/magic-links/list"
                            className={`${styles['tools-nav-item']} ${isLinksTab ? styles.active : ''}`}
                        >
                            Magic Links
                        </Link>
                    </div>

                    <Routes>
                        <Route path="orders" element={<OrdersList />} />
                        <Route path="list" element={<MagicLinksList />} />
                        <Route path="*" element={<Navigate to="orders" replace />} />
                    </Routes>
                </main>
            </div>

            {/* Delete Confirmation Modal */}
            {showDeleteModal && (
                <div className={styles['modal-overlay']} onClick={handleCloseDeleteModal}>
                    <div className={styles['modal-content']} onClick={(e) => e.stopPropagation()}>
                        <div className={styles['modal-header']}>
                            <h2>Confirm Deletion</h2>
                            <button className={styles['modal-close']} onClick={handleCloseDeleteModal}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>

                        <div className={styles['modal-body']}>
                            <div className={styles['delete-warning']}>
                                <div className={styles['warning-icon']}>⚠️</div>
                                <p>
                                    Are you sure you want to delete the images for order <strong>{deleteModalOrderNumber}</strong>?
                                </p>
                            </div>
                            <p className={styles['delete-subtext']}>
                                This action cannot be undone. All uploaded images will be permanently removed from the server.
                            </p>

                            {deleteModalImages.length > 0 && (
                                <div className={styles['images-preview']}>
                                    <p>Preview (first {deleteModalImages.length} images):</p>
                                    <div className={styles['preview-grid']}>
                                        {deleteModalImages.map(img => (
                                            <div key={img.id} className={styles['preview-item']}>
                                                <img src={img.s3Url} alt="Preview" />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className={styles['modal-footer']}>
                            <button
                                className={styles['cancel-btn']}
                                onClick={handleCloseDeleteModal}
                                disabled={!!deletingFor}
                            >
                                Cancel
                            </button>
                            <button
                                className={styles['delete-confirm-btn']}
                                onClick={handleConfirmDelete}
                                disabled={!!deletingFor}
                            >
                                {deletingFor ? 'Deleting...' : 'Delete Images'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
