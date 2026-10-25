import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import toast from 'react-hot-toast';
import styles from './BankAccountPage.module.css';
import { api } from '../services/api';
import { Badge, Button, Card, Checkbox, Dialog, Dropzone, EmptyState, Menu, Select, Skeleton, StatCard, StatStrip, Switch, TextField, Tooltip } from '../components/ui/pbx';
import { cx, formatINR } from '../components/ui/format';

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

interface NarrationRule {
    id: string;
    keyword: string;
    nickname: string;
}

export function BankAccountPage() {
    const [isLoading, setIsLoading] = useState(false);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [period, setPeriod] = useState<string>('');
    const [categorizedTransactions, setCategorizedTransactions] = useState<Transaction[]>([]);
    const [categories, setCategories] = useState<BankCategory[]>([]);
    const [showCategoryMenu, setShowCategoryMenu] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');

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
    const [showUntaggedOnly, setShowUntaggedOnly] = useState(false);
    const [narrationRules, setNarrationRules] = useState<NarrationRule[]>([]);
    // The category waiting for a delete confirmation
    const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<string | null>(null);
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

    const handleFile = (file: File) => {
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
                toast.error('Failed to parse the file. Please ensure it is a valid HDFC statement XLS.');
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
            toast.error('Could not find transaction section in the file. Please ensure you are uploading your HDFC statement.');
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
                toast.error('Failed to save categorization: ' + res.error);
            }
        } catch (err) {
            console.error('Error categorizing:', err);
            toast.error('Failed to save to backend');
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
                    toast.error('Failed to add category: ' + res.error);
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
                toast.error('Failed to remove transaction: ' + res.error);
            }
        } catch (err) {
            console.error('Error removing transaction:', err);
            toast.error('Failed to remove from backend');
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
                toast.error('Failed to update category: ' + res.error);
            }
        } catch (err) {
            console.error('Error updating category:', err);
        }
    };

    const handleDeleteCategory = async (name: string) => {
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
                toast.error('Failed to delete category: ' + res.error);
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
                toast.error('Failed to update transaction tags');
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
                toast.error('Failed to move transaction: ' + res.error);
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
        return <Skeleton lines={8} />;
    }

    const tagCategory = categories.find(c => c.name === selectedCategoryFilter);
    const selectedCategorized = filteredCategorized.filter(t => t.isSelected);
    const money = (n: number) => formatINR(n, { decimals: 2 });

    // A narration, or its nickname from a rule with the original on hover
    const narrationCell = (narration: string) => {
        const { styled, original, hasRule } = applyNarrationRule(narration);
        return hasRule ? (
            <Tooltip content={original}>
                <span className={styles.nickname} tabIndex={0}>{styled}</span>
            </Tooltip>
        ) : (
            <Tooltip content={original}>
                <span className={styles.narration}>{styled}</span>
            </Tooltip>
        );
    };

    const addCategoryTag = (category: BankCategory | { name: string; tags: string[] }) => {
        const tag = newTagName.trim();
        if (tag) handleUpdateCategoryTags(category.name, [...(category.tags || []), tag]);
        setNewTagName('');
        setIsAddingTag(null);
    };

    return (
        <>
            <div className={styles.toolbar}>
                <Select
                    label="Period"
                    inlineLabel
                    size="sm"
                    value={monthFilter}
                    onChange={setMonthFilter}
                    options={availableMonths.map(m => ({ value: m, label: m }))}
                />
                <span className={styles.period}>{period ? `Statement ${period}` : 'Upload an HDFC statement to add transactions'}</span>
                <Button size="sm" icon="settings" onClick={() => setShowConfig(true)}>Narration rules</Button>
            </div>

            <StatStrip>
                <StatCard label="Current balance" value={formatINR(stats.latestBalance)} sub="latest statement line" />
                <StatCard label={`Incoming · ${monthFilter}`} value={formatINR(stats.incoming, { signed: true, decimals: 2 })} tone={stats.incoming > 0 ? 'positive' : 'neutral'} />
                <StatCard label={`Outgoing · ${monthFilter}`} value={formatINR(-stats.outgoing, { decimals: 2 })} tone={stats.outgoing > 0 ? 'negative' : 'neutral'} />
                <StatCard label="Categories" value={categoryStats.length.toLocaleString('en-IN')} sub="in use this month" />
            </StatStrip>

            <div className={styles.row}>
                <Card title="Statement" eyebrow="HDFC · XLS or XLSX">
                    <Dropzone
                        accept=".xls,.xlsx"
                        multiple={false}
                        title="Drop the statement here"
                        hint="New lines appear below to categorise; lines already saved are skipped."
                        buttonLabel="Choose file"
                        disabled={isLoading}
                        onFiles={(files) => { if (files[0]) handleFile(files[0]); }}
                    />
                </Card>

                <Card className={styles.wide} title={`Category breakdown · ${monthFilter}`} eyebrow="spend by category · click a name to filter" padding="sm">
                    {categoryStats.length === 0 ? (
                        <EmptyState size="sm" icon="layers" title="Nothing categorised this month" description="Categorise new transactions to see the breakdown." />
                    ) : (
                        <ul className={styles.catList}>
                            {categoryStats.map(cat => (
                                <li key={cat.name} className={cx(styles.cat, selectedCategoryFilter === cat.name && styles.catActive)}>
                                    <div className={styles.catHead}>
                                        {editingCategory === cat.name ? (
                                            <span className={styles.inline}>
                                                <TextField
                                                    size="sm"
                                                    aria-label="Category name"
                                                    value={editCategoryName}
                                                    onChange={(e) => setEditCategoryName(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') handleUpdateCategory(cat.name);
                                                        if (e.key === 'Escape') setEditingCategory(null);
                                                    }}
                                                    autoFocus
                                                />
                                                <Button size="sm" variant="primary" onClick={() => handleUpdateCategory(cat.name)}>Save</Button>
                                                <Button size="sm" variant="ghost" onClick={() => setEditingCategory(null)}>Cancel</Button>
                                            </span>
                                        ) : (
                                            <span className={styles.inline}>
                                                <button
                                                    type="button"
                                                    className={styles.catName}
                                                    aria-pressed={selectedCategoryFilter === cat.name}
                                                    onClick={() => setSelectedCategoryFilter(selectedCategoryFilter === cat.name ? null : cat.name)}
                                                >
                                                    {cat.name}
                                                </button>
                                                <span className={styles.catCount}>{`${cat.count} txs`}</span>
                                                <Button size="sm" variant="ghost" onClick={() => { setEditingCategory(cat.name); setEditCategoryName(cat.name); }}>Rename</Button>
                                                <Button size="sm" variant="ghost" iconOnly icon="trash-2" tooltip="Delete category" onClick={() => setConfirmDeleteCategory(cat.name)}>
                                                    {`Delete ${cat.name}`}
                                                </Button>
                                            </span>
                                        )}
                                        <span className={styles.catAmounts}>
                                            {cat.incoming > 0 && <span className={styles.in}>{formatINR(cat.incoming, { signed: true })}</span>}
                                            <span className={styles.out}>{formatINR(-cat.outgoing)}</span>
                                        </span>
                                    </div>
                                    <div className={styles.catBar} aria-hidden="true">
                                        <span style={{ width: `${stats.outgoing > 0 ? (cat.outgoing / stats.outgoing) * 100 : 0}%` }} />
                                    </div>
                                    <div className={styles.catTags}>
                                        {cat.tags?.map(tag => <Badge key={tag} size="sm" dot={false}>{tag}</Badge>)}
                                        {isAddingTag === cat.name ? (
                                            <span className={styles.inline}>
                                                <TextField
                                                    size="sm"
                                                    aria-label={`New tag for ${cat.name}`}
                                                    placeholder="Tag name…"
                                                    value={newTagName}
                                                    onChange={e => setNewTagName(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') addCategoryTag(cat);
                                                        if (e.key === 'Escape') setIsAddingTag(null);
                                                    }}
                                                    autoFocus
                                                />
                                                <Button size="sm" onClick={() => addCategoryTag(cat)}>Add</Button>
                                            </span>
                                        ) : (
                                            <Button size="sm" variant="ghost" icon="plus" onClick={() => setIsAddingTag(cat.name)}>Tag</Button>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </Card>
            </div>

            {transactions.length > 0 && (
                <Card
                    title="New transactions"
                    eyebrow={`${selectedCount} of ${transactions.length} selected`}
                    padding="sm"
                    actions={
                        <>
                            {ignoredCount > 0 && (
                                <Tooltip content="These transactions are already categorised">
                                    <Badge size="sm">{`${ignoredCount} duplicates hidden`}</Badge>
                                </Tooltip>
                            )}
                            <Button size="sm" variant="primary" icon="tag" disabled={selectedCount === 0} onClick={() => setShowCategoryMenu(true)}>
                                Categorise selection
                            </Button>
                        </>
                    }
                >
                    <div className="pbx-table">
                        <div className="pbx-table__scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th className="pbx-table__check">
                                            <Checkbox
                                                aria-label="Select all new transactions"
                                                checked={transactions.length > 0 && transactions.every(t => t.isSelected)}
                                                indeterminate={selectedCount > 0 && selectedCount < transactions.length}
                                                onChange={() => toggleSelectAll(false)}
                                            />
                                        </th>
                                        <th scope="col">Date</th>
                                        <th scope="col">Narration</th>
                                        <th scope="col" className={styles.right}>Withdrawal</th>
                                        <th scope="col" className={styles.right}>Deposit</th>
                                        <th scope="col" className={styles.right}>Balance</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.map((tx) => (
                                        <tr key={tx.id} className={tx.isSelected ? 'is-selected' : undefined}>
                                            <td className="pbx-table__check">
                                                <Checkbox aria-label={`Select ${tx.date} ${tx.narration}`} checked={tx.isSelected} onChange={() => toggleSelect(tx.id, false)} />
                                            </td>
                                            <td className={styles.date}>{tx.date}</td>
                                            <td className={styles.narrationCell}>{narrationCell(tx.narration)}</td>
                                            <td className={cx('pbx-num', styles.right, styles.out)}>{tx.withdrawal > 0 ? money(tx.withdrawal) : '—'}</td>
                                            <td className={cx('pbx-num', styles.right, styles.in)}>{tx.deposit > 0 ? money(tx.deposit) : '—'}</td>
                                            <td className={cx('pbx-num', styles.right)}>{money(tx.balance)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </Card>
            )}

            {categorizedTransactions.length > 0 && (
                <Card
                    title={`Categorised · ${monthFilter}${selectedCategoryFilter ? ` · ${selectedCategoryFilter}` : ''}`}
                    eyebrow={`${filteredCategorized.length} records`}
                    padding="sm"
                    actions={
                        <>
                            {selectedCategoryFilter && selectedCategorized.length > 0 && (
                                <Button size="sm" variant="primary" icon="tag" onClick={() => setShowTagMenu(true)}>Tag selection</Button>
                            )}
                            {selectedCategoryFilter && (
                                <Button size="sm" variant="ghost" icon="x" onClick={() => setSelectedCategoryFilter(null)}>All categories</Button>
                            )}
                            <Switch label="Untagged only" checked={showUntaggedOnly} onChange={(e) => setShowUntaggedOnly(e.target.checked)} />
                        </>
                    }
                >
                    {filteredCategorized.length === 0 ? (
                        <EmptyState size="sm" icon="search" title={`Nothing categorised for ${monthFilter}`} description="Try another period or clear the filters." />
                    ) : (
                        <div className="pbx-table">
                            <div className="pbx-table__scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th className="pbx-table__check">
                                                <Checkbox
                                                    aria-label="Select all categorised transactions"
                                                    checked={filteredCategorized.every(t => t.isSelected)}
                                                    indeterminate={selectedCategorized.length > 0 && selectedCategorized.length < filteredCategorized.length}
                                                    onChange={() => toggleSelectAll(true)}
                                                />
                                            </th>
                                            <th scope="col">Date</th>
                                            <th scope="col">Category and tags</th>
                                            <th scope="col">Narration</th>
                                            <th scope="col" className={styles.right}>Withdrawal</th>
                                            <th scope="col" className={styles.right}>Deposit</th>
                                            <th scope="col"><span className="pbx-sr">Actions</span></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredCategorized.map((tx) => (
                                            <tr key={tx.id} className={tx.isSelected ? 'is-selected' : undefined}>
                                                <td className="pbx-table__check">
                                                    <Checkbox aria-label={`Select ${tx.date} ${tx.narration}`} checked={tx.isSelected || false} onChange={() => toggleSelect(tx.id, true)} />
                                                </td>
                                                <td className={styles.date}>{tx.date}</td>
                                                <td>
                                                    <span className={styles.badges}>
                                                        <Badge size="sm" tone="brand" dot={false}>{tx.category}</Badge>
                                                        {tx.tags?.map(tag => <Badge key={tag} size="sm" dot={false}>{tag}</Badge>)}
                                                    </span>
                                                </td>
                                                <td className={styles.narrationCell}>{narrationCell(tx.narration)}</td>
                                                <td className={cx('pbx-num', styles.right, styles.out)}>{tx.withdrawal > 0 ? money(tx.withdrawal) : '—'}</td>
                                                <td className={cx('pbx-num', styles.right, styles.in)}>{tx.deposit > 0 ? money(tx.deposit) : '—'}</td>
                                                <td>
                                                    <div className={styles.actions}>
                                                        <Menu
                                                            label={`Move ${tx.narration}`}
                                                            trigger={<Button size="sm" variant="ghost" iconOnly icon="layers" tooltip="Move to another category">Move to another category</Button>}
                                                            items={categories.map((cat) => ({
                                                                label: cat.name,
                                                                icon: tx.category === cat.name ? ('check' as const) : undefined,
                                                                disabled: tx.category === cat.name,
                                                                onSelect: () => handleMoveTransaction(tx.id, cat.name),
                                                            }))}
                                                        />
                                                        <Button size="sm" variant="ghost" iconOnly icon="x" tooltip="Remove from categorised" onClick={() => removeCategorized(tx.id)}>
                                                            Remove from categorised
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </Card>
            )}

            <Dialog
                open={showCategoryMenu}
                onClose={() => setShowCategoryMenu(false)}
                title={`Categorise ${selectedCount} ${selectedCount === 1 ? 'transaction' : 'transactions'}`}
                description="Pick a category, or create one."
            >
                <div className={styles.picker}>
                    {categories.map((cat) => (
                        <span key={cat.name} className={styles.pick}>
                            <Button size="sm" onClick={() => handleCategorize(cat.name)}>{cat.name}</Button>
                            <Button size="sm" variant="ghost" iconOnly icon="trash-2" tooltip="Delete category" onClick={() => setConfirmDeleteCategory(cat.name)}>
                                {`Delete ${cat.name}`}
                            </Button>
                        </span>
                    ))}
                    {categories.length === 0 && <span className={styles.muted}>No categories yet.</span>}
                </div>
                <form className={styles.inlineForm} onSubmit={handleAddCategory}>
                    <TextField label="New category" placeholder="e.g. Packaging" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
                    <Button type="submit" icon="plus" disabled={!newCategoryName.trim()}>Create</Button>
                </form>
            </Dialog>

            <Dialog
                open={showTagMenu && !!tagCategory}
                onClose={() => setShowTagMenu(false)}
                title={`Tag ${selectedCategorized.length} ${selectedCategorized.length === 1 ? 'transaction' : 'transactions'}`}
                description={tagCategory ? `Tags of ${tagCategory.name}` : undefined}
            >
                <div className={styles.picker}>
                    {tagCategory?.tags.map(tag => (
                        <Button key={tag} size="sm" onClick={() => handleTagTransactions([tag])}>{tag}</Button>
                    ))}
                    {tagCategory && tagCategory.tags.length === 0 && <span className={styles.muted}>No tags yet.</span>}
                </div>
                <form
                    className={styles.inlineForm}
                    onSubmit={(e) => {
                        e.preventDefault();
                        const tag = newTagName.trim();
                        if (!tagCategory || !tag) return;
                        handleUpdateCategoryTags(tagCategory.name, [...tagCategory.tags, tag]);
                        handleTagTransactions([tag]);
                        setNewTagName('');
                    }}
                >
                    <TextField label="New tag" placeholder="Tag name…" value={newTagName} onChange={e => setNewTagName(e.target.value)} />
                    <Button type="submit" icon="plus" disabled={!newTagName.trim()}>Add and apply</Button>
                </form>
            </Dialog>

            <Dialog
                open={showConfig}
                onClose={() => setShowConfig(false)}
                size="lg"
                title="Narration rules"
                description="Map long transaction keywords, like UPI IDs, to short nicknames. Hover a nickname in the tables to see the original narration."
            >
                <div className={styles.ruleForm}>
                    <TextField label="Keyword" placeholder="e.g. UPI/2304…" value={newRuleKeyword} onChange={(e) => setNewRuleKeyword(e.target.value)} />
                    <TextField label="Nickname" placeholder="e.g. Amazon Pay" value={newRuleNickname} onChange={(e) => setNewRuleNickname(e.target.value)} />
                    <Button variant="primary" icon="plus" onClick={handleAddRule} disabled={!newRuleKeyword || !newRuleNickname}>Add rule</Button>
                </div>
                {narrationRules.length === 0 ? (
                    <EmptyState size="sm" icon="file-text" title="No rules yet" description="Add your first rule above." />
                ) : (
                    <div className="pbx-table">
                        <div className="pbx-table__scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th scope="col">Keyword</th>
                                        <th scope="col">Nickname</th>
                                        <th scope="col"><span className="pbx-sr">Actions</span></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {narrationRules.map((rule) => (
                                        <tr key={rule.id}>
                                            <td className="pbx-mono">{rule.keyword}</td>
                                            <td className={styles.strong}>{rule.nickname}</td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <Button size="sm" variant="ghost" iconOnly icon="trash-2" tooltip="Delete rule" onClick={() => handleDeleteRule(rule.id)}>
                                                        {`Delete the rule for ${rule.keyword}`}
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Dialog>

            <Dialog
                open={!!confirmDeleteCategory}
                onClose={() => setConfirmDeleteCategory(null)}
                size="sm"
                tone="negative"
                icon="triangle-alert"
                title={`Delete "${confirmDeleteCategory}"?`}
                description={`Transactions in it move to "deleted_${confirmDeleteCategory}".`}
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setConfirmDeleteCategory(null)}>Cancel</Button>
                        <Button variant="danger" onClick={() => { const name = confirmDeleteCategory; setConfirmDeleteCategory(null); if (name) handleDeleteCategory(name); }}>
                            Delete category
                        </Button>
                    </>
                }
            />
        </>
    );
}
