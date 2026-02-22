import { useState, useRef, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import styles from './BankAccountPage.module.css';
import { api } from '../services/api';

interface Transaction {
    id: string;
    date: string;
    narration: string;
    reference: string;
    withdrawal: number;
    deposit: number;
    balance: number;
    isSelected: boolean;
    category?: string;
}

export function BankAccountPage() {
    const [isLoading, setIsLoading] = useState(false);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [period, setPeriod] = useState<string>('');
    const [categorizedTransactions, setCategorizedTransactions] = useState<Transaction[]>([]);
    const [categories, setCategories] = useState<string[]>([]);
    const [showCategoryMenu, setShowCategoryMenu] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Month Filter State
    const getCurrentMonthYear = () => {
        const now = new Date();
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[now.getMonth()]} ${now.getFullYear()}`;
    };
    const [monthFilter, setMonthFilter] = useState<string>(getCurrentMonthYear());

    // Helper to extract month-year from DD/MM/YYYY or DD/MM/YY
    const getMonthYearFromDate = (dateStr: string) => {
        const parts = dateStr.split('/');
        if (parts.length !== 3) return null;
        const monthIdx = parseInt(parts[1]) - 1;
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        let year = parts[2];
        if (year.length === 2) year = '20' + year;
        return `${months[monthIdx]} ${year}`;
    };

    // Initial data fetch
    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);
            try {
                const [catRes, txRes] = await Promise.all([
                    api.getBankCategories(),
                    api.getBankTransactions()
                ]);

                if (catRes.success) setCategories(catRes.categories);
                if (txRes.success) setCategorizedTransactions(txRes.transactions);
            } catch (err) {
                console.error('Error fetching initial bank data:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, []);

    const [ignoredCount, setIgnoredCount] = useState(0);
    const [editingCategory, setEditingCategory] = useState<string | null>(null);
    const [editCategoryName, setEditCategoryName] = useState('');

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsLoading(true);
        setIgnoredCount(0); // Reset count
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];
                const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

                parseHDFCStatement(data);
            } catch (err) {
                console.error('Error parsing file:', err);
                alert('Failed to parse the file. Please ensure it is a valid HDFC statement XLS.');
            } finally {
                setIsLoading(false);
            }
        };
        reader.readAsBinaryString(file);
    };

    const parseHDFCStatement = (data: any[][]) => {
        let txStartIndex = -1;
        let periodFound = '';

        for (let i = 0; i < data.length; i++) {
            const row = data[i];
            if (!row) continue;
            const rowStr = row.join(' ');

            if (rowStr.includes('Statement From')) {
                const match = rowStr.match(/Statement From\s*:\s*([\d/]+)\s*To\s*:\s*([\d/]+)/);
                if (match) {
                    periodFound = `${match[1]} - ${match[2]}`;
                    const my = getMonthYearFromDate(match[1]);
                    if (my) setMonthFilter(my);
                }
            }

            if (row.includes('Date') && row.includes('Narration') && row.includes('Closing Balance')) {
                txStartIndex = i + 1;
                if (data[i + 1] && String(data[i + 1][0]).includes('*******')) {
                    txStartIndex = i + 2;
                }
                break;
            }
        }

        if (txStartIndex === -1) {
            alert('Could not find transaction section in the file. Please ensure you are uploading your HDFC statement.');
            return;
        }

        const extractedTxs: Transaction[] = [];

        // Create lookup for existing transactions to avoid duplicates
        const existingSignatures = new Set(categorizedTransactions.map(tx =>
            `${tx.date}|${tx.narration}|${tx.reference}|${tx.withdrawal}|${tx.deposit}|${tx.balance}`
        ));

        let duplicateCount = 0;

        for (let i = txStartIndex; i < data.length; i++) {
            const row = data[i];
            if (!row || !row[0] || String(row[0]).trim() === '' || String(row[0]).includes('*')) continue;

            const date = String(row[0]);

            // Strict date check: must be DD/MM/YY or DD/MM/YYYY
            if (!date.includes('/') || date.split('/').length < 3) continue;

            const narration = String(row[1] || '').trim();
            const reference = String(row[2] || '').trim();
            const withdrawal = parseFloat(String(row[4] || '0').replace(/,/g, '')) || 0;
            const deposit = parseFloat(String(row[5] || '0').replace(/,/g, '')) || 0;
            const balance = parseFloat(String(row[6] || '0').replace(/,/g, '')) || 0;

            const signature = `${date}|${narration}|${reference}|${withdrawal}|${deposit}|${balance}`;

            if (existingSignatures.has(signature)) {
                duplicateCount++;
                continue; // Skip already categorized transactions
            }

            const tx: Transaction = {
                id: `local-${i}-${Date.now()}`,
                date,
                narration,
                reference,
                withdrawal,
                deposit,
                balance,
                isSelected: false
            };

            if (tx.date && tx.narration) {
                extractedTxs.push(tx);
            }
        }

        if (duplicateCount > 0) {
            setIgnoredCount(duplicateCount);
            console.log(`Ignored ${duplicateCount} transactions that were already categorized.`);
        }

        setTransactions(extractedTxs);
        setPeriod(periodFound);
    };

    const toggleSelectAll = () => {
        const allSelected = transactions.length > 0 && transactions.every(t => t.isSelected);
        setTransactions(transactions.map(t => ({ ...t, isSelected: !allSelected })));
    };

    const toggleSelect = (id: string) => {
        setTransactions(transactions.map(t =>
            t.id === id ? { ...t, isSelected: !t.isSelected } : t
        ));
    };

    const selectedCount = transactions.filter(t => t.isSelected).length;

    const handleCategorize = async (category: string) => {
        const selected = transactions.filter(t => t.isSelected);
        const remaining = transactions.filter(t => !t.isSelected);

        const newlyCategorized = selected.map(t => ({
            date: t.date,
            narration: t.narration,
            reference: t.reference,
            withdrawal: t.withdrawal,
            deposit: t.deposit,
            balance: t.balance,
            category
        }));

        try {
            const res = await api.saveBankTransactions(newlyCategorized);
            if (res.success) {
                setCategorizedTransactions([...res.transactions, ...categorizedTransactions]);
                setTransactions(remaining);
                setShowCategoryMenu(false);
            } else {
                alert('Failed to save categorization: ' + res.error);
            }
        } catch (err) {
            console.error('Error categorizing:', err);
            alert('Failed to save to backend');
        }
    };

    const handleAddCategory = async (e: React.FormEvent) => {
        e.preventDefault();
        const name = newCategoryName.trim();
        if (name && !categories.includes(name)) {
            try {
                const res = await api.createBankCategory(name);
                if (res.success) {
                    setCategories([...categories, res.category].sort());
                    setNewCategoryName('');
                } else {
                    alert('Failed to add category: ' + res.error);
                }
            } catch (err) {
                console.error('Error adding category:', err);
            }
        }
    };

    const removeCategorized = async (id: string) => {
        try {
            const res = await api.deleteBankTransaction(id);
            if (res.success) {
                setCategorizedTransactions(categorizedTransactions.filter(t => t.id !== id));
            } else {
                alert('Failed to remove transaction: ' + res.error);
            }
        } catch (err) {
            console.error('Error removing transaction:', err);
            alert('Failed to remove from backend');
        }
    };

    const handleUpdateCategory = async (oldName: string) => {
        const newName = editCategoryName.trim();
        if (!newName || newName === oldName) {
            setEditingCategory(null);
            return;
        }

        try {
            const res = await api.updateBankCategory(oldName, newName);
            if (res.success) {
                setCategories(categories.map(c => c === oldName ? res.category : c).sort());
                setCategorizedTransactions(categorizedTransactions.map(tx =>
                    tx.category === oldName ? { ...tx, category: res.category } : tx
                ));
                setEditingCategory(null);
            } else {
                alert('Failed to update category: ' + res.error);
            }
        } catch (err) {
            console.error('Error updating category:', err);
        }
    };

    const handleDeleteCategory = async (name: string) => {
        if (!window.confirm(`Are you sure you want to delete "${name}"? Transactions using this category will be moved to "deleted_${name}".`)) {
            return;
        }

        try {
            const res = await api.deleteBankCategory(name);
            if (res.success) {
                // Refresh categories and transactions from backend to be safe, 
                // or update local state manually for speed
                const [catRes, txRes] = await Promise.all([
                    api.getBankCategories(),
                    api.getBankTransactions()
                ]);
                if (catRes.success) setCategories(catRes.categories);
                if (txRes.success) setCategorizedTransactions(txRes.transactions);
            } else {
                alert('Failed to delete category: ' + res.error);
            }
        } catch (err) {
            console.error('Error deleting category:', err);
        }
    };

    // Derived Data
    const availableMonths = useMemo(() => {
        const monthsSet = new Set<string>();
        monthsSet.add(getCurrentMonthYear());

        categorizedTransactions.forEach(tx => {
            const my = getMonthYearFromDate(tx.date);
            if (my) monthsSet.add(my);
        });

        transactions.forEach(tx => {
            const my = getMonthYearFromDate(tx.date);
            if (my) monthsSet.add(my);
        });

        return Array.from(monthsSet).sort((a, b) => {
            const dateA = new Date(a);
            const dateB = new Date(b);
            return dateB.getTime() - dateA.getTime();
        });
    }, [categorizedTransactions, transactions]);

    const filteredCategorized = useMemo(() => {
        return categorizedTransactions.filter(tx => getMonthYearFromDate(tx.date) === monthFilter);
    }, [categorizedTransactions, monthFilter]);

    const stats = useMemo(() => {
        let incoming = 0;
        let outgoing = 0;
        let latestBalance = 0;

        const allTransactionsForMonth = [
            ...transactions.filter(tx => getMonthYearFromDate(tx.date) === monthFilter),
            ...categorizedTransactions.filter(tx => getMonthYearFromDate(tx.date) === monthFilter)
        ];

        allTransactionsForMonth.forEach(tx => {
            incoming += tx.deposit;
            outgoing += tx.withdrawal;
        });

        const allTxs = [...transactions, ...categorizedTransactions];
        if (allTxs.length > 0) {
            const latestTx = [...allTxs].sort((a, b) => {
                const partsA = a.date.split('/');
                const partsB = b.date.split('/');

                if (partsA.length < 3 || partsB.length < 3) return 0;

                const dA = new Date(
                    parseInt(partsA[2].length === 2 ? '20' + partsA[2] : partsA[2]),
                    parseInt(partsA[1]) - 1,
                    parseInt(partsA[0])
                );
                const dB = new Date(
                    parseInt(partsB[2].length === 2 ? '20' + partsB[2] : partsB[2]),
                    parseInt(partsB[1]) - 1,
                    parseInt(partsB[0])
                );
                return dB.getTime() - dA.getTime();
            })[0];
            latestBalance = latestTx?.balance || 0;
        }

        return { incoming, outgoing, latestBalance };
    }, [transactions, categorizedTransactions, monthFilter]);

    // Category-wise Breakdown for the selected month
    const categoryStats = useMemo(() => {
        const map = new Map<string, { incoming: number; outgoing: number; count: number }>();

        filteredCategorized.forEach(tx => {
            const cat = tx.category || 'Uncategorized';
            const current = map.get(cat) || { incoming: 0, outgoing: 0, count: 0 };
            map.set(cat, {
                incoming: current.incoming + tx.deposit,
                outgoing: current.outgoing + tx.withdrawal,
                count: current.count + 1
            });
        });

        return Array.from(map.entries())
            .map(([name, stats]) => ({ name, ...stats }))
            .sort((a, b) => b.outgoing - a.outgoing); // Sort by highest spend
    }, [filteredCategorized]);

    if (isLoading && transactions.length === 0 && categorizedTransactions.length === 0) {
        return (
            <div className={styles['loading-container']}>
                <div className={styles.spinner}></div>
                <p>Loading Bank Data...</p>
            </div>
        );
    }

    return (
        <div className={styles['bank-account-page']}>
            <div className={styles['page-header']}>
                <div className={styles['header-info']}>
                    <h1>Bank Account</h1>
                    <div className={styles['header-meta']}>
                        <p>{period ? `Statement Period: ${period}` : 'Sync your bank transactions'}</p>
                    </div>
                </div>
                <div className={styles['header-actions']}>
                    <div className={styles['month-wrapper']}>
                        <label>Period:</label>
                        <select
                            value={monthFilter}
                            onChange={(e) => setMonthFilter(e.target.value)}
                            className={styles['filter-select']}
                        >
                            {availableMonths.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                    <input
                        type="file"
                        accept=".xls,.xlsx"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileUpload}
                    />
                    <button
                        className={styles['primary-btn']}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '16px', height: '16px', marginRight: '6px' }}>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        Upload XLS
                    </button>
                </div>
            </div>

            <div className={styles['stats-grid']}>
                <div className={styles['stat-card']}>
                    <div className={styles['stat-header']}>
                        <span className={styles['stat-label']}>Current Balance</span>
                        <div className={`${styles['stat-icon']} ${styles.blue}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="2" y="5" width="20" height="14" rx="2" />
                                <line x1="2" y1="10" x2="22" y2="10" />
                            </svg>
                        </div>
                    </div>
                    <div className={styles['stat-value']}>₹{stats.latestBalance.toLocaleString('en-IN')}</div>
                </div>

                <div className={styles['stat-card']}>
                    <div className={styles['stat-header']}>
                        <span className={styles['stat-label']}>Incoming ({monthFilter})</span>
                        <div className={`${styles['stat-icon']} ${styles.green}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                                <polyline points="17 6 23 6 23 12" />
                            </svg>
                        </div>
                    </div>
                    <div className={`${styles['stat-value']} ${styles.green}`}>+₹{stats.incoming.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>

                <div className={styles['stat-card']}>
                    <div className={styles['stat-header']}>
                        <span className={styles['stat-label']}>Outgoing ({monthFilter})</span>
                        <div className={`${styles['stat-icon']} ${styles.red}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
                                <polyline points="17 18 23 18 23 12" />
                            </svg>
                        </div>
                    </div>
                    <div className={`${styles['stat-value']} ${styles.red}`}>-₹{stats.outgoing.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
                </div>

                <div className={styles['stat-card']}>
                    <div className={styles['stat-header']}>
                        <span className={styles['stat-label']}>Categories</span>
                        <div className={`${styles['stat-icon']} ${styles.purple}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                            </svg>
                        </div>
                    </div>
                    <div className={styles['stat-value']}>{categoryStats.length} Grouped</div>
                </div>
            </div>

            {categoryStats.length > 0 && (
                <div className={styles['category-breakdown']}>
                    <h3>Category Breakdown (Spend)</h3>
                    <div className={styles['category-stats-list']}>
                        {categoryStats.map(cat => (
                            <div key={cat.name} className={styles['category-stat-item']}>
                                <div className={styles['cat-info']}>
                                    {editingCategory === cat.name ? (
                                        <div className={styles['cat-edit-group']}>
                                            <input
                                                type="text"
                                                value={editCategoryName}
                                                onChange={(e) => setEditCategoryName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') handleUpdateCategory(cat.name);
                                                    if (e.key === 'Escape') setEditingCategory(null);
                                                }}
                                                autoFocus
                                                className={styles['cat-edit-input']}
                                            />
                                            <button onClick={() => handleUpdateCategory(cat.name)} className={styles['cat-save-btn']}>✓</button>
                                        </div>
                                    ) : (
                                        <div className={styles['cat-name-group']}>
                                            <span className={styles['cat-name']}>{cat.name}</span>
                                            <button
                                                className={styles['cat-edit-trigger']}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setEditingCategory(cat.name);
                                                    setEditCategoryName(cat.name);
                                                }}
                                                title="Rename category"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                </svg>
                                            </button>
                                            <button
                                                className={styles['cat-delete-trigger']}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteCategory(cat.name);
                                                }}
                                                title="Delete category"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <polyline points="3 6 5 6 21 6"></polyline>
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                </svg>
                                            </button>
                                            <span className={styles['cat-count']}>{cat.count} txs</span>
                                        </div>
                                    )}
                                </div>
                                <div className={styles['cat-amounts']}>
                                    {cat.incoming > 0 && <span className={styles.green}>+₹{cat.incoming.toLocaleString('en-IN')}</span>}
                                    <span className={styles.red}>-₹{cat.outgoing.toLocaleString('en-IN')}</span>
                                </div>
                                <div className={styles['cat-bar-container']}>
                                    <div
                                        className={styles['cat-bar']}
                                        style={{ width: `${(cat.outgoing / stats.outgoing) * 100}%` }}
                                    ></div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {transactions.length > 0 && (
                <div className={styles['section-card']}>
                    <div className={styles['table-header']}>
                        <div className={styles['table-title']}>
                            <h3>New Transactions</h3>
                            <div className={styles['table-subtitles']}>
                                <span className={styles['subtitle']}>{selectedCount} of {transactions.length} selected</span>
                                {ignoredCount > 0 && (
                                    <span className={styles['ignored-badge']} title="These transactions are already categorized in our system">
                                        {ignoredCount} Duplicates Hidden
                                    </span>
                                )}
                            </div>
                        </div>
                        {selectedCount > 0 && (
                            <div className={styles['bulk-actions']}>
                                <div className={styles['category-dropdown-container']}>
                                    <button
                                        className={styles['action-btn']}
                                        onClick={() => setShowCategoryMenu(!showCategoryMenu)}
                                    >
                                        Categorize Selection
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '14px', height: '14px', marginLeft: '6px' }}>
                                            <polyline points="6 9 12 15 18 9" />
                                        </svg>
                                    </button>

                                    {showCategoryMenu && (
                                        <div className={styles['category-menu']}>
                                            <div className={styles['category-list']}>
                                                {categories.map((cat) => (
                                                    <div key={cat} className={styles['category-menu-item-wrapper']}>
                                                        <button
                                                            onClick={() => handleCategorize(cat)}
                                                            className={styles['category-item']}
                                                        >
                                                            {cat}
                                                        </button>
                                                        <button
                                                            className={styles['menu-cat-delete']}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeleteCategory(cat);
                                                            }}
                                                            title="Delete category"
                                                        >
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <polyline points="3 6 5 6 21 6"></polyline>
                                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                            </svg>
                                                        </button>
                                                    </div>
                                                ))}
                                                {categories.length === 0 && (
                                                    <div className={styles['empty-categories']}>No categories yet</div>
                                                )}
                                            </div>
                                            <form className={styles['add-category-form']} onSubmit={handleAddCategory}>
                                                <input
                                                    type="text"
                                                    placeholder="Create new..."
                                                    value={newCategoryName}
                                                    onChange={(e) => setNewCategoryName(e.target.value)}
                                                />
                                                <button type="submit">+</button>
                                            </form>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className={styles['table-container']}>
                        <table className={styles['tx-table']}>
                            <thead>
                                <tr>
                                    <th className={styles['checkbox-cell']}>
                                        <input
                                            type="checkbox"
                                            checked={transactions.length > 0 && transactions.every(t => t.isSelected)}
                                            onChange={toggleSelectAll}
                                        />
                                    </th>
                                    <th>Date</th>
                                    <th>Narration</th>
                                    <th className={styles['amount-cell']}>Withdrawal</th>
                                    <th className={styles['amount-cell']}>Deposit</th>
                                    <th className={styles['amount-cell']}>Balance</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transactions.map((tx) => (
                                    <tr key={tx.id} className={tx.isSelected ? styles['row-selected'] : ''}>
                                        <td className={styles['checkbox-cell']}>
                                            <input
                                                type="checkbox"
                                                checked={tx.isSelected}
                                                onChange={() => toggleSelect(tx.id)}
                                            />
                                        </td>
                                        <td className={styles['date-cell']}>{tx.date}</td>
                                        <td className={styles['narration-cell']} title={tx.narration}>
                                            {tx.narration}
                                        </td>
                                        <td className={`${styles['amount-cell']} ${styles.red}`}>
                                            {tx.withdrawal > 0 ? `₹${tx.withdrawal.toLocaleString('en-IN')}` : '—'}
                                        </td>
                                        <td className={`${styles['amount-cell']} ${styles.green}`}>
                                            {tx.deposit > 0 ? `₹${tx.deposit.toLocaleString('en-IN')}` : '—'}
                                        </td>
                                        <td className={styles['amount-cell']}>
                                            ₹{tx.balance.toLocaleString('en-IN')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {filteredCategorized.length > 0 ? (
                <div className={styles['section-card']}>
                    <div className={styles['table-header']}>
                        <div className={styles['table-title']}>
                            <h3>Categorized ({monthFilter})</h3>
                            <span className={styles['subtitle']}>{filteredCategorized.length} records</span>
                        </div>
                    </div>

                    <div className={styles['table-container']}>
                        <table className={styles['tx-table']}>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Category</th>
                                    <th>Narration</th>
                                    <th className={styles['amount-cell']}>Withdrawal</th>
                                    <th className={styles['amount-cell']}>Deposit</th>
                                    <th className={styles['action-cell']}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCategorized.map((tx) => (
                                    <tr key={tx.id}>
                                        <td className={styles['date-cell']}>{tx.date}</td>
                                        <td>
                                            <span className={styles['category-badge']}>{tx.category}</span>
                                        </td>
                                        <td className={styles['narration-cell']}>{tx.narration}</td>
                                        <td className={`${styles['amount-cell']} ${styles.red}`}>
                                            {tx.withdrawal > 0 ? `₹${tx.withdrawal.toLocaleString('en-IN')}` : '—'}
                                        </td>
                                        <td className={`${styles['amount-cell']} ${styles.green}`}>
                                            {tx.deposit > 0 ? `₹${tx.deposit.toLocaleString('en-IN')}` : '—'}
                                        </td>
                                        <td className={styles['action-cell']}>
                                            <button
                                                className={styles['remove-btn']}
                                                onClick={() => removeCategorized(tx.id)}
                                                title="Revert categorization"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <path d="M19 12H5M12 19l-7-7 7-7" />
                                                </svg>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : categorizedTransactions.length > 0 && (
                <div className={styles['empty-month']}>
                    No categorized data for {monthFilter}.
                </div>
            )}
        </div>
    );
}
