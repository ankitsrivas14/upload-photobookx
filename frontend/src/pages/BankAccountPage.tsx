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
    tags?: string[];
}

interface BankCategory {
    name: string;
    tags: string[];
}

export function BankAccountPage() {
    const [isLoading, setIsLoading] = useState(false);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [period, setPeriod] = useState<string>('');
    const [categorizedTransactions, setCategorizedTransactions] = useState<Transaction[]>([]);
    const [categories, setCategories] = useState<BankCategory[]>([]);
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
    const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string | null>(null);
    const [showTagMenu, setShowTagMenu] = useState(false);
    const [newTagName, setNewTagName] = useState('');
    const [isAddingTag, setIsAddingTag] = useState<string | null>(null); // Category name if adding a tag
    const [movingTransactionId, setMovingTransactionId] = useState<string | null>(null);
    const [showUntaggedOnly, setShowUntaggedOnly] = useState(false);
    const [narrationRules, setNarrationRules] = useState<any[]>([]);
    const [showConfig, setShowConfig] = useState(false);
    const [newRuleKeyword, setNewRuleKeyword] = useState('');
    const [newRuleNickname, setNewRuleNickname] = useState('');

    useEffect(() => {
        fetchNarrationRules();
    }, []);

    const fetchNarrationRules = async () => {
        try {
            const res = await api.getNarrationRules();
            if (res.success) {
                setNarrationRules(res.rules);
            }
        } catch (err) {
            console.error('Error fetching narration rules:', err);
        }
    };

    const handleAddRule = async () => {
        if (!newRuleKeyword || !newRuleNickname) return;
        try {
            const res = await api.createNarrationRule(newRuleKeyword, newRuleNickname);
            if (res.success) {
                setNarrationRules([res.rule, ...narrationRules]);
                setNewRuleKeyword('');
                setNewRuleNickname('');
            }
        } catch (err) {
            console.error('Error adding rule:', err);
        }
    };

    const handleDeleteRule = async (id: string) => {
        try {
            const res = await api.deleteNarrationRule(id);
            if (res.success) {
                setNarrationRules(narrationRules.filter(r => r.id !== id));
            }
        } catch (err) {
            console.error('Error deleting rule:', err);
        }
    };

    const applyNarrationRule = (narration: string) => {
        const matchingRule = narrationRules.find(rule =>
            narration.toLowerCase().includes(rule.keyword.toLowerCase())
        );
        if (matchingRule) {
            return {
                styled: matchingRule.nickname,
                original: narration,
                hasRule: true
            };
        }
        return {
            styled: narration,
            original: narration,
            hasRule: false
        };
    };

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

    const toggleSelectAll = (isCategorized: boolean = false) => {
        if (isCategorized) {
            const allSelected = filteredCategorized.length > 0 && filteredCategorized.every(t => t.isSelected);
            const filteredIds = new Set(filteredCategorized.map(t => t.id));
            setCategorizedTransactions(categorizedTransactions.map(t =>
                filteredIds.has(t.id) ? { ...t, isSelected: !allSelected } : t
            ));
        } else {
            const allSelected = transactions.length > 0 && transactions.every(t => t.isSelected);
            setTransactions(transactions.map(t => ({ ...t, isSelected: !allSelected })));
        }
    };

    const toggleSelect = (id: string, isCategorized: boolean = false) => {
        if (isCategorized) {
            setCategorizedTransactions(categorizedTransactions.map(t =>
                t.id === id ? { ...t, isSelected: !t.isSelected } : t
            ));
        } else {
            setTransactions(transactions.map(t =>
                t.id === id ? { ...t, isSelected: !t.isSelected } : t
            ));
        }
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
        if (name && !categories.some(c => c.name === name)) {
            try {
                const res = await api.createBankCategory(name);
                if (res.success) {
                    setCategories([...categories, { name: res.category, tags: [] }].sort((a, b) => a.name.localeCompare(b.name)));
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
                setCategories(categories.map(c => c.name === oldName ? { ...c, name: res.category } : c).sort((a, b) => a.name.localeCompare(b.name)));
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

    const handleUpdateCategoryTags = async (categoryName: string, tags: string[]) => {
        try {
            const res = await api.updateCategoryTags(categoryName, tags);
            if (res.success) {
                setCategories(categories.map(c =>
                    c.name === categoryName ? { ...c, tags: res.tags || [] } : c
                ));
            }
        } catch (err) {
            console.error('Error updating tags:', err);
        }
    };

    const handleTagTransactions = async (tags: string[]) => {
        const selected = filteredCategorized.filter(t => t.isSelected);
        if (selected.length === 0) return;

        const ids = selected.map(t => t.id);
        try {
            const res = await api.updateTransactionTags(ids, tags);
            if (res.success) {
                setCategorizedTransactions(categorizedTransactions.map(tx =>
                    ids.includes(tx.id) ? { ...tx, tags, isSelected: false } : tx
                ));
                setShowTagMenu(false);
            } else {
                alert('Failed to update transaction tags');
            }
        } catch (err) {
            console.error('Error tagging transactions:', err);
        }
    };

    const handleMoveTransaction = async (id: string, newCategory: string) => {
        try {
            const res = await api.updateBankTransactionCategory(id, newCategory);
            if (res.success) {
                setCategorizedTransactions(categorizedTransactions.map(tx =>
                    tx.id === id ? { ...tx, category: newCategory, tags: [] } : tx
                ));
            } else {
                alert('Failed to move transaction: ' + res.error);
            }
        } catch (err) {
            console.error('Error moving transaction:', err);
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
        return categorizedTransactions.filter(tx => {
            const dateMatch = getMonthYearFromDate(tx.date) === monthFilter;
            const categoryMatch = !selectedCategoryFilter || tx.category === selectedCategoryFilter;
            const tagsMatch = !showUntaggedOnly || !tx.tags || tx.tags.length === 0;
            return dateMatch && categoryMatch && tagsMatch;
        });
    }, [categorizedTransactions, monthFilter, selectedCategoryFilter, showUntaggedOnly]);

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
            .map(([name, stats]) => {
                const catDef = categories.find(c => c.name === name);
                return {
                    name,
                    ...stats,
                    tags: catDef?.tags || []
                };
            })
            .sort((a, b) => b.outgoing - a.outgoing); // Sort by highest spend
    }, [filteredCategorized, categories]);

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
                    <button className={styles['config-btn']} onClick={() => setShowConfig(!showConfig)} title="Narration Config">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                    </button>
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

            {showConfig && (
                <div className={styles['modal-overlay']} onClick={() => setShowConfig(false)}>
                    <div className={styles['config-modal']} onClick={e => e.stopPropagation()}>
                        <div className={styles['modal-header']}>
                            <div className={styles['modal-header-title']}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '20px', height: '20px' }}>
                                    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
                                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                                </svg>
                                <h3>Narration Config</h3>
                            </div>
                            <button className={styles['modal-close']} onClick={() => setShowConfig(false)}>&times;</button>
                        </div>
                        <div className={styles['modal-body']}>
                            <p className={styles['modal-desc']}>Map complex transaction keywords (like UPI IDs) to simple nicknames. Hover over a nickname in the table to see the original narration.</p>

                            <div className={styles['add-rule-form']}>
                                <div className={styles['input-group']}>
                                    <label>Keyword</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. UPI/2304..."
                                        value={newRuleKeyword}
                                        onChange={(e) => setNewRuleKeyword(e.target.value)}
                                    />
                                </div>
                                <div className={styles['input-group']}>
                                    <label>Nickname</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Amazon Pay"
                                        value={newRuleNickname}
                                        onChange={(e) => setNewRuleNickname(e.target.value)}
                                    />
                                </div>
                                <button className={styles['primary-btn']} onClick={handleAddRule} style={{ alignSelf: 'flex-end', height: '38px' }}>
                                    Add Rule
                                </button>
                            </div>

                            <div className={styles['rules-list-container']}>
                                <h4>Saved Rules ({narrationRules.length})</h4>
                                {narrationRules.length === 0 ? (
                                    <div className={styles['empty-rules']}>
                                        <p>No rules defined yet. Add your first rule above!</p>
                                    </div>
                                ) : (
                                    <div className={styles['rules-scroll']}>
                                        <table className={styles['rules-table']}>
                                            <thead>
                                                <tr>
                                                    <th>Keyword</th>
                                                    <th>Nickname</th>
                                                    <th style={{ width: '80px', textAlign: 'center' }}>Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {narrationRules.map((rule) => (
                                                    <tr key={rule.id}>
                                                        <td className={styles['keyword-cell']}>{rule.keyword}</td>
                                                        <td className={styles['nickname-cell']}>{rule.nickname}</td>
                                                        <td style={{ textAlign: 'center' }}>
                                                            <button
                                                                className={styles['delete-rule-btn']}
                                                                onClick={() => handleDeleteRule(rule.id)}
                                                                title="Delete Rule"
                                                            >
                                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '14px', height: '14px' }}>
                                                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                                                </svg>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                            <div
                                key={cat.name}
                                className={`${styles['category-stat-item']} ${selectedCategoryFilter === cat.name ? styles['active-filter'] : ''}`}
                                onClick={() => setSelectedCategoryFilter(selectedCategoryFilter === cat.name ? null : cat.name)}
                            >
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
                                <div className={styles['cat-tags']} onClick={e => e.stopPropagation()}>
                                    {cat.tags?.map(tag => (
                                        <span key={tag} className={styles['tag-pill']}>{tag}</span>
                                    ))}
                                    {isAddingTag === cat.name ? (
                                        <div className={styles['cat-tag-form']}>
                                            <input
                                                className={styles['cat-tag-input']}
                                                value={newTagName}
                                                onChange={e => setNewTagName(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') {
                                                        handleUpdateCategoryTags(cat.name, [...(cat.tags || []), newTagName.trim()]);
                                                        setNewTagName('');
                                                        setIsAddingTag(null);
                                                    }
                                                    if (e.key === 'Escape') setIsAddingTag(null);
                                                }}
                                                autoFocus
                                                placeholder="Tag name..."
                                            />
                                            <button
                                                className={styles['tag-save-btn']}
                                                onClick={() => {
                                                    handleUpdateCategoryTags(cat.name, [...(cat.tags || []), newTagName.trim()]);
                                                    setNewTagName('');
                                                    setIsAddingTag(null);
                                                }}
                                            >
                                                +
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            className={styles['add-tag-trigger']}
                                            onClick={() => setIsAddingTag(cat.name)}
                                        >
                                            + Tag
                                        </button>
                                    )}
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
                                                    <div key={cat.name} className={styles['category-menu-item-wrapper']}>
                                                        <button
                                                            onClick={() => handleCategorize(cat.name)}
                                                            className={styles['category-item']}
                                                        >
                                                            {cat.name}
                                                        </button>
                                                        <button
                                                            className={styles['menu-cat-delete']}
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
                                            onChange={() => toggleSelectAll(false)}
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
                                                onChange={() => toggleSelect(tx.id, false)}
                                            />
                                        </td>
                                        <td className={styles['date-cell']}>{tx.date}</td>
                                        <td className={styles['narration-cell']}>
                                            <div className={styles['narration-content']}>
                                                {(() => {
                                                    const { styled, original, hasRule } = applyNarrationRule(tx.narration);
                                                    return (
                                                        <>
                                                            <span className={hasRule ? styles['nickname-text'] : ''}>
                                                                {styled}
                                                            </span>
                                                            {hasRule && (
                                                                <div className={styles['info-tooltip-wrapper']}>
                                                                    <button className={styles['info-btn']}>
                                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                            <circle cx="12" cy="12" r="10" />
                                                                            <line x1="12" y1="16" x2="12" y2="12" />
                                                                            <line x1="12" y1="8" x2="12.01" y2="8" />
                                                                        </svg>
                                                                    </button>
                                                                    <div className={styles['info-tooltip']}>
                                                                        {original}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </div>
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
                            <h3>Categorized ({monthFilter}){selectedCategoryFilter && ` : ${selectedCategoryFilter}`}</h3>
                            <div className={styles['table-subtitles']}>
                                <span className={styles['subtitle']}>{filteredCategorized.length} records</span>
                                {selectedCategoryFilter && (
                                    <button
                                        className={styles['clear-filter-btn']}
                                        onClick={() => setSelectedCategoryFilter(null)}
                                    >
                                        Show All Categories
                                    </button>
                                )}
                                {selectedCategoryFilter && (
                                    <label className={styles['toggle-filter']}>
                                        <input
                                            type="checkbox"
                                            checked={showUntaggedOnly}
                                            onChange={(e) => setShowUntaggedOnly(e.target.checked)}
                                        />
                                        <span>Show Untagged Only</span>
                                    </label>
                                )}
                                {filteredCategorized.some(t => t.isSelected) && selectedCategoryFilter && (
                                    <div className={styles['category-dropdown-container']}>
                                        <button
                                            className={styles['clear-filter-btn']}
                                            onClick={() => setShowTagMenu(!showTagMenu)}
                                            style={{ marginLeft: '8px' }}
                                        >
                                            Add Tag to Selection
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '10px', height: '10px', marginLeft: '4px' }}>
                                                <polyline points="6 9 12 15 18 9" />
                                            </svg>
                                        </button>
                                        {showTagMenu && (
                                            <div className={styles['category-tags-dropdown']}>
                                                <div className={styles['tag-menu-list']}>
                                                    {categories.find(c => c.name === selectedCategoryFilter)?.tags.map(tag => (
                                                        <button
                                                            key={tag}
                                                            className={styles['tag-menu-item']}
                                                            onClick={() => handleTagTransactions([tag])}
                                                        >
                                                            {tag}
                                                        </button>
                                                    ))}
                                                    <div className={styles['add-category-form']} style={{ marginTop: '4px' }}>
                                                        <input
                                                            type="text"
                                                            placeholder="New tag..."
                                                            value={newTagName}
                                                            onChange={e => setNewTagName(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') {
                                                                    const cat = categories.find(c => c.name === selectedCategoryFilter);
                                                                    if (cat) {
                                                                        const upgradedTags = [...cat.tags, newTagName.trim()];
                                                                        handleUpdateCategoryTags(cat.name, upgradedTags);
                                                                        handleTagTransactions([newTagName.trim()]);
                                                                        setNewTagName('');
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className={styles['table-container']}>
                        <table className={styles['tx-table']}>
                            <thead>
                                <tr>
                                    <th>
                                        <input
                                            type="checkbox"
                                            checked={filteredCategorized.length > 0 && filteredCategorized.every(t => t.isSelected)}
                                            onChange={() => toggleSelectAll(true)}
                                        />
                                    </th>
                                    <th>Date</th>
                                    <th>Category / Tags</th>
                                    <th>Narration</th>
                                    <th className={styles['amount-cell']}>Withdrawal</th>
                                    <th className={styles['amount-cell']}>Deposit</th>
                                    <th className={styles['action-cell']}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCategorized.map((tx) => (
                                    <tr key={tx.id}>
                                        <td className={styles['checkbox-cell']}>
                                            <input
                                                type="checkbox"
                                                checked={tx.isSelected || false}
                                                onChange={() => toggleSelect(tx.id, true)}
                                            />
                                        </td>
                                        <td className={styles['date-cell']}>{tx.date}</td>
                                        <td>
                                            <div className={styles['cat-badge-group']}>
                                                <span className={styles['category-badge']}>{tx.category}</span>
                                                <div className={styles['tx-tags-container']}>
                                                    {tx.tags?.map(tag => (
                                                        <span key={tag} className={styles['tx-tag']}>{tag}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        </td>
                                        <td className={styles['narration-cell']}>
                                            <div className={styles['narration-content']}>
                                                {(() => {
                                                    const { styled, original, hasRule } = applyNarrationRule(tx.narration);
                                                    return (
                                                        <>
                                                            <span className={hasRule ? styles['nickname-text'] : ''}>
                                                                {styled}
                                                            </span>
                                                            {hasRule && (
                                                                <div className={styles['info-tooltip-wrapper']}>
                                                                    <button className={styles['info-btn']}>
                                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                            <circle cx="12" cy="12" r="10" />
                                                                            <line x1="12" y1="16" x2="12" y2="12" />
                                                                            <line x1="12" y1="8" x2="12.01" y2="8" />
                                                                        </svg>
                                                                    </button>
                                                                    <div className={styles['info-tooltip']}>
                                                                        {original}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        </td>
                                        <td className={`${styles['amount-cell']} ${styles.red}`}>
                                            {tx.withdrawal > 0 ? `₹${tx.withdrawal.toLocaleString('en-IN')}` : '—'}
                                        </td>
                                        <td className={`${styles['amount-cell']} ${styles.green}`}>
                                            {tx.deposit > 0 ? `₹${tx.deposit.toLocaleString('en-IN')}` : '—'}
                                        </td>
                                        <td className={styles['action-cell']}>
                                            <div className={styles['action-cell-content']}>
                                                <div className={styles['category-dropdown-container']}>
                                                    <button
                                                        className={styles['remove-btn']}
                                                        onClick={() => setMovingTransactionId(movingTransactionId === tx.id ? null : tx.id)}
                                                        title="Move to another category"
                                                    >
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                            <polyline points="16 3 21 3 21 8" />
                                                            <line x1="4" y1="20" x2="21" y2="3" />
                                                            <polyline points="21 16 21 21 16 21" />
                                                            <line x1="15" y1="15" x2="21" y2="21" />
                                                            <line x1="4" y1="4" x2="9" y2="9" />
                                                        </svg>
                                                    </button>
                                                    {movingTransactionId === tx.id && (
                                                        <div className={styles['category-menu']}>
                                                            <div className={styles['category-list']}>
                                                                {categories.map((cat) => (
                                                                    <button
                                                                        key={cat.name}
                                                                        onClick={() => {
                                                                            handleMoveTransaction(tx.id, cat.name);
                                                                            setMovingTransactionId(null);
                                                                        }}
                                                                        className={`${styles['category-item']} ${tx.category === cat.name ? styles['active-cat'] : ''}`}
                                                                    >
                                                                        {cat.name}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    className={styles['remove-btn']}
                                                    onClick={() => removeCategorized(tx.id)}
                                                    title="Revert categorization"
                                                >
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                        <path d="M19 12H5M12 19l-7-7 7-7" />
                                                    </svg>
                                                </button>
                                            </div>
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
