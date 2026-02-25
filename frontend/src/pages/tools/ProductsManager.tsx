import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import styles from '../AdminDashboard.module.css'; // Reusing dashboard styles for now

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

export function ProductsManager() {
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoadingProducts, setIsLoadingProducts] = useState(false);

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

    const loadProducts = useCallback(async () => {
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
    }, []);

    useEffect(() => {
        loadProducts();
    }, [loadProducts]);

    // Filter products
    const filteredProducts = products.filter(product => {
        const matchesSearch = product.title.toLowerCase().includes(productSearch.toLowerCase());

        let matchesStatus = true;
        if (productStatusFilter === 'active') {
            matchesStatus = product.status === 'active';
        } else if (productStatusFilter === 'inactive') {
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

            const updateData: {
                productIds: number[];
                updateType: 'set' | 'increase' | 'decrease';
                variant1Price?: string;
                variant1CompareAtPrice?: string | null;
                variant2Price?: string;
                variant2CompareAtPrice?: string | null;
                priceChangePercent?: string;
                priceChangeAmount?: string;
            } = {
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

    return (
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
                                <circle cx="11" cy="11" r="8" />
                                <path d="m21 21-4.35-4.35" />
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
                                        <line x1="12" y1="1" x2="12" y2="23" />
                                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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

            {/* Bulk Price Update Modal */}
            {showPriceUpdateModal && (
                <div className={styles['modal-overlay']} onClick={() => setShowPriceUpdateModal(false)}>
                    <div className={`${styles['modal-content']} ${styles['price-update-modal']}`} onClick={(e) => e.stopPropagation()}>
                        <div className={styles['modal-header']}>
                            <h2>Update Prices</h2>
                            <button className={styles['modal-close']} onClick={() => setShowPriceUpdateModal(false)}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
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
                                                    <span className={styles['prefix']}>₹</span>
                                                    <input
                                                        type="number"
                                                        value={variant1Price}
                                                        onChange={(e) => setVariant1Price(e.target.value)}
                                                        placeholder="Current"
                                                    />
                                                </div>
                                            </div>
                                            <div className={`${styles['input-group']} ${styles.compact}`}>
                                                <label>Compare At</label>
                                                <div className={styles['input-with-prefix']}>
                                                    <span className={styles['prefix']}>₹</span>
                                                    <input
                                                        type="number"
                                                        value={variant1CompareAtPrice}
                                                        onChange={(e) => setVariant1CompareAtPrice(e.target.value)}
                                                        placeholder="Original"
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
                                                    <span className={styles['prefix']}>₹</span>
                                                    <input
                                                        type="number"
                                                        value={variant2Price}
                                                        onChange={(e) => setVariant2Price(e.target.value)}
                                                        placeholder="Current"
                                                    />
                                                </div>
                                            </div>
                                            <div className={`${styles['input-group']} ${styles.compact}`}>
                                                <label>Compare At</label>
                                                <div className={styles['input-with-prefix']}>
                                                    <span className={styles['prefix']}>₹</span>
                                                    <input
                                                        type="number"
                                                        value={variant2CompareAtPrice}
                                                        onChange={(e) => setVariant2CompareAtPrice(e.target.value)}
                                                        placeholder="Original"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {(priceUpdateType === 'increase' || priceUpdateType === 'decrease') && (
                                <div className={styles['price-inputs']}>
                                    <div className={styles['input-group']}>
                                        <label>Percentage Change (%)</label>
                                        <input
                                            type="number"
                                            value={priceChangePercent}
                                            onChange={(e) => {
                                                setPriceChangePercent(e.target.value);
                                                if (e.target.value) setPriceChangeAmount('');
                                            }}
                                            placeholder="e.g. 10"
                                        />
                                    </div>
                                    <div className={styles['divider']}><span>OR</span></div>
                                    <div className={styles['input-group']}>
                                        <label>Fixed Amount (₹)</label>
                                        <input
                                            type="number"
                                            value={priceChangeAmount}
                                            onChange={(e) => {
                                                setPriceChangeAmount(e.target.value);
                                                if (e.target.value) setPriceChangePercent('');
                                            }}
                                            placeholder="e.g. 100"
                                        />
                                    </div>
                                    <p className={styles['help-text']}>
                                        This will {priceUpdateType} the price of all variants for selected products.
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className={styles['modal-footer']}>
                            <button
                                className={styles['cancel-btn']}
                                onClick={() => setShowPriceUpdateModal(false)}
                                disabled={isUpdatingPrices}
                            >
                                Cancel
                            </button>
                            <button
                                className={styles['confirm-btn']}
                                onClick={applyPriceUpdate}
                                disabled={isUpdatingPrices}
                            >
                                {isUpdatingPrices ? 'Updating...' : 'Update Prices'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
