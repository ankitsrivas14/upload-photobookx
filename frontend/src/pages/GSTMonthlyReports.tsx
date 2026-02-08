import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { ShopifyOrder } from '../services/api';
import styles from './GSTMonthlyReports.module.css';

interface GSTReportData {
  orders: ShopifyOrder[];
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

export function GSTMonthlyReports() {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [reportData, setReportData] = useState<GSTReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  // Initialize with current month and year
  useEffect(() => {
    const now = new Date();
    setSelectedMonth((now.getMonth() + 1).toString().padStart(2, '0'));
    setSelectedYear(now.getFullYear().toString());
  }, []);

  // Load data whenever month or year changes
  useEffect(() => {
    if (selectedMonth && selectedYear) {
      loadReportData();
    }
  }, [selectedMonth, selectedYear]);

  const loadReportData = async () => {
    setIsLoading(true);
    try {
      // Fetch ALL orders (not just printed photos) with a higher limit for GST reporting
      const response = await api.getOrders(250, true); // allOrders = true
      if (response.success && response.orders) {
        console.log('Total orders loaded:', response.orders.length);
        
        // Debug: Check delivery statuses
        const deliveryStatuses = response.orders.map(o => ({
          id: o.id,
          name: o.name,
          deliveryStatus: o.deliveryStatus,
          deliveredAt: o.deliveredAt,
          createdAt: o.createdAt
        }));
        console.log('Order statuses sample:', deliveryStatuses.slice(0, 5));
        
        const filteredOrders = filterOrdersByMonth(response.orders, selectedMonth, selectedYear);
        console.log('Filtered delivered orders:', filteredOrders.length);
        
        const summary = calculateGSTSummary(filteredOrders);
        setReportData({ orders: filteredOrders, summary });
      }
    } catch (error) {
      console.error('Failed to load GST report data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filterOrdersByMonth = (orders: ShopifyOrder[], month: string, year: string): ShopifyOrder[] => {
    // Filter orders that were delivered in the selected month
    return orders.filter(order => {
      // Check if order was delivered - check multiple possible values
      const deliveryStatus = order.deliveryStatus?.toLowerCase() || '';
      
      // Consider an order delivered if:
      // 1. deliveryStatus explicitly says "delivered"
      // 2. OR if delivery status includes "delivered"
      const isDelivered = deliveryStatus === 'delivered' || 
                          deliveryStatus.includes('delivered');
      
      if (!isDelivered) {
        return false; // Only include delivered orders
      }
      
      // Use the actual delivery date if available, otherwise fall back to creation date
      const dateToUse = order.deliveredAt || order.createdAt;
      const orderDate = new Date(dateToUse);
      const orderMonth = (orderDate.getMonth() + 1).toString().padStart(2, '0');
      const orderYear = orderDate.getFullYear().toString();
      return orderMonth === month && orderYear === year;
    });
  };

  const calculateGSTSummary = (orders: ShopifyOrder[]) => {
    let totalTaxableValue = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    let totalIGST = 0;
    let totalGST = 0;
    let totalInvoiceValue = 0;

    orders.forEach(order => {
      const amount = order.totalPrice ? parseFloat(order.totalPrice.toString()) : 0;
      // Assuming 12% GST (6% CGST + 6% SGST for intra-state)
      // For inter-state, it would be 12% IGST
      const taxableValue = amount / 1.12; // Remove GST to get taxable value
      const gstAmount = amount - taxableValue;
      
      // For simplicity, assuming all orders are intra-state (CGST + SGST)
      // In real scenario, you'd check shipping address to determine state
      const cgst = gstAmount / 2;
      const sgst = gstAmount / 2;
      
      totalTaxableValue += taxableValue;
      totalCGST += cgst;
      totalSGST += sgst;
      totalGST += gstAmount;
      totalInvoiceValue += amount;
    });

    return {
      totalOrders: orders.length,
      totalTaxableValue,
      totalCGST,
      totalSGST,
      totalIGST,
      totalGST,
      totalInvoiceValue,
    };
  };

  // Generate month options
  const months = [
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

  // Generate year options (current year and 2 years back)
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 3 }, (_, i) => currentYear - i);

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const getMonthName = (monthValue: string): string => {
    const month = months.find(m => m.value === monthValue);
    return month ? month.label : '';
  };

  const handleCSVUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadMessage(null);

    try {
      const formData = new FormData();
      formData.append('csv', file);

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/delivery-dates/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
        },
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        setUploadMessage(`✅ Successfully processed ${result.stats.processed} delivery dates`);
        // Reload the report data
        loadReportData();
      } else {
        setUploadMessage(`❌ Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadMessage('❌ Failed to upload CSV file');
    } finally {
      setIsUploading(false);
      // Reset file input
      event.target.value = '';
    }
  };

  const downloadCSV = () => {
    if (!reportData || reportData.orders.length === 0) {
      alert('No data to download');
      return;
    }

    // Create CSV content
    const headers = [
      'Sr. No.',
      'Order Number',
      'Order Date',
      'Delivery Date',
      'Order Items',
      'Order Value',
      'Taxable Value',
      'CGST (6%)',
      'SGST (6%)',
      'Total GST'
    ];

    const rows = reportData.orders.map((order, index) => {
      const amount = order.totalPrice ? parseFloat(order.totalPrice.toString()) : 0;
      const taxableValue = amount / 1.12;
      const gstAmount = amount - taxableValue;
      const cgst = gstAmount / 2;
      const sgst = gstAmount / 2;

      const orderItems = order.lineItems?.map(item => 
        `${item.title}${item.quantity > 1 ? ` × ${item.quantity}` : ''}`
      ).join('; ') || 'N/A';

      return [
        index + 1,
        order.name,
        new Date(order.createdAt).toLocaleDateString('en-IN'),
        order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString('en-IN') : 'N/A',
        `"${orderItems}"`, // Quoted to handle commas in product names
        amount.toFixed(2),
        taxableValue.toFixed(2),
        cgst.toFixed(2),
        sgst.toFixed(2),
        gstAmount.toFixed(2)
      ];
    });

    // Add totals row
    rows.push([
      '',
      '',
      '',
      '',
      'Total',
      reportData.summary.totalInvoiceValue.toFixed(2),
      reportData.summary.totalTaxableValue.toFixed(2),
      reportData.summary.totalCGST.toFixed(2),
      reportData.summary.totalSGST.toFixed(2),
      reportData.summary.totalGST.toFixed(2)
    ]);

    // Create CSV string
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const monthName = getMonthName(selectedMonth);
    const filename = `GST_Report_${monthName}_${selectedYear}.csv`;
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={styles['monthly-reports']}>
      <div className={styles['page-header']}>
        <div className={styles['page-title-section']}>
          <h1 className={styles['page-title']}>Monthly GST Reports</h1>
          <p className={styles['page-subtitle']}>
            View GST summary for delivered orders by month
          </p>
        </div>
      </div>

      <div className={styles['report-controls']}>
        <div className={styles['filter-section']}>
          <div className={styles['filter-group']}>
            <label className={styles['filter-label']}>Month</label>
            <select 
              className={styles['filter-select']}
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            >
              {months.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>

          <div className={styles['filter-group']}>
            <label className={styles['filter-label']}>Year</label>
            <select 
              className={styles['filter-select']}
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>

          <div className={styles['filter-group']}>
            <label className={styles['filter-label']}>Upload Delivery Dates</label>
            <label className={styles['upload-btn']}>
              <input
                type="file"
                accept=".csv"
                onChange={handleCSVUpload}
                disabled={isUploading}
                style={{ display: 'none' }}
              />
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {isUploading ? 'Uploading...' : 'Upload CSV'}
            </label>
          </div>
        </div>

        {uploadMessage && (
          <div className={styles['upload-message']}>
            {uploadMessage}
          </div>
        )}
      </div>

      <div className={styles['report-content']}>
        {isLoading ? (
          <div className={styles['loading-state']}>
            <div className={styles['spinner']}></div>
            <p>Loading report data...</p>
          </div>
        ) : reportData && reportData.orders.length > 0 ? (
          <>
            {/* Summary Cards */}
            <div className={styles['summary-section']}>
              <h2 className={styles['section-title']}>
                GST Summary - {getMonthName(selectedMonth)} {selectedYear}
              </h2>
              <div className={styles['summary-cards']}>
                <div className={styles['summary-card']}>
                  <div className={styles['summary-label']}>Total Orders</div>
                  <div className={styles['summary-value']}>{reportData.summary.totalOrders}</div>
                </div>
                <div className={styles['summary-card']}>
                  <div className={styles['summary-label']}>Taxable Value</div>
                  <div className={styles['summary-value']}>{formatCurrency(reportData.summary.totalTaxableValue)}</div>
                </div>
                <div className={styles['summary-card']}>
                  <div className={styles['summary-label']}>CGST (6%)</div>
                  <div className={styles['summary-value']}>{formatCurrency(reportData.summary.totalCGST)}</div>
                </div>
                <div className={styles['summary-card']}>
                  <div className={styles['summary-label']}>SGST (6%)</div>
                  <div className={styles['summary-value']}>{formatCurrency(reportData.summary.totalSGST)}</div>
                </div>
                <div className={styles['summary-card']}>
                  <div className={styles['summary-label']}>Total GST</div>
                  <div className={styles['summary-value']}>{formatCurrency(reportData.summary.totalGST)}</div>
                </div>
                <div className={`${styles['summary-card']} ${styles.highlight}`}>
                  <div className={styles['summary-label']}>Total Invoice Value</div>
                  <div className={styles['summary-value']}>{formatCurrency(reportData.summary.totalInvoiceValue)}</div>
                </div>
              </div>
            </div>

            {/* Orders Table */}
            <div className={styles['table-section']}>
              <div className={styles['section-header-with-action']}>
                <h2 className={styles['section-title']}>Delivered Orders</h2>
                <button className={styles['download-btn']} onClick={downloadCSV}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                  Download CSV
                </button>
              </div>
              <div className={styles['table-container']}>
                <table className={styles['gst-table']}>
                  <thead>
                    <tr>
                      <th>Sr. No.</th>
                      <th>Order Number</th>
                      <th>Order Date</th>
                      <th>Delivery Date</th>
                      <th>Order Items</th>
                      <th className={styles['text-right']}>Order Value</th>
                      <th className={styles['text-right']}>Taxable Value</th>
                      <th className={styles['text-right']}>CGST (6%)</th>
                      <th className={styles['text-right']}>SGST (6%)</th>
                      <th className={styles['text-right']}>Total GST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.orders.map((order, index) => {
                      const amount = order.totalPrice ? parseFloat(order.totalPrice.toString()) : 0;
                      const taxableValue = amount / 1.12;
                      const gstAmount = amount - taxableValue;
                      const cgst = gstAmount / 2;
                      const sgst = gstAmount / 2;

                      // Format order items
                      const orderItems = order.lineItems?.map(item => 
                        `${item.title}${item.quantity > 1 ? ` × ${item.quantity}` : ''}`
                      ).join(', ') || 'N/A';

                      return (
                        <tr key={order.id}>
                          <td>{index + 1}</td>
                          <td className={styles['order-number']}>{order.name}</td>
                          <td>{new Date(order.createdAt).toLocaleDateString('en-IN')}</td>
                          <td>{order.deliveredAt ? new Date(order.deliveredAt).toLocaleDateString('en-IN') : 'N/A'}</td>
                          <td className={styles['items-cell']}>{orderItems}</td>
                          <td className={styles['text-right']}>{formatCurrency(amount)}</td>
                          <td className={styles['text-right']}>{formatCurrency(taxableValue)}</td>
                          <td className={styles['text-right']}>{formatCurrency(cgst)}</td>
                          <td className={styles['text-right']}>{formatCurrency(sgst)}</td>
                          <td className={`${styles['text-right']} ${styles['total-amount']}`}>{formatCurrency(gstAmount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className={styles['footer-label']}>Total</td>
                      <td className={styles['text-right']}>{formatCurrency(reportData.summary.totalInvoiceValue)}</td>
                      <td className={styles['text-right']}>{formatCurrency(reportData.summary.totalTaxableValue)}</td>
                      <td className={styles['text-right']}>{formatCurrency(reportData.summary.totalCGST)}</td>
                      <td className={styles['text-right']}>{formatCurrency(reportData.summary.totalSGST)}</td>
                      <td className={`${styles['text-right']} ${styles['total-amount']}`}>{formatCurrency(reportData.summary.totalGST)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className={styles['empty-state']}>
            <div className={styles['empty-icon']}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <h3 className={styles['empty-title']}>No Delivered Orders Found</h3>
            <p className={styles['empty-text']}>
              There are no delivered orders for {getMonthName(selectedMonth)} {selectedYear}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
