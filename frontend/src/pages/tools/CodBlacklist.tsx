import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Alert, Badge, Button, Card, DataTable, Dialog, EmptyState, SegmentedControl, TextField, type Column, type Tone } from '../../components/ui/pbx';
import { api, errorMessage, type CodBlacklistEntry } from '../../services/api';
import styles from './CodBlacklist.module.css';

type View = 'active' | 'cleared';

const day = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—';

const WHY: Record<CodBlacklistEntry['status'], { label: string; tone: Tone }> = {
    failed: { label: 'Returned', tone: 'negative' },
    attempted: { label: 'Delivery failed', tone: 'caution' },
    manual: { label: 'Added by hand', tone: 'neutral' },
};

/** What took an entry off the list: its own order delivered after all, a later delivery there, or Remove here. */
function clearedBy(e: CodBlacklistEntry): string {
    if (!e.clearedBy) return '—';
    if (e.clearedBy === e.order) return 'Delivered after all';
    if (e.clearedBy.startsWith('hand:')) return `Removed: ${e.clearedBy.slice(5).trim()}`;
    return `${e.clearedBy} was delivered there`;
}

const searchText = (e: CodBlacklistEntry) => [e.order, e.pincode, e.city, e.state, ...e.address, e.manual?.note].join(' ').toLowerCase();

/**
 * Tools › COD blacklist: the addresses where an order was returned, lost or had a failed delivery attempt, plus
 * orders added here by hand. The 2-hourly booking job sets aside a COD order whose address matches an active one,
 * because buyers whose COD order failed come back under another name, email and phone.
 */
