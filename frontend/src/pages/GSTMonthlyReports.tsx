import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { Amount, Button, Card, DataTable, EmptyState, Select, StatCard, StatStrip, type Column } from '../components/ui/pbx';
import { formatINR } from '../components/ui/format';
import styles from './GSTMonthlyReports.module.css';

interface GSTOrder {
  id: number | string;
  name: string;
  createdAt: string;
  deliveredAt: string | null;
  customerState: string | null;
  totalPrice: number;
  lineItems: Array<{ title: string; quantity: number }>;
}

interface GSTReportData {
  orders: GSTOrder[];
  summary: {
    totalOrders: number;
    totalTaxableValue: number;
    totalCGST: number;
    totalSGST: number;
    totalIGST: number;
    totalGST: number;
    totalInvoiceValue: number;
  };
}

interface GSTRow extends GSTOrder {
  sr: number;
  amount: number;
  taxable: number;
  gst: number;
  cgst: number;
  sgst: number;
}

const MONTHS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' },
];

// The current year and the two before it.
const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 3 }, (_, i) => String(THIS_YEAR - i)).map((y) => ({ value: y, label: y }));

const money = (amount: number) => formatINR(amount, { decimals: 2 });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const itemsText = (order: GSTOrder, separator: string) =>
  order.lineItems?.map((item) => `${item.title}${item.quantity > 1 ? ` × ${item.quantity}` : ''}`).join(separator) || 'N/A';

// Order values include 12% GST, split evenly into CGST and SGST.
function withGST(order: GSTOrder, index: number): GSTRow {
  const amount = order.totalPrice ? parseFloat(order.totalPrice.toString()) : 0;
  const taxable = amount / 1.12;
  const gst = amount - taxable;
  return { ...order, sr: index + 1, amount, taxable, gst, cgst: gst / 2, sgst: gst / 2 };
}

const COLUMNS: Column<GSTRow>[] = [
  { key: 'sr', header: '#', numeric: true, width: 36 },
  { key: 'name', header: 'Order', mono: true },
  { key: 'createdAt', header: 'Ordered', render: (r) => <span className={styles.nowrap}>{shortDate(r.createdAt)}</span> },
  { key: 'deliveredAt', header: 'Delivered', render: (r) => <span className={styles.nowrap}>{r.deliveredAt ? shortDate(r.deliveredAt) : '—'}</span> },
  { key: 'customerState', header: 'State', render: (r) => <span className={styles.nowrap}>{r.customerState || '—'}</span> },
  { key: 'items', header: 'Items', render: (r) => <span className={styles.items}>{itemsText(r, ', ')}</span> },
  { key: 'amount', header: 'Order value', numeric: true, render: (r) => <Amount value={r.amount} decimals={2} /> },
  { key: 'taxable', header: 'Taxable value', numeric: true, render: (r) => <Amount value={r.taxable} decimals={2} /> },
  { key: 'cgst', header: 'CGST 6%', numeric: true, render: (r) => <Amount value={r.cgst} decimals={2} /> },
  { key: 'sgst', header: 'SGST 6%', numeric: true, render: (r) => <Amount value={r.sgst} decimals={2} /> },
  { key: 'gst', header: 'Total GST', numeric: true, render: (r) => <Amount className={styles.strong} value={r.gst} decimals={2} /> },
];

