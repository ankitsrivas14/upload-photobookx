import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { Alert, Amount, Badge, Button, Card, DataTable, Dialog, EmptyState, SegmentedControl, TextField, type Column } from '../../components/ui/pbx';
import styles from './ProductsManager.module.css';

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

type StatusFilter = 'all' | 'active' | 'inactive';
type UpdateType = 'set' | 'increase' | 'decrease';

interface UpdateOutcome {
    successful: number;
    failed: number;
    failures: string[];
}

const STATUS_OPTIONS = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
];

const UPDATE_OPTIONS = [
    { value: 'set', label: 'Set price' },
    { value: 'increase', label: 'Increase' },
    { value: 'decrease', label: 'Decrease' },
];

const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;
const statusLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

/** Products: the Shopify catalogue with both variant prices, and a bulk price update for selected products. */
export function ProductsManager() {
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoadingProducts, setIsLoadingProducts] = useState(false);

    // Product filters
    const [productSearch, setProductSearch] = useState('');
    const [productStatusFilter, setProductStatusFilter] = useState<StatusFilter>('all');
    const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());

    // Bulk price update dialog
    const [showPriceUpdateModal, setShowPriceUpdateModal] = useState(false);
    const [isUpdatingPrices, setIsUpdatingPrices] = useState(false);
    const [priceUpdateType, setPriceUpdateType] = useState<UpdateType>('set');
    const [variant1Price, setVariant1Price] = useState('');
    const [variant2Price, setVariant2Price] = useState('');
    const [variant1CompareAtPrice, setVariant1CompareAtPrice] = useState('');
    const [variant2CompareAtPrice, setVariant2CompareAtPrice] = useState('');
    const [priceChangePercent, setPriceChangePercent] = useState('');
    const [priceChangeAmount, setPriceChangeAmount] = useState('');
    const [outcome, setOutcome] = useState<UpdateOutcome | null>(null);

    const loadProducts = useCallback(async () => {
        setIsLoadingProducts(true);
        try {
            const response = await api.getProducts();
            if (response.success && response.products) {
                setProducts(response.products);
            }
        } catch (err) {
            console.error('Failed to load products:', err);
            toast.error('Could not load products. Try again.');
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

    const variant1Name = products[0]?.variants[0]?.title || 'Variant 1';
    const variant2Name = products[0]?.variants[1]?.title || 'Variant 2';

    const columns: Column<Product>[] = [
        {
            key: 'title',
            header: 'Product',
            render: (product) => (
                <span className={styles.product}>
                    {product.image ? <img src={product.image} alt="" className={styles.thumb} loading="lazy" /> : <span className={styles.thumb} />}
                    <span className={styles.productText}>
                        <span className={styles.productTitle}>{product.title}</span>
                        <span className={styles.productId}>{product.id}</span>
                    </span>
                </span>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            render: (product) => <Badge size="sm" tone={product.status === 'active' ? 'positive' : 'neutral'}>{statusLabel(product.status)}</Badge>,
        },
        {
            key: 'variant1',
            header: variant1Name,
            numeric: true,
            render: (product) => (product.variants[0] ? <Amount value={parseFloat(product.variants[0].price)} decimals={2} /> : '—'),
        },
        {
            key: 'variant2',
            header: variant2Name,
            numeric: true,
            render: (product) => (product.variants[1] ? <Amount value={parseFloat(product.variants[1].price)} decimals={2} /> : '—'),
        },
    ];

    const resetForm = () => {
        setVariant1Price('');
        setVariant2Price('');
        setVariant1CompareAtPrice('');
        setVariant2CompareAtPrice('');
        setPriceChangePercent('');
        setPriceChangeAmount('');
    };

    const applyPriceUpdate = async () => {
        if (selectedProducts.size === 0) return;

        setIsUpdatingPrices(true);

        try {
            const productIds = Array.from(selectedProducts).map(Number);

            const updateData: {
                productIds: number[];
                updateType: UpdateType;
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
                    toast.success(`Updated prices for ${plural(successful, 'product')}`);
                    setOutcome(null);
                } else {
                    // Partial failures stay on the page so the failed products can be checked.
                    setOutcome({
                        successful,
                        failed,
                        failures: result.results.filter(r => !r.success).map(r => `Product ${r.productId}: ${r.error}`),
                    });
                }

                // Reload products to reflect changes
                await loadProducts();

                // Reset and close the dialog
                setShowPriceUpdateModal(false);
                resetForm();
                setSelectedProducts(new Set());
            } else {
                toast.error(result.error || 'Failed to update prices');
            }
        } catch (error) {
            console.error('Error updating prices:', error);
            toast.error('Could not update prices. Try again.');
        } finally {
            setIsUpdatingPrices(false);
        }
    };

    const filtersOn = productSearch !== '' || productStatusFilter !== 'all';

    return (
        <div className={styles.products}>
            <div className={styles.toolbar}>
                <TextField
                    className={styles.search}
                    size="sm"
                    icon="search"
                    type="search"
                    aria-label="Search products"
                    placeholder="Search products"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                />
                <SegmentedControl size="sm" label="Status" value={productStatusFilter} onChange={(v) => setProductStatusFilter(v as StatusFilter)} options={STATUS_OPTIONS} />
                <span className={styles.count}>{plural(filteredProducts.length, 'product')}</span>
            </div>

            {outcome && (
                <Alert
                    tone="caution"
                    title={`Updated ${plural(outcome.successful, 'product')}; ${outcome.failed} failed`}
                    action={<Button size="sm" variant="ghost" onClick={() => setOutcome(null)}>Dismiss</Button>}
                >
                    <ul className={styles.failures}>
                        {outcome.failures.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                </Alert>
            )}

            <Card title="Products" description="Select products to change their prices on Shopify." padding="none">
                <DataTable
                    columns={columns}
                    rows={filteredProducts}
                    getRowId={(product) => String(product.id)}
                    loading={isLoadingProducts}
                    selectable
                    selected={selectedProducts}
                    onSelectionChange={setSelectedProducts}
                    bulkActions={
                        <Button size="sm" variant="primary" icon="indian-rupee" onClick={() => setShowPriceUpdateModal(true)}>
                            Update prices
                        </Button>
                    }
                    caption="Products and variant prices"
                    empty={
                        <EmptyState
                            size="sm"
                            icon="package"
                            title={filtersOn ? 'No products match your filters' : 'No products found'}
                            description={filtersOn ? 'Clear the search or pick another status.' : undefined}
                        />
                    }
                />
            </Card>

            <Dialog
                open={showPriceUpdateModal}
                onClose={() => !isUpdatingPrices && setShowPriceUpdateModal(false)}
                title="Update prices"
                description={`${plural(selectedProducts.size, 'product')} selected. Prices change on Shopify straight away.`}
                icon="indian-rupee"
                footer={
                    <>
                        <Button onClick={() => setShowPriceUpdateModal(false)} disabled={isUpdatingPrices}>
                            Cancel
                        </Button>
                        <Button variant="primary" onClick={applyPriceUpdate} loading={isUpdatingPrices}>
                            {isUpdatingPrices ? 'Updating…' : 'Update prices'}
                        </Button>
                    </>
                }
            >
                <div className={styles.form}>
                    <SegmentedControl label="Kind of change" value={priceUpdateType} onChange={(v) => setPriceUpdateType(v as UpdateType)} options={UPDATE_OPTIONS} />

                    {priceUpdateType === 'set' ? (
                        <>
                            <fieldset className={styles.variant}>
                                <legend className={styles.legend}>{variant1Name}</legend>
                                <TextField label="Price" prefix="₹" type="number" placeholder="Unchanged" value={variant1Price} onChange={(e) => setVariant1Price(e.target.value)} />
                                <TextField label="Compare-at price" prefix="₹" type="number" placeholder="Unchanged" value={variant1CompareAtPrice} onChange={(e) => setVariant1CompareAtPrice(e.target.value)} />
                            </fieldset>
                            <fieldset className={styles.variant}>
                                <legend className={styles.legend}>{variant2Name}</legend>
                                <TextField label="Price" prefix="₹" type="number" placeholder="Unchanged" value={variant2Price} onChange={(e) => setVariant2Price(e.target.value)} />
                                <TextField label="Compare-at price" prefix="₹" type="number" placeholder="Unchanged" value={variant2CompareAtPrice} onChange={(e) => setVariant2CompareAtPrice(e.target.value)} />
                            </fieldset>
                        </>
                    ) : (
                        <>
                            <div className={styles.change}>
                                <TextField
                                    label="By percentage"
                                    suffix="%"
                                    type="number"
                                    placeholder="10"
                                    value={priceChangePercent}
                                    onChange={(e) => {
                                        setPriceChangePercent(e.target.value);
                                        if (e.target.value) setPriceChangeAmount('');
                                    }}
                                />
                                <span className={styles.or}>or</span>
                                <TextField
                                    label="By amount"
                                    prefix="₹"
                                    type="number"
                                    placeholder="100"
                                    value={priceChangeAmount}
                                    onChange={(e) => {
                                        setPriceChangeAmount(e.target.value);
                                        if (e.target.value) setPriceChangePercent('');
                                    }}
                                />
                            </div>
                            <p className={styles.help}>
                                This will {priceUpdateType} the price of every variant of the selected products.
                            </p>
                        </>
                    )}
                </div>
            </Dialog>
        </div>
    );
}