export function CodBlacklist() {
    const [entries, setEntries] = useState<CodBlacklistEntry[] | null>(null);
    const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<View>('active');
    const [query, setQuery] = useState('');
    const [order, setOrder] = useState('');
    const [address, setAddress] = useState('');
    const [pincode, setPincode] = useState('');
    const [note, setNote] = useState('');
    const [adding, setAdding] = useState(false);
    const [removing, setRemoving] = useState<CodBlacklistEntry | null>(null);
    const [removeNote, setRemoveNote] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await api.getCodBlacklist();
            setEntries(res.entries ?? []);
            setRefreshedAt(res.refreshedAt ?? null);
            setError(null);
        } catch (err) {
            setError(errorMessage(err, 'The COD blacklist could not be loaded'));
            setEntries((e) => e ?? []);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // An order alone takes its address from Shiprocket; a typed address needs its pincode, and the order is optional.
    const typed = address.trim() !== '';
    const pincodeOk = /^\d{6}$/.test(pincode.trim());
    const canAdd = (order.trim() !== '' || typed) && (!typed || pincodeOk);

    const add = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canAdd) return;
        setAdding(true);
        try {
            const res = await api.addToCodBlacklist({
                order: order.trim() || undefined,
                address: typed ? address.trim() : undefined,
                pincode: typed ? pincode.trim() : undefined,
                note: note.trim() || undefined,
            });
            const id = res.entry?.order ?? order.trim().toUpperCase();
            toast.success(id.startsWith('ADDR-') ? 'The address is on the blacklist' : `${id} is on the blacklist`);
            setOrder('');
            setAddress('');
            setPincode('');
            setNote('');
            setView('active');
            await load();
        } catch (err) {
            toast.error(errorMessage(err, 'The order could not be added'));
        } finally {
            setAdding(false);
        }
    };

    const remove = async () => {
        if (!removing) return;
        setBusy(true);
        try {
            await api.removeFromCodBlacklist(removing.order, removeNote.trim() || undefined);
            toast.success(`${removing.order} is off the blacklist`);
            setRemoving(null);
            setRemoveNote('');
            await load();
        } catch (err) {
            toast.error(errorMessage(err, 'The address could not be removed'));
        } finally {
            setBusy(false);
        }
    };

    const active = (entries ?? []).filter((e) => !e.clearedAt);
    const cleared = (entries ?? []).filter((e) => e.clearedAt);
    const q = query.trim().toLowerCase();
    const rows = (view === 'active' ? active : cleared).filter((e) => !q || searchText(e).includes(q));

    const columns: Column<CodBlacklistEntry>[] = [
        {
            key: 'order',
            header: 'Order',
            width: 112,
            render: (e) => (
                <span className={styles.stack}>
                    {e.order.startsWith('ADDR-') ? <span className={styles.muted}>No order</span> : <span className="pbx-mono">{e.order}</span>}
                    <span className={styles.muted}>{e.manual?.typed ? 'Typed address' : e.payment ?? '—'}</span>
                </span>
            ),
        },
        {
            key: 'why',
            header: 'Why',
            width: 180,
            render: (e) => (
                <span className={styles.stack}>
                    <Badge tone={WHY[e.status].tone} size="sm">{WHY[e.status].label}</Badge>
                    <span className={styles.muted}>{e.status === 'manual' ? e.manual?.note || 'No note' : e.srStatus ?? '—'}</span>
                </span>
            ),
        },
        {
            key: 'address',
            header: 'Address',
            render: (e) => (
                <span className={styles.stack}>
                    <span>{e.address.join(', ') || '—'}</span>
                    <span className={styles.muted}>
                        {[e.city, e.state].filter(Boolean).join(', ')} <span className="pbx-mono">{e.pincode}</span>
                    </span>
                </span>
            ),
        },
        { key: 'placed', header: 'Ordered', width: 112, render: (e) => day(e.placedAt) },
        view === 'active'
            ? {
                key: 'listed',
                header: 'Listed',
                width: 112,
                render: (e) => day(e.status === 'manual' ? e.manual?.at ?? e.knownAt : e.knownAt),
            }
            : {
                key: 'cleared',
                header: 'Taken off',
                width: 200,
                render: (e) => (
                    <span className={styles.stack}>
                        <span>{day(e.clearedAt)}</span>
                        <span className={styles.muted}>{clearedBy(e)}</span>
                    </span>
                ),
            },
    ];
    if (view === 'active') {
        columns.push({
            key: 'remove',
            header: '',
            align: 'right',
            width: 96,
            render: (e) => (
                <Button size="sm" variant="ghost" icon="x" onClick={() => setRemoving(e)}>
                    Remove
                </Button>
            ),
        });
    }

    return (
        <div className={styles.page}>
            {error && (
                <Alert tone="negative" title="COD blacklist unavailable">
                    {error}
                </Alert>
            )}

            <Card
                title="Add an address"
                description="Enter an order number to blacklist its delivery address from Shiprocket, or type the address with its pincode (the order number is then optional). The booking job sets aside COD orders to that address until you remove it here; deliveries don't take off an address added by hand."
            >
                <form className={styles.addForm} onSubmit={add}>
                    <TextField
                        className={styles.orderField}
                        label="Order"
                        placeholder="PB1234S"
                        hint={typed ? 'Optional with a typed address' : 'Its address comes from Shiprocket'}
                        value={order}
                        onChange={(e) => setOrder(e.target.value)}
                        disabled={adding}
                    />
                    <TextField
                        className={styles.noteField}
                        label="Note"
                        placeholder="Optional: why it is on the list"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={adding}
                    />
                    <TextField
                        className={styles.addressField}
                        multiline
                        rows={2}
                        label="Address"
                        placeholder="Optional: house, street, area, landmark"
                        hint="Typed, it is used instead of the order's address in Shiprocket."
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        disabled={adding}
                    />
                    <TextField
                        className={styles.pincodeField}
                        label="Pincode"
                        placeholder="110001"
                        inputMode="numeric"
                        maxLength={6}
                        hint={typed ? undefined : 'With a typed address'}
                        error={typed && pincode.trim() && !pincodeOk ? 'Six digits' : undefined}
                        value={pincode}
                        onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
                        disabled={adding}
                    />
                    <div className={styles.addActions}>
                        <Button type="submit" variant="primary" icon="plus" loading={adding} disabled={!canAdd}>
                            Add to blacklist
                        </Button>
                    </div>
                </form>
            </Card>

            <Card
                title="Blacklisted addresses"
                description={`COD orders to an active address are set aside, not booked. Returned and failed orders come from Shiprocket, refreshed every 6 hours (last ${when(refreshedAt)} IST); one comes off when its order, or a later order to the same address, is delivered.`}
                padding="none"
            >
                <div className={styles.toolbar}>
                    <SegmentedControl
                        label="Show"
                        size="sm"
                        value={view}
                        onChange={(v) => setView(v as View)}
                        options={[
                            { value: 'active', label: `Active ${active.length.toLocaleString('en-IN')}` },
                            { value: 'cleared', label: `Taken off ${cleared.length.toLocaleString('en-IN')}` },
                        ]}
                    />
                    <TextField
                        type="search"
                        size="sm"
                        icon="search"
                        aria-label="Search the blacklist"
                        placeholder="Order, pincode, city or address"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className={styles.search}
                    />
                </div>
                <DataTable
                    columns={columns}
                    rows={rows}
                    getRowId={(e) => e.order}
                    loading={entries === null}
                    maxHeight={640}
                    caption={view === 'active' ? 'Active blacklisted addresses, latest first' : 'Addresses taken off the blacklist'}
                    empty={
                        <EmptyState
                            size="sm"
                            icon="user-x"
                            title={q ? 'Nothing matches' : view === 'active' ? 'No blacklisted addresses' : 'Nothing taken off yet'}
                            description={q ? 'Try an order number, a pincode or a word from the address.' : undefined}
                        />
                    }
                />
            </Card>

            <Dialog
                open={removing !== null}
                onClose={busy ? undefined : () => setRemoving(null)}
                title={`Remove ${removing?.order ?? ''} from the blacklist?`}
                description="COD orders to this address will be booked again."
                icon="user-x"
                tone="caution"
                size="sm"
                footer={
                    <>
                        <Button variant="secondary" onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button>
                        <Button variant="danger" onClick={remove} loading={busy}>Remove</Button>
                    </>
                }
            >
                <TextField label="Why" placeholder="Optional" value={removeNote} onChange={(e) => setRemoveNote(e.target.value)} />
            </Dialog>
        </div>
    );
}