/** GST reports: the GST on orders delivered in a month, with the delivery-date upload and a CSV export. */
export function GSTMonthlyReports() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [reportData, setReportData] = useState<GSTReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const monthName = MONTHS.find((m) => m.value === selectedMonth)?.label ?? '';
  const period = `${monthName} ${selectedYear}`;

  const loadReportData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Filtering + GST aggregation happen server-side now; we only receive the
      // delivered-in-month orders (slimmed) and the totals.
      const response = await api.getGSTSummary(selectedMonth, selectedYear);
      if (response.success) {
        setReportData({ orders: response.orders, summary: response.summary });
      }
    } catch (error) {
      console.error('Failed to load GST report data:', error);
      toast.error('Could not load the GST report. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedMonth, selectedYear]);

  // Load data whenever month or year changes
  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  const rows = useMemo(() => (reportData?.orders ?? []).map(withGST), [reportData]);
  const summary = reportData?.summary;

  const handleCSVUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('csv', file);

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/delivery-dates/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        toast.success(`Processed ${result.stats.processed} delivery dates`);
        // Reload the report data (this upload bypasses the API client, so clear its cache)
        api.invalidateCache();
        loadReportData();
      } else {
        toast.error(`Upload failed: ${result.error}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Could not upload the CSV file');
    } finally {
      setIsUploading(false);
      // Reset file input
      event.target.value = '';
    }
  };

  const downloadCSV = () => {
    if (!summary || rows.length === 0) return;

    const headers = [
      'Sr. No.',
      'Order Number',
      'Order Date',
      'Delivery Date',
      'Address State',
      'Order Items',
      'Order Value',
      'Taxable Value',
      'CGST (6%)',
      'SGST (6%)',
      'Total GST',
    ];

    const lines = rows.map((r) => [
      r.sr,
      r.name,
      new Date(r.createdAt).toLocaleDateString('en-IN'),
      r.deliveredAt ? new Date(r.deliveredAt).toLocaleDateString('en-IN') : 'N/A',
      r.customerState ? `"${r.customerState}"` : 'N/A',
      `"${itemsText(r, '; ')}"`, // Quoted to handle commas in product names
      r.amount.toFixed(2),
      r.taxable.toFixed(2),
      r.cgst.toFixed(2),
      r.sgst.toFixed(2),
      r.gst.toFixed(2),
    ]);

    // Add totals row
    lines.push([
      '',
      '',
      '',
      '',
      '',
      'Total',
      summary.totalInvoiceValue.toFixed(2),
      summary.totalTaxableValue.toFixed(2),
      summary.totalCGST.toFixed(2),
      summary.totalSGST.toFixed(2),
      summary.totalGST.toFixed(2),
    ]);

    const csvContent = [headers.join(','), ...lines.map((line) => line.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `GST_Report_${monthName}_${selectedYear}.csv`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={styles.report}>
      <div className={styles.toolbar}>
        <Select label="Month" inlineLabel size="sm" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} options={MONTHS} />
        <Select label="Year" inlineLabel size="sm" value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} options={YEARS} />
        <div className={styles.toolbarEnd}>
          <Button size="sm" icon="upload" loading={isUploading} onClick={() => fileInput.current?.click()}>
            {isUploading ? 'Uploading…' : 'Upload delivery dates'}
          </Button>
          <input ref={fileInput} type="file" accept=".csv" hidden onChange={handleCSVUpload} />
        </div>
      </div>

      <StatStrip label={`GST for ${period}`} minWidth={150}>
        <StatCard label="Delivered orders" loading={isLoading} value={(summary?.totalOrders ?? 0).toLocaleString('en-IN')} />
        <StatCard label="Taxable value" loading={isLoading} value={money(summary?.totalTaxableValue ?? 0)} />
        <StatCard label="CGST 6%" loading={isLoading} value={money(summary?.totalCGST ?? 0)} />
        <StatCard label="SGST 6%" loading={isLoading} value={money(summary?.totalSGST ?? 0)} />
        <StatCard label="Total GST" loading={isLoading} value={money(summary?.totalGST ?? 0)} />
        <StatCard label="Invoice value" loading={isLoading} value={money(summary?.totalInvoiceValue ?? 0)} />
      </StatStrip>

      <Card
        title="Delivered orders"
        eyebrow={period}
        description="Order values include 12% GST, split evenly into CGST and SGST."
        padding="none"
        actions={
          <Button size="sm" variant="primary" icon="download" onClick={downloadCSV} disabled={isLoading || rows.length === 0}>
            Download CSV
          </Button>
        }
      >
        <DataTable
          columns={COLUMNS}
          rows={rows}
          getRowId={(r) => String(r.id)}
          loading={isLoading}
          caption={`Orders delivered in ${period}`}
          empty={<EmptyState size="sm" icon="receipt" title="No delivered orders" description={`Nothing was delivered in ${period}.`} />}
          footer={
            rows.length > 0 && summary ? (
              <>
                <span>{rows.length.toLocaleString('en-IN')} orders</span>
                <span>
                  Total GST <Amount value={summary.totalGST} decimals={2} /> on <Amount value={summary.totalInvoiceValue} decimals={2} />
                </span>
              </>
            ) : undefined
          }
        />
      </Card>
    </div>
  );
}
