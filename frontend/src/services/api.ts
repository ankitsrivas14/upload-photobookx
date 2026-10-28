import { QueryClient } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

/**
 * Client cache for admin GET requests (TanStack Query, used through `request`): identical
 * requests in flight share one fetch, and a successful response is reused for
 * CACHE_FRESH_MS, so switching pages or remounting a widget doesn't refetch. Every write
 * clears it, and so do login and logout.
 */
const CACHE_FRESH_MS = 30 * 1000;
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: CACHE_FRESH_MS, gcTime: 5 * 60 * 1000, retry: false } },
});

// Admin Auth Types
interface AdminUser {
  id: string;
  email: string;
  name: string;
}

// COGS Configuration Types
interface COGSField {
  id: string;
  name: string;
  category: 'pre' | 'post';
  // Old structure (deprecated, kept for backwards compatibility)
  smallValue?: number;
  largeValue?: number;
  // New structure with payment method support
  smallPrepaidValue: number;
  smallCODValue: number;
  largePrepaidValue: number;
  largeCODValue: number;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
  percentageType: 'included' | 'excluded';
}

interface COGSConfiguration {
  fields: COGSField[];
}

export interface COGSTotalOverrides {
  smallPrepaidValue?: number;
  smallCODValue?: number;
  largePrepaidValue?: number;
  largeCODValue?: number;
}

export interface COGSVersion {
  _id: string;
  fields: COGSField[];
  totalOverrides?: { pre?: COGSTotalOverrides; post?: COGSTotalOverrides };
  effectiveFrom: string;
  createdAt: string;
  updatedAt: string;
}

interface LoginResponse {
  success: boolean;
  token?: string;
  user?: AdminUser;
  error?: string;
}

interface MeResponse {
  success: boolean;
  user?: AdminUser;
  error?: string;
}

// Magic Link Types
interface MagicLinkInfo {
  id: string;
  token: string;
  orderNumber: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  maxUploads: number;
  currentUploads: number;
  expiresAt: string;
  isActive: boolean;
  imagesDeleted: boolean;
  imagesDeletedAt?: string;
  createdAt: string;
  uploadUrl: string;
}

interface MagicLinksResponse {
  success: boolean;
  links?: MagicLinkInfo[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error?: string;
}

interface CreateMagicLinkResponse {
  success: boolean;
  magicLink?: MagicLinkInfo;
  error?: string;
}

// Lightweight order shape for the Backlog Mosaic page
export interface BacklogOrder {
  id: number;
  name: string;
  createdAt: string;
  fulfillmentStatus: string | null;
  deliveryStatus: string | null;
  customerName: string | null;
  lineItems: { title: string; quantity: number; variantTitle: string | null }[];
}

// Claude Code's daily ad set review (Analysis → Claude Analysis)
export interface ClaudeWindow {
  spend: number;
  purchases: number;
  roas: number;
  cpa: number;
}

export interface ClaudeCall {
  adsetId: string;
  adsetName: string;
  campaignName?: string;
  decision: string; // SCALE | DUPLICATE | CONTINUE | MONITOR | CLOSE
  budgetBefore?: number | null;
  budgetAfter?: number | null;
  statusAfter?: string;
  reason: string;
  metrics?: Record<string, ClaudeWindow>; // yesterday, last3, active7, active30
  applied?: { at: string; confirmed: boolean; change: string } | null;
}

/** A stocked book's level: its latest shelf count, what has sold since, its pace and days left. */
export interface StockLevel {
  sku: string;
  label: string;
  counted: number;
  countedAt: string;
  /** Books in orders still waiting to ship when counted. */
  committed: number;
  soldSince: number;
  /** Books left to sell: counted − committed − soldSince. */
  available: number;
  /** Books a day: the busiest daily average of the last 3, 7 and 30 days. */
  pace: number;
  daysLeft: number | null;
  /** Down to the alert threshold (alertDays) or out. */
  low: boolean;
}

/** One day of shipping files: the labels and manifest rows of everything booked while it was open. */
export interface ShippingDay {
  id: string;
  openedAt: string | null;
  closedAt: string | null;
  /** Which download closed it. */
  closedBy: 'labels' | 'manifest' | null;
  open: boolean;
  labels: number;
  couriers: Array<{ name: string; count: number }>;
}

/** What the 2-hourly booking job did on its last run. */
export interface ShippingRun {
  at: string;
  booked: number;
  cost: number;
  byCourier: Record<string, number>;
  aside: Array<{ order: string; reason: string }>;
  waiting: Array<{ order: string; rate: number }>;
  failed: Array<{ order: string; reason: string }>;
  wallet: number;
  /** Rupees to add to the Shiprocket wallet before the waiting orders can be booked. */
  recharge: number;
  notes: string[];
}

/** A COD order the job keeps waiting because its address looks too thin or bogus to deliver. */
export interface SetAsideOrder {
  order: string;
  reason: string;
  amount: number | null;
  since: string | null;
}

/** One month of Shiprocket orders (YYYY-MM) and how many failed: returned to us, lost, destroyed or disposed of. */
export interface FailureMonth {
  month: string;
  orders: number;
  delivered: number;
  cancelled: number;
  failed: number;
  /** Neither delivered, failed nor cancelled yet: in transit, or not shipped. */
  open: number;
  /** Returns may still come in: the month is current, or over a tenth of its orders are still open. */
  settling: boolean;
  cod: number;
  prepaid: number;
  /** Order value of the failed orders, in rupees. */
  value: number;
  /** Failed orders per reason group. */
  groups: Record<string, number>;
}

/** A reason group across all months, with the couriers' own wordings in it. */
export interface FailureReasonGroup {
  group: string;
  count: number;
  wordings: Array<{ reason: string; count: number }>;
}

/** Where a freight claim stands; an order without a ticket yet is not_started. */
export type ClaimStatus =
  | 'not_started'
  | 'asked_reason'
  | 'needs_you'
  | 'refund_requested'
  | 'refund_promised'
  | 'refund_received'
  | 'customer_fault';

/** A failed order in the claims pipeline: why it failed, the freight at stake and how far the claim has got. */
export interface FreightClaim {
  order: string;
  placedAt: string | null;
  month: string;
  payment: 'COD' | 'Prepaid';
  value: number;
  courier: string | null;
  awb: string | null;
  shipmentStatus: string;
  group: string;
  reason: string | null;
  attempts: number | null;
  status: ClaimStatus;
  /** Shiprocket ticket ids. */
  tickets: string[];
  lastMessageAt: string | null;
  lastMessageFrom: 'us' | 'shiprocket' | null;
  nextStep: string | null;
  /** Forward and RTO freight, in rupees; null when no Shiprocket charge is on record. */
  freight: { forward: number; rto: number; total: number } | null;
  refund: { promisedAt: string | null; promisedAmount: number | null; receivedAt: string | null; receivedAmount: number | null } | null;
  updatedAt: string | null;
}

/** A claim with its Richpanel thread, notes, and the stage you set by hand, if any. */
export interface FreightClaimDetail extends FreightClaim {
  richpanel: { id: string; number: number | null; url: string | null } | null;
  notes: string | null;
  manual: { status: string; by: string | null; at: string | null; note: string | null } | null;
}

/** One message in a claim's email thread with Shiprocket support. */
export interface ClaimMessage {
  id: string;
  at: string | null;
  from: 'us' | 'shiprocket';
  author: string | null;
  text: string;
  /** Shiprocket's "rate my assistance" emails are surveys, not answers. */
  kind: 'message' | 'survey';
}

/** One failed order with why it failed (the last failed delivery attempt before it came back). */
export interface FailedOrderReason {
  order: string;
  placedAt: string | null;
  payment: 'COD' | 'Prepaid';
  value: number;
  courier: string | null;
  status: string;
  group: string;
  /** The courier's wording; null while tracking couldn't be read. */
  reason: string | null;
  attempts: number | null;
}

/** The whole Meta ad account over one week (from a Monday) or one calendar month. */
export interface MetaCpaPeriod {
  start: string;
  spend: number;
  purchases: number;
  /** Spend per purchase; null when the period has no purchases. */
  cpa: number | null;
}

export interface ClaudeReview {
  date: string;
  dataAsOf?: string;
  summary?: string;
  breakeven?: { metaRoas: number; realisedRoas: number; deliveryRatePct: number; marginPerOrder: number; window?: string };
  account?: { budgetBefore?: number; budgetAfter?: number };
  previousGrading?: Array<{ adsetName: string; decision: string; outcome: string }>;
  calls: ClaudeCall[];
  checks?: string[];
  notes?: string[];
  publishedAt?: string;
}

// Shopify Order Types
interface ShopifyOrder {
  id: number;
  name: string;
  email?: string;
  createdAt: string;
  fulfillmentStatus?: string | null;
  deliveryStatus?: string | null;
  deliveredAt?: string | null;
  trackingUrl?: string | null;
  paymentMethod?: string;
  maxUploads: number;
  totalPrice?: number;
  shippingCharge?: number; // Shipping charge paid to Shiprocket
  shippingFetchedAt?: string | null;
  shippingBreakdown?: {
    freightForward: number;
    freightCOD: number;
    freightRTO: number;
    whatsappCharges: number;
    otherCharges: number;
  } | null;
  pickupDate?: string | null;
  courierName?: string | null;
  deliveredDate?: string | null;
  firstAttemptDate?: string | null;
  cancelledAt?: string | null;
  lineItems?: Array<{
    title: string;
    quantity: number;
    variantTitle?: string;
  }>;
  customerTags?: string | null;
  customerId?: number | null;
  city?: string | null;
  zip?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerState?: string | null;
  awbCode?: string | null;
  hasTicket?: boolean;
}

interface OrdersResponse {
  success: boolean;
  orders?: ShopifyOrder[];
  availableMonths?: string[];
  error?: string;
}

// Upload Types
interface UploadInfo {
  success: boolean;
  orderNumber?: string;
  customerName?: string;
  maxUploads?: number;
  currentUploads?: number;
  remainingUploads?: number;
  expiresAt?: string;
  submittedForPrinting?: boolean;
  submittedAt?: string;
  imagesDeleted?: boolean;
  imagesDeletedAt?: string;
  photoSize?: 'large' | 'small';
  photoType?: 'normal' | 'polaroid';
  error?: string;
}

class ApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  private getToken(): string | null {
    return localStorage.getItem('adminToken');
  }

  setToken(token: string): void {
    localStorage.setItem('adminToken', token);
    this.invalidateCache();
  }

  removeToken(): void {
    localStorage.removeItem('adminToken');
    this.invalidateCache();
  }

  /** Drop every cached response. Writes through `request` do this themselves; call it after
   *  a write that bypasses `request`, or before a Refresh that must hit the server. */
  invalidateCache(): void {
    queryClient.clear();
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && endpoint.startsWith('/api/admin/')) {
      const queryKey = ['api', endpoint];
      const data = await queryClient.fetchQuery({
        queryKey,
        queryFn: () => this.send<T>(endpoint, options),
        staleTime: CACHE_FRESH_MS,
      });
      // Keep only successes; a failed response is fetched again next time.
      if ((data as { success?: boolean } | null)?.success === false) {
        queryClient.removeQueries({ queryKey, exact: true });
      }
      return data;
    }
    const data = await this.send<T>(endpoint, options);
    if (method !== 'GET') this.invalidateCache();
    return data;
  }

  private async send<T>(endpoint: string, options: RequestInit): Promise<T> {
    const token = this.getToken();

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    return response.json();
  }

  // Admin Auth
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (response.success && response.token) {
      this.setToken(response.token);
    }

    return response;
  }

  async register(email: string, password: string, name: string): Promise<LoginResponse> {
    const response = await this.request<LoginResponse>('/api/admin/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    });

    if (response.success && response.token) {
      this.setToken(response.token);
    }

    return response;
  }

  async getMe(): Promise<MeResponse> {
    return this.request<MeResponse>('/api/admin/auth/me');
  }

  logout(): void {
    this.removeToken();
  }

  // Magic Links
  async getMagicLinks(page = 1, limit = 20): Promise<MagicLinksResponse> {
    return this.request<MagicLinksResponse>(`/api/admin/magic-links?page=${page}&limit=${limit}`);
  }

  async createMagicLink(data: {
    orderNumber: string;
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    expiresInDays?: number;
  }): Promise<CreateMagicLinkResponse> {
    return this.request<CreateMagicLinkResponse>('/api/admin/magic-links', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deactivateMagicLink(token: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/magic-links/${token}`, {
      method: 'DELETE',
    });
  }

  async downloadOrderImages(token: string): Promise<void> {
    const authToken = this.getToken();
    const response = await fetch(`${this.baseUrl}/api/admin/magic-links/${token}/download-images`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to download images');
    }

    // Get filename from Content-Disposition header
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = 'order_images.zip'; // fallback

    if (contentDisposition) {
      // Try to extract filename from Content-Disposition header
      // Handles: filename="file.zip" or filename=file.zip
      const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1].replace(/['"]/g, '');
      }
    }

    // Get the blob
    const blob = await response.blob();

    // Create download link
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  async deleteOrderImages(token: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request(`/api/admin/magic-links/${token}/delete-images`, {
      method: 'DELETE',
    });
  }

  // Shopify Orders
  // `exclude: 'terminal'` asks the server to leave out finished orders (cancelled, delivered,
  // failed, RTO), for views that only need open shipments.
  async getOrders(limit = 50, allOrders = false, createdAtMin?: string, month?: string, exclude?: 'terminal'): Promise<OrdersResponse> {
    const allParam = allOrders ? '&all=true' : '';
    const dateParam = createdAtMin ? `&created_at_min=${encodeURIComponent(createdAtMin)}` : '';
    const monthParam = month ? `&month=${encodeURIComponent(month)}` : '';
    const excludeParam = exclude ? `&exclude=${exclude}` : '';
    return this.request<OrdersResponse>(`/api/admin/magic-links/shopify/orders?limit=${limit}${allParam}${dateParam}${monthParam}${excludeParam}`);
  }

  async getGSTSummary(month: string, year: string): Promise<{
    success: boolean;
    orders: Array<{
      id: number | string;
      name: string;
      createdAt: string;
      deliveredAt: string | null;
      customerState: string | null;
      totalPrice: number;
      lineItems: Array<{ title: string; quantity: number }>;
    }>;
    summary: {
      totalOrders: number;
      totalTaxableValue: number;
      totalCGST: number;
      totalSGST: number;
      totalIGST: number;
      totalGST: number;
      totalInvoiceValue: number;
    };
    error?: string;
  }> {
    return this.request(`/api/admin/magic-links/shopify/gst-summary?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}`);
  }

  async getBacklogOrders(): Promise<{ success: boolean; orders?: BacklogOrder[]; error?: string }> {
    return this.request('/api/admin/sales/backlog-orders');
  }

  async getOrder(orderNumber: string): Promise<{ success: boolean; order?: ShopifyOrder; error?: string }> {
    return this.request(`/api/admin/magic-links/shopify/orders/${encodeURIComponent(orderNumber)}`);
  }

  async clearOrdersCache(): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/magic-links/shopify/orders/clear-cache',
      {
        method: 'POST',
      }
    );
  }

  // Fast order sync: pulls recent orders straight from Shopify into Firestore.
  async firestoreSyncOrders(): Promise<{ success: boolean; fetched?: number; written?: number; error?: string }> {
    return this.request('/api/admin/sales/firestore-sync-orders', { method: 'POST' });
  }

  // Shiprocket Shipping Charges
  async fetchShippingCharge(orderNumber: string, refetch: boolean = true): Promise<{ success: boolean; shippingCharge?: number; message?: string; error?: string }> {
    return this.request<{ success: boolean; shippingCharge?: number; message?: string; error?: string }>(
      '/api/admin/magic-links/shiprocket/fetch-shipping-charge',
      {
        method: 'POST',
        body: JSON.stringify({ orderNumber, refetch }),
      }
    );
  }

  async clearShippingChargesCache(): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/magic-links/shiprocket/clear-cache',
      {
        method: 'POST',
      }
    );
  }

  async syncShippingCharges(orderNumbers: string[]): Promise<{ success: boolean; fetched?: number; message?: string; error?: string }> {
    return this.request<{ success: boolean; fetched?: number; message?: string; error?: string }>(
      '/api/admin/magic-links/shiprocket/sync-shipping-charges',
      {
        method: 'POST',
        body: JSON.stringify({ orderNumbers }),
      }
    );
  }

  async updateOrderDeliveryStatus(orderNumber: string, status: 'Delivered' | 'Failed'): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/magic-links/shopify/update-delivery-status',
      {
        method: 'POST',
        body: JSON.stringify({ orderNumber, status }),
      }
    );
  }

  async bulkAddCustomerTags(customerIds: number[], tag: string): Promise<{
    success: boolean;
    summary?: { total: number; successful: number; failed: number };
    error?: string;
  }> {
    return this.request<{
      success: boolean;
      summary?: { total: number; successful: number; failed: number };
      error?: string;
    }>('/api/admin/magic-links/shopify/customers/bulk-tags', {
      method: 'POST',
      body: JSON.stringify({ customerIds, tag }),
    });
  }

  async addCustomerTag(customerId: number, tag: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      `/api/admin/magic-links/shopify/customers/${customerId}/tags`,
      {
        method: 'POST',
        body: JSON.stringify({ tag }),
      }
    );
  }

  async getWalletTransactions(startDate?: string, endDate?: string): Promise<{ success: boolean; transactions?: any[]; count?: number; error?: string }> {
    const params = new URLSearchParams();
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);

    return this.request<{ success: boolean; transactions?: any[]; count?: number; error?: string }>(
      `/api/admin/magic-links/shiprocket/wallet-transactions?${params.toString()}`
    );
  }

  // Sales - Acknowledged Orders
  async getAcknowledgedOrderIds(): Promise<{ success: boolean; acknowledgedOrderIds: number[] }> {
    return this.request<{ success: boolean; acknowledgedOrderIds: number[] }>(
      '/api/admin/sales/acknowledged-orders'
    );
  }

  async acknowledgeOrders(orderIds: number[], orderNames: string[]): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/sales/acknowledge-orders',
      {
        method: 'POST',
        body: JSON.stringify({ orderIds, orderNames }),
      }
    );
  }

  async unacknowledgeOrders(orderIds: number[]): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/sales/acknowledge-orders',
      {
        method: 'DELETE',
        body: JSON.stringify({ orderIds }),
      }
    );
  }
  
  // Sales - Ticket Raised Orders
  async getTicketRaisedOrderIds(): Promise<{ success: boolean; ticketRaisedOrderIds: number[] }> {
    return this.request<{ success: boolean; ticketRaisedOrderIds: number[] }>(
      '/api/admin/sales/ticket-raised-orders'
    );
  }

  async markTicketRaisedOrders(orderIds: number[], orderNames: string[]): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/sales/ticket-raised-orders',
      {
        method: 'POST',
        body: JSON.stringify({ orderIds, orderNames }),
      }
    );
  }

  async unmarkTicketRaisedOrders(orderIds: number[]): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/sales/ticket-raised-orders',
      {
        method: 'DELETE',
        body: JSON.stringify({ orderIds }),
      }
    );
  }

  // Sales - Discarded Orders
  async getDiscardedOrderIds(): Promise<{ success: boolean; discardedOrderIds: number[] }> {
    return this.request<{ success: boolean; discardedOrderIds: number[] }>(
      '/api/admin/sales/discarded-orders'
    );
  }

  async discardOrders(orderIds: number[], orderNames: string[]): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/sales/discard-orders',
      {
        method: 'POST',
        body: JSON.stringify({ orderIds, orderNames }),
      }
    );
  }

  async restoreOrders(orderIds: number[]): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/sales/discard-orders',
      {
        method: 'DELETE',
        body: JSON.stringify({ orderIds }),
      }
    );
  }

  // Sales - RTO Orders
  async getRTOOrderIds(): Promise<{ success: boolean; rtoOrderIds: number[] }> {
    return this.request<{ success: boolean; rtoOrderIds: number[] }>(
      '/api/admin/sales/rto-orders'
    );
  }

  async markOrdersAsRTO(orderIds: number[], orderNames: string[], notes?: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/sales/mark-rto',
      {
        method: 'POST',
        body: JSON.stringify({ orderIds, orderNames, notes }),
      }
    );
  }

  async unmarkOrdersAsRTO(orderIds: number[]): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/sales/mark-rto',
      {
        method: 'DELETE',
        body: JSON.stringify({ orderIds }),
      }
    );
  }

  async getProducts(): Promise<{
    success: boolean; products?: Array<{
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
        sku: string;
        inventoryQuantity: number;
        weight: number;
        weightUnit: string;
      }>;
      image: string | null;
    }>; error?: string
  }> {
    return this.request('/api/admin/magic-links/shopify/products');
  }

  async getProduct(productId: string): Promise<{ success: boolean; product?: unknown; error?: string }> {
    return this.request(`/api/admin/magic-links/shopify/products/${productId}`);
  }

  async bulkUpdateProductPrices(data: {
    productIds: number[];
    variant1Price?: string;
    variant1CompareAtPrice?: string | null;
    variant2Price?: string;
    variant2CompareAtPrice?: string | null;
    priceChangePercent?: string;
    priceChangeAmount?: string;
    updateType: 'set' | 'increase' | 'decrease';
  }): Promise<{
    success: boolean;
    results?: Array<{ productId: number; success: boolean; error?: string }>;
    summary?: { total: number; successful: number; failed: number };
    error?: string;
  }> {
    return this.request('/api/admin/magic-links/shopify/products/bulk-update-prices', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Expenses
  async getExpenseSources(): Promise<{
    success: boolean;
    sources?: Array<{ id: string; name: string; category: string; createdAt: string }>;
    error?: string;
  }> {
    return this.request('/api/admin/expenses/sources');
  }

  async createExpenseSource(name: string): Promise<{
    success: boolean;
    source?: { id: string; name: string; category: string; createdAt: string };
    error?: string;
  }> {
    return this.request('/api/admin/expenses/sources', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async getMetaAdsExpenses(page = 1, limit = 50): Promise<{
    success: boolean;
    expenses?: Array<{
      id: string;
      amount: number;
      date: string;
      sourceId: string;
      sourceName: string;
      notes?: string;
      isTaxExempt?: boolean;
      createdAt: string;
    }>;
    pagination?: { page: number; limit: number; total: number; totalPages: number };
    error?: string;
  }> {
    return this.request(`/api/admin/expenses/meta-ads?page=${page}&limit=${limit}`);
  }

  async createMetaAdsExpense(data: {
    amount: number;
    date: string;
    sourceId: string;
    notes?: string;
    isTaxExempt?: boolean;
  }): Promise<{
    success: boolean;
    expense?: {
      id: string;
      amount: number;
      date: string;
      sourceId: string;
      sourceName: string;
      notes?: string;
      isTaxExempt?: boolean;
      createdAt: string;
    };
    error?: string;
  }> {
    return this.request('/api/admin/expenses/meta-ads', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteMetaAdsExpense(expenseId: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/expenses/meta-ads/${expenseId}`, {
      method: 'DELETE',
    });
  }

  // Daily Ad Spend
  async getDailyAdSpend(): Promise<{
    success: boolean;
    entries?: Array<{
      id: string;
      date: string;
      amount: number;
      dailyAmountSpent?: number | null;
      notes: string;
      createdAt: string;
    }>;
    error?: string;
  }> {
    return this.request('/api/admin/expenses/daily-ad-spend');
  }

  async createDailyAdSpend(data: {
    date: string;
    amount: number;
    notes?: string;
  }): Promise<{
    success: boolean;
    entry?: {
      id: string;
      date: string;
      amount: number;
      dailyAmountSpent?: number | null;
      notes: string;
      createdAt: string;
    };
    error?: string;
  }> {
    return this.request('/api/admin/expenses/daily-ad-spend', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async upsertDailyAdSpend(data: {
    date: string;
    amount: number;
    notes?: string;
  }): Promise<{
    success: boolean;
    entry?: {
      id: string;
      date: string;
      amount: number;
      dailyAmountSpent?: number | null;
      notes: string;
      createdAt: string;
    };
    error?: string;
  }> {
    return this.request('/api/admin/expenses/daily-ad-spend', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteDailyAdSpend(entryId: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/expenses/daily-ad-spend/${entryId}`, {
      method: 'DELETE',
    });
  }

  async getDailyROAS(startDate?: string, endDate?: string): Promise<{
    success: boolean;
    records?: Array<{ dateKey: string; revenue: number; adSpend: number; roas: number | null; updatedAt: string }>;
    error?: string;
  }> {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const qs = params.toString();
    return this.request(`/api/admin/sales/daily-roas${qs ? `?${qs}` : ''}`);
  }

  async backfillDailyROAS(): Promise<{ success: boolean; upserted?: number; error?: string }> {
    return this.request('/api/admin/sales/daily-roas/backfill', { method: 'POST' });
  }

  async getDailyShipping(startDate?: string, endDate?: string): Promise<{
    success: boolean;
    records?: Array<{
      dateKey: string;
      avgShipping: number | null;
      avgShippingSmall: number | null;
      avgShippingLarge: number | null;
      orderCount: number;
      smallCount: number;
      largeCount: number;
    }>;
    error?: string;
  }> {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const qs = params.toString();
    return this.request(`/api/admin/sales/daily-shipping${qs ? `?${qs}` : ''}`);
  }

  async backfillDailyShipping(): Promise<{ success: boolean; upserted?: number; error?: string }> {
    return this.request('/api/admin/sales/daily-shipping/backfill', { method: 'POST' });
  }

  // Upload (public - no auth needed)
  async validateUploadToken(token: string): Promise<UploadInfo> {
    return this.request<UploadInfo>(`/api/upload/${token}`);
  }

  async getUploadedImages(token: string): Promise<{
    success: boolean;
    images?: Array<{
      id: string;
      fileName: string;
      originalName: string;
      s3Url: string;
      photoSize: 'large' | 'small';
      photoType: 'normal' | 'polaroid';
      uploadedAt: string;
    }>;
    error?: string;
  }> {
    return this.request(`/api/upload/${token}/images`);
  }

  async uploadPhoto(
    token: string,
    file: File | Blob,
    size: 'large' | 'small',
    type: 'normal' | 'polaroid'
  ): Promise<{ success: boolean; error?: string }> {
    const formData = new FormData();
    formData.append('photo', file);
    formData.append('size', size);
    formData.append('type', type);

    const response = await fetch(`${this.baseUrl}/api/upload/${token}/upload`, {
      method: 'POST',
      body: formData,
    });

    return response.json();
  }

  async deleteImage(token: string, imageId: string): Promise<{ success: boolean; error?: string }> {
    const response = await fetch(`${this.baseUrl}/api/upload/${token}/images/${imageId}`, {
      method: 'DELETE',
    });

    return response.json();
  }

  async submitForPrinting(token: string): Promise<{ success: boolean; message?: string; error?: string }> {
    const response = await fetch(`${this.baseUrl}/api/upload/${token}/submit`, {
      method: 'POST',
    });

    return response.json();
  }

  async updatePrintSettings(
    token: string,
    photoSize: 'large' | 'small',
    photoType: 'normal' | 'polaroid'
  ): Promise<{ success: boolean; error?: string }> {
    const response = await fetch(`${this.baseUrl}/api/upload/${token}/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ photoSize, photoType }),
    });

    return response.json();
  }

  // COGS Configuration
  async getCOGSConfiguration(): Promise<COGSConfiguration & { totalOverrides?: COGSVersion['totalOverrides'] }> {
    const token = localStorage.getItem('adminToken');
    const response = await fetch(`${this.baseUrl}/api/admin/cogs/configuration`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch COGS configuration');
    }

    return response.json();
  }

  async saveCOGSConfiguration(config: COGSConfiguration & { effectiveFrom: string; totalOverrides?: COGSVersion['totalOverrides'] }): Promise<{ success: boolean; message?: string; version?: COGSVersion }> {
    const token = localStorage.getItem('adminToken');
    const response = await fetch(`${this.baseUrl}/api/admin/cogs/configuration`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || 'Failed to save COGS configuration');
    }

    this.invalidateCache();
    return response.json();
  }

  async getCOGSVersions(): Promise<{ success: boolean; versions: COGSVersion[] }> {
    return this.request('/api/admin/cogs/configuration/versions');
  }

  async updateCOGSVersion(id: string, update: { fields?: COGSField[]; effectiveFrom?: string; totalOverrides?: COGSVersion['totalOverrides'] }): Promise<{ success: boolean; version?: COGSVersion }> {
    const token = localStorage.getItem('adminToken');
    const response = await fetch(`${this.baseUrl}/api/admin/cogs/configuration/${id}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(update),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || 'Failed to update COGS version');
    }

    this.invalidateCache();
    return response.json();
  }

  async deleteCOGSVersion(id: string): Promise<{ success: boolean }> {
    const token = localStorage.getItem('adminToken');
    const response = await fetch(`${this.baseUrl}/api/admin/cogs/configuration/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error((err as any).error || 'Failed to delete COGS version');
    }

    this.invalidateCache();
    return response.json();
  }

  // Fixed Monthly Expenses
  async getFixedMonthlyExpenses(month?: string): Promise<{ success: boolean; entries: { _id: string; month: string; label: string; amount: number }[] }> {
    const qs = month ? `?month=${month}` : '';
    return this.request(`/api/admin/fixed-monthly-expenses${qs}`);
  }

  async createFixedMonthlyExpense(data: { month: string; label: string; amount: number }): Promise<{ success: boolean; entry: { _id: string; month: string; label: string; amount: number } }> {
    return this.request('/api/admin/fixed-monthly-expenses', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateFixedMonthlyExpense(id: string, data: Partial<{ month: string; label: string; amount: number }>): Promise<{ success: boolean; entry: { _id: string; month: string; label: string; amount: number } }> {
    return this.request(`/api/admin/fixed-monthly-expenses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteFixedMonthlyExpense(id: string): Promise<{ success: boolean }> {
    return this.request(`/api/admin/fixed-monthly-expenses/${id}`, { method: 'DELETE' });
  }

  // Bank Account
  async getBankCategories(): Promise<{ success: boolean; categories: { name: string; tags: string[] }[]; error?: string }> {
    return this.request('/api/admin/bank-account/categories');
  }

  async createBankCategory(name: string): Promise<{ success: boolean; category: string; error?: string }> {
    return this.request('/api/admin/bank-account/categories', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async updateBankCategory(oldName: string, newName: string): Promise<{ success: boolean; category: string; error?: string }> {
    return this.request(`/api/admin/bank-account/categories/${encodeURIComponent(oldName)}`, {
      method: 'PATCH',
      body: JSON.stringify({ newName }),
    });
  }

  async deleteBankCategory(name: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request(`/api/admin/bank-account/categories/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  async updateCategoryTags(name: string, tags: string[]): Promise<{ success: boolean; tags: string[]; error?: string }> {
    return this.request(`/api/admin/bank-account/categories/${encodeURIComponent(name)}/tags`, {
      method: 'PATCH',
      body: JSON.stringify({ tags }),
    });
  }

  async getBankTransactions(): Promise<{ success: boolean; transactions: any[]; error?: string }> {
    return this.request('/api/admin/bank-account/transactions');
  }

  async saveBankTransactions(transactions: any[]): Promise<{ success: boolean; transactions: any[]; error?: string }> {
    return this.request('/api/admin/bank-account/transactions/bulk', {
      method: 'POST',
      body: JSON.stringify({ transactions }),
    });
  }

  async deleteBankTransaction(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/bank-account/transactions/${id}`, {
      method: 'DELETE',
    });
  }

  async updateTransactionTags(ids: string[], tags: string[]): Promise<{ success: boolean; error?: string }> {
    return this.request('/api/admin/bank-account/transactions/bulk/tags', {
      method: 'PATCH',
      body: JSON.stringify({ ids, tags }),
    });
  }

  async updateBankTransactionCategory(id: string, category: string): Promise<{ success: boolean; transaction?: any; error?: string }> {
    return this.request(`/api/admin/bank-account/transactions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ category }),
    });
  }

  async getNarrationRules(): Promise<{ success: boolean; rules: any[]; error?: string }> {
    return this.request('/api/admin/bank-account/narration-rules');
  }

  async createNarrationRule(keyword: string, nickname: string): Promise<{ success: boolean; rule?: any; error?: string }> {
    return this.request('/api/admin/bank-account/narration-rules', {
      method: 'POST',
      body: JSON.stringify({ keyword, nickname }),
    });
  }

  async deleteNarrationRule(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/bank-account/narration-rules/${id}`, {
      method: 'DELETE',
    });
  }

  async getTaggingLogs(limit: number = 50, offset: number = 0, outcome?: string, startDate?: string, endDate?: string): Promise<{ success: boolean; logs?: any[]; total?: number; error?: string }> {
    let url = `/api/admin/tagging-logs?limit=${limit}&offset=${offset}`;
    if (outcome && outcome !== 'all') url += `&outcome=${outcome}`;
    if (startDate) url += `&startDate=${startDate}`;
    if (endDate) url += `&endDate=${endDate}`;
    return this.request(url);
  }

  // Pin Codes
  async getBlockedPinCodes(): Promise<{ success: boolean; pinCodes?: any[]; error?: string }> {
    return this.request('/api/admin/pincodes/blocked');
  }

  async addBlockedPinCode(pinCodes: string[], notes?: string): Promise<{ success: boolean; pinCodes?: any[]; error?: string }> {
    return this.request('/api/admin/pincodes/blocked', {
      method: 'POST',
      body: JSON.stringify({ pinCodes, notes }),
    });
  }

  async deleteBlockedPinCode(pinCode: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/pincodes/blocked/${encodeURIComponent(pinCode)}`, {
      method: 'DELETE',
    });
  }

  async getTracking(awb: string): Promise<{ success: boolean; tracking?: any; error?: string }> {
    return this.request(`/api/admin/magic-links/tracking/${awb}`);
  }

  // ─── Reels × Strategies matrix ──────────────────────────────────────────────
  async getReelsData(): Promise<{ success: boolean; reels?: any[]; strategies?: any[]; error?: string }> {
    return this.request('/api/admin/reels');
  }

  async createReel(name: string, url: string, date: string): Promise<{ success: boolean; reel?: any; error?: string }> {
    return this.request('/api/admin/reels/reels', {
      method: 'POST',
      body: JSON.stringify({ name, url, date }),
    });
  }

  async deleteReel(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/reels/reels/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async createReelStrategy(name: string): Promise<{ success: boolean; strategy?: any; error?: string }> {
    return this.request('/api/admin/reels/strategies', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  async deleteReelStrategy(id: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/reels/strategies/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async toggleReelStrategy(reelId: string, strategyId: string, marked: boolean): Promise<{ success: boolean; reel?: any; error?: string }> {
    return this.request(`/api/admin/reels/reels/${encodeURIComponent(reelId)}/strategies/${encodeURIComponent(strategyId)}`, {
      method: 'PUT',
      body: JSON.stringify({ marked }),
    });
  }

  // ─── Agency (campaign-by-campaign, derived from Ads Analysis campaign data) ─
  async getAgencyData(month?: string): Promise<{
    success: boolean; campaigns?: any[]; namePrefixes?: string[];
    totals?: any; comparison?: any; grading?: any; latestDate?: string;
    month?: string | null; availableMonths?: string[]; error?: string;
  }> {
    const qs = month ? `?month=${encodeURIComponent(month)}` : '';
    return this.request(`/api/admin/agency${qs}`);
  }

  async saveAgencyPrefixes(namePrefixes: string[]): Promise<{ success: boolean; namePrefixes?: string[]; error?: string }> {
    return this.request('/api/admin/agency/settings', {
      method: 'PUT',
      body: JSON.stringify({ namePrefixes }),
    });
  }

  // ─── Claude Analysis (daily ad set reviews published from Claude Code) ──────
  async getClaudeAnalysisDates(): Promise<{ success: boolean; dates?: string[]; error?: string }> {
    return this.request('/api/admin/claude-analysis/dates');
  }

  async getClaudeAnalysis(date: string): Promise<{ success: boolean; review?: ClaudeReview; error?: string }> {
    return this.request(`/api/admin/claude-analysis/${date}`);
  }

  async getStock(): Promise<{ success: boolean; alertDays?: number; items?: StockLevel[]; error?: string }> {
    return this.request('/api/admin/stock');
  }

  async getFailureReasons(): Promise<{
    success: boolean;
    refreshedAt?: string | null;
    groups?: string[];
    months?: FailureMonth[];
    reasons?: FailureReasonGroup[];
    error?: string;
  }> {
    return this.request('/api/admin/failure-reasons');
  }

  /** One month (YYYY-MM) of failed Shiprocket orders, oldest first. */
  async getFailureReasonsMonth(month: string): Promise<{
    success: boolean;
    refreshedAt?: string | null;
    groups?: string[];
    summary?: FailureMonth;
    orders?: FailedOrderReason[];
    error?: string;
  }> {
    return this.request(`/api/admin/failure-reasons/${month}`);
  }

  async getFreightClaims(): Promise<{
    success: boolean;
    statuses?: ClaimStatus[];
    counts?: Record<ClaimStatus, number>;
    claims?: FreightClaim[];
    error?: string;
  }> {
    return this.request('/api/admin/freight-claims');
  }

  async getFreightClaim(order: string): Promise<{
    success: boolean;
    claim?: FreightClaimDetail;
    messages?: ClaimMessage[];
    error?: string;
  }> {
    return this.request(`/api/admin/freight-claims/${encodeURIComponent(order)}`);
  }

  /** Closes a claim as refunded: the amount and the day (YYYY-MM-DD) the credit reached the Shiprocket wallet. */
  async markClaimRefunded(order: string, body: { amount: number; date: string; note?: string }): Promise<{
    success: boolean;
    claim?: FreightClaimDetail;
    messages?: ClaimMessage[];
    error?: string;
  }> {
    return this.request(`/api/admin/freight-claims/${encodeURIComponent(order)}/refund`, { method: 'POST', body: JSON.stringify(body) });
  }

  async getShipping(): Promise<{
    success: boolean;
    auto?: { enabled: boolean; lastRunAt: string | null; lastRun: ShippingRun | null };
    days?: ShippingDay[];
    aside?: SetAsideOrder[];
    error?: string;
  }> {
    return this.request('/api/admin/shipping');
  }

  async setShippingAuto(enabled: boolean): Promise<{ success: boolean; enabled?: boolean; error?: string }> {
    return this.request('/api/admin/shipping/auto', { method: 'PUT', body: JSON.stringify({ enabled }) });
  }

  /** Saves a day's labels or manifest PDF. The first download of an open day closes it on the server. */
  async downloadShippingFile(dayId: string, kind: 'labels' | 'manifest'): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/admin/shipping/days/${dayId}/${kind}`, {
      headers: { 'Authorization': `Bearer ${this.getToken()}` },
    });
    // The day may have closed even if building the file failed, so the cached list is stale either way.
    this.invalidateCache();
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `The ${kind} PDF could not be downloaded`);
    }
    const name = response.headers.get('Content-Disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? `${kind}.pdf`;
    const url = window.URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }

  async getMetaCpa(): Promise<{
    success: boolean; weeks?: MetaCpaPeriod[]; months?: MetaCpaPeriod[];
    firstDate?: string | null; latestDate?: string | null; error?: string;
  }> {
    return this.request('/api/admin/meta/cpa');
  }

  async getTickets(): Promise<{ success: boolean; tickets?: any[]; error?: string }> {
    return this.request('/api/admin/magic-links/tickets');
  }

  async createTicket(data: any): Promise<{ success: boolean; ticket?: any; error?: string }> {
    return this.request('/api/admin/magic-links/tickets', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateTicketStatus(id: string, status: string): Promise<{ success: boolean; ticket?: any; error?: string }> {
    return this.request(`/api/admin/magic-links/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  }

  async getTicketByAWB(awb: string): Promise<{ success: boolean; ticket?: any; error?: string }> {
    return this.request(`/api/admin/magic-links/tickets/${awb}`);
  }

  async generateComplaint(data: { activities: any[], orderName: string, courierName: string, customerName: string }): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request('/api/admin/magic-links/generate-complaint', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async generateIncompleteAddressMessage(customerName: string, orderNumber: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request('/api/admin/sales/generate-incomplete-address-message', {
      method: 'POST',
      body: JSON.stringify({ customerName, orderNumber }),
    });
  }

  async generateMultipleOrdersMessage(customerName: string, orderNumber: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request('/api/admin/sales/generate-multiple-orders-message', {
      method: 'POST',
      body: JSON.stringify({ customerName, orderNumber }),
    });
  }

  async searchOrders(query: string): Promise<{ success: boolean; orders: any[]; error?: string }> {
    return this.request(`/api/admin/sales/search-orders?query=${encodeURIComponent(query)}`);
  }

  async predictStock(data: {
    daysToPredict: number;
    historicalData: any[];
    totalBusinessDays: number;
  }): Promise<{ success: boolean; predictions?: any[]; error?: string }> {
    return this.request('/api/admin/sales/predict-stock', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Abandoned Checkouts
  async getAbandonedCheckouts(): Promise<{ success: boolean; checkouts?: any[]; error?: string }> {
    return this.request<{ success: boolean; checkouts?: any[]; error?: string }>('/api/admin/abandoned-checkouts');
  }

  async getWhatsAppTemplate(): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>('/api/admin/abandoned-checkouts/template');
  }

  async saveWhatsAppTemplate(message: string): Promise<{ success: boolean; message?: string; error?: string }> {
    return this.request<{ success: boolean; message?: string; error?: string }>(
      '/api/admin/abandoned-checkouts/template',
      {
        method: 'POST',
        body: JSON.stringify({ message }),
      }
    );
  }

  async submitAbandonedCheckoutsData(textData: string): Promise<{ success: boolean; message?: string; records?: any[]; error?: string }> {
    return this.request<{ success: boolean; message?: string; records?: any[]; error?: string }>(
      '/api/admin/abandoned-checkouts',
      {
        method: 'POST',
        body: JSON.stringify({ textData }),
      }
    );
  }

  async updateAbandonedCheckoutStatus(id: string, status: 'pending' | 'message_sent' | 'not_required'): Promise<{ success: boolean; checkout?: any; error?: string }> {
    return this.request<{ success: boolean; checkout?: any; error?: string }>(
      `/api/admin/abandoned-checkouts/${id}/status`,
      {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }
    );
  }
  async getEmployeesStats(month: string): Promise<{ success: boolean; employees?: any[]; error?: string }> {
    return this.request(`/api/admin/attendance/employees/stats?month=${month}`);
  }

  async getAllEmployees(): Promise<{ success: boolean; employees?: any[]; error?: string }> {
    return this.request('/api/admin/attendance/employees');
  }

  async addEmployee(name: string, joiningDate: string, employeeType: 'monthly' | 'hourly', monthlySalary?: number, hourlyRate?: number): Promise<{ success: boolean; employee?: any; error?: string }> {
    return this.request('/api/admin/attendance/employees', {
      method: 'POST',
      body: JSON.stringify({ name, monthlySalary, hourlyRate, joiningDate, employeeType }),
    });
  }

  async updateEmployee(id: string, data: any): Promise<{ success: boolean; employee?: any; error?: string }> {
    return this.request(`/api/admin/attendance/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getAttendanceRecords(dateStr: string): Promise<{ success: boolean; records?: any[]; error?: string }> {
    return this.request(`/api/admin/attendance/records?dateStr=${dateStr}`);
  }

  async getMonthlyAttendance(month: string): Promise<{ success: boolean; records?: any[]; error?: string }> {
    return this.request(`/api/admin/attendance/records/month/${month}`);
  }

  async markAttendance(employeeId: string, dateStr: string, status: string, notes?: string): Promise<{ success: boolean; record?: any; error?: string }> {
    return this.request('/api/admin/attendance/records', {
      method: 'POST',
      body: JSON.stringify({ employeeId, dateStr, status, notes }),
    });
  }

  async addSalaryAdvance(employeeId: string, date: string, amount: number, reason: string): Promise<{ success: boolean; advance?: any; error?: string }> {
    return this.request('/api/admin/attendance/advances', {
      method: 'POST',
      body: JSON.stringify({ employeeId, date, amount, reason }),
    });
  }

  async markSalaryPaid(employeeId: string, month: string, amountPaid: number): Promise<{ success: boolean; payment?: any; error?: string }> {
    return this.request('/api/admin/attendance/payments', {
      method: 'POST',
      body: JSON.stringify({ employeeId, month, amountPaid }),
    });
  }

  async logHours(employeeId: string, dateStr: string, hoursWorked: number, notes?: string): Promise<{ success: boolean; log?: any; error?: string }> {
    return this.request('/api/admin/attendance/hourly-logs', {
      method: 'POST',
      body: JSON.stringify({ employeeId, dateStr, hoursWorked, notes }),
    });
  }

  async deleteHourlyLog(employeeId: string, dateStr: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/attendance/hourly-logs/${employeeId}/${dateStr}`, {
      method: 'DELETE',
    });
  }

  async getMonthlyHourlyLogs(month: string): Promise<{ success: boolean; employees?: any[]; error?: string }> {
    return this.request(`/api/admin/attendance/hourly-logs/month/${month}`);
  }

  async getAllHourlyLogs(): Promise<{ success: boolean; employees?: any[]; logs?: any[]; error?: string }> {
    return this.request('/api/admin/attendance/hourly-logs/all');
  }

  async getMonthlyOrderCounts(): Promise<{
    success: boolean;
    months: Array<{ month: string; orders: number }>;
    paceAverage: number;
    paceDay: number;
    error?: string;
  }> {
    return this.request('/api/admin/sales/monthly-order-counts');
  }

  async getMonthlyRevenue(): Promise<{
    success: boolean;
    months: Array<{ month: string; revenue: number }>;
    paceAverage: number;
    paceDay: number;
    error?: string;
  }> {
    return this.request('/api/admin/sales/monthly-revenue');
  }

  async getIncompleteDayOrders(date: string): Promise<{
    success: boolean;
    date: string;
    orders: Array<{ orderNumber: string; amount: number; deliveryStatus: string; trackingUrl: string | null }>;
    error?: string;
  }> {
    return this.request(`/api/admin/sales/incomplete-day-orders?date=${encodeURIComponent(date)}`);
  }

  async getDailyOrderStats(startDate?: string, endDate?: string): Promise<{
    success: boolean;
    stats?: {
      prepaidCount: number; codCount: number;
      deliveredCount: number; failedCount: number; inTransitCount: number;
      outForDeliveryCount: number; attemptedDeliveryCount: number; confirmedCount: number;
      codDeliveredCount: number; codFailedCount: number;
    };
    completedDates?: string[];
    records?: Array<{
      dateKey: string;
      prepaidCount: number;
      codCount: number;
      deliveredCount: number;
      failedCount: number;
      inTransitCount: number;
      outForDeliveryCount: number;
      attemptedDeliveryCount: number;
      confirmedCount: number;
      codDeliveredCount: number;
      codFailedCount: number;
      isCompleted: boolean;
      sessions?: number;
    }>;
    error?: string;
  }> {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    const qs = params.toString();
    return this.request(`/api/admin/sales/daily-order-stats${qs ? `?${qs}` : ''}`);
  }

  async backfillDailyOrderStats(): Promise<{ success: boolean; upserted?: number; error?: string }> {
    return this.request('/api/admin/sales/daily-order-stats/backfill', { method: 'POST' });
  }

  async getDailyAverages(days = 30): Promise<{
    success: boolean;
    summary?: {
      days: number;
      completedDays: number;
      orders: number;
      revenue: number;
      cogs: number;
      adSpend: number;
      profit: number;
      avgRevenuePerOrder: number;
      avgCogsPerOrder: number;
      avgProfitPerOrder: number;
      profitMargin: number;
      roas: number;
    };
    daily?: Array<{
      date: string;
      orders: number;
      revenue: number;
      cogs: number;
      adSpend: number;
      profit: number;
      isCompleted: boolean;
      avgRevenuePerOrder: number;
      avgCogsPerOrder: number;
      avgProfitPerOrder: number;
      roas: number;
    }>;
    error?: string;
  }> {
    return this.request(`/api/admin/sales/daily-averages?days=${days}`);
  }

  async getFailedOrdersAnalysis(): Promise<{
    success: boolean;
    failedCount?: number;
    courierStats?: Record<string, { failed: number; total: number }>;
    cityStats?: Record<string, { failed: number; total: number }>;
    delayStats?: Record<string, { failed: number; total: number }>;
    attemptStats?: Record<string, { failed: number; total: number }>;
  }> {
    return this.request('/api/admin/sales/failed-orders-analysis');
  }

  async getCodAddedCities(): Promise<{ success: boolean; cities?: string[] }> {
    return this.request('/api/admin/pincodes/cod-added-cities');
  }

  async addCodAddedCity(city: string): Promise<{ success: boolean }> {
    return this.request('/api/admin/pincodes/cod-added-cities', { method: 'POST', body: JSON.stringify({ city }) });
  }

  async removeCodAddedCity(city: string): Promise<{ success: boolean }> {
    return this.request(`/api/admin/pincodes/cod-added-cities/${encodeURIComponent(city)}`, { method: 'DELETE' });
  }

async getVariantPerformance(days = 30): Promise<{
    success: boolean;
    days?: number;
    buckets?: Array<{
      variant: 'small' | 'large';
      payment: 'prepaid' | 'cod';
      orders: number;
      delivered: number;
      rto: number;
      pending: number;
      deliveryRate: number;
      rtoRate: number;
      revenue: number;
      cogs: number;
      adSpend: number;
      profit: number;
      avgRevenuePerOrder: number;
      avgProfitPerOrder: number;
      profitMargin: number;
    }>;
  }> {
    return this.request(`/api/admin/sales/variant-performance?days=${days}`);
  }

  async getDailyPnl(params: { month?: string; year?: string; startDate?: string; endDate?: string } = {}): Promise<{
    success: boolean;
    records?: Array<{
      dateKey: string;
      isCompleted: boolean;
      barChartProfit: number;
      heatmapProfit: number;
      orderCount: number;
      adSpend: number;
    }>;
    error?: string;
  }> {
    const qs = new URLSearchParams();
    if (params.month) qs.set('month', params.month);
    if (params.year) qs.set('year', params.year);
    if (params.startDate) qs.set('startDate', params.startDate);
    if (params.endDate) qs.set('endDate', params.endDate);
    const q = qs.toString();
    return this.request(`/api/admin/sales/daily-pnl${q ? `?${q}` : ''}`);
  }

  async backfillDailyPnl(): Promise<{ success: boolean; upserted?: number; error?: string }> {
    return this.request('/api/admin/sales/daily-pnl/backfill', { method: 'POST' });
  }

  /** Everything the Dashboard shows on open, in one request; each part is shaped like its own route's response. */
  async getDashboardSummary(params: {
    month: string;
    year: string;
    roasStart: string;
    roasEnd: string;
    statsStart: string;
    statsEnd: string;
  }): Promise<{
    success: boolean;
    error?: string;
    breakeven: Awaited<ReturnType<ApiService['getBreakevenMetrics']>>;
    roas: Awaited<ReturnType<ApiService['getDailyROAS']>>;
    shipping: Awaited<ReturnType<ApiService['getDailyShipping']>>;
    orderStats: Awaited<ReturnType<ApiService['getDailyOrderStats']>>;
    pnlMonth: Awaited<ReturnType<ApiService['getDailyPnl']>>;
    pnlYear: Awaited<ReturnType<ApiService['getDailyPnl']>>;
    monthlyOrderCounts: Awaited<ReturnType<ApiService['getMonthlyOrderCounts']>>;
    monthlyRevenue: Awaited<ReturnType<ApiService['getMonthlyRevenue']>>;
  }> {
    return this.request(`/api/admin/sales/dashboard-summary?${new URLSearchParams(params).toString()}`);
  }

  async getBreakevenMetrics(): Promise<{
    success: boolean;
    aov?: number;
    avgCOGS?: number;
    avgShipping?: number;
    avgTotalCost?: number;
    contributionMargin?: number;
    breakevenROAS?: number;
    deliveredCount?: number;
    failedCount?: number;
    totalOrders?: number;
    /** Every settled order at its own price, per settled order. */
    orderValue?: number;
    /** Breakeven on every order's value: the basis of Ads Manager's ROAS. */
    breakevenMetaROAS?: number;
    windowDays?: number;
    /** First order date of the settled orders behind the figures. */
    since?: string | null;
    error?: string;
  }> {
    return this.request('/api/admin/sales/breakeven-metrics');
  }
}


export const api = new ApiService();
export type { AdminUser, MagicLinkInfo, UploadInfo, ShopifyOrder };
