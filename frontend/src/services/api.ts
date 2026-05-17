const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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
  percentageType: 'included' | 'excluded'; // For percentage: included (part of total) or excluded (added on top)
}

interface COGSConfiguration {
  fields: COGSField[];
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
  }

  removeToken(): void {
    localStorage.removeItem('adminToken');
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
  async getOrders(limit = 50, allOrders = false, createdAtMin?: string, month?: string): Promise<OrdersResponse> {
    const allParam = allOrders ? '&all=true' : '';
    const dateParam = createdAtMin ? `&created_at_min=${encodeURIComponent(createdAtMin)}` : '';
    const monthParam = month ? `&month=${encodeURIComponent(month)}` : '';
    return this.request<OrdersResponse>(`/api/admin/magic-links/shopify/orders?limit=${limit}${allParam}${dateParam}${monthParam}`);
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

  async deleteDailyAdSpend(entryId: string): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/admin/expenses/daily-ad-spend/${entryId}`, {
      method: 'DELETE',
    });
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
  async getCOGSConfiguration(): Promise<COGSConfiguration> {
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

  async saveCOGSConfiguration(config: COGSConfiguration): Promise<{ success: boolean; message?: string }> {
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
      throw new Error('Failed to save COGS configuration');
    }

    return response.json();
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

  async getProfitPrediction(monthYear: string): Promise<{ success: boolean; prediction?: any; error?: string }> {
    return this.request(`/api/admin/sales/prediction/${monthYear}`);
  }

  async predictProfit(data: any): Promise<{ success: boolean; prediction?: any; reasoning?: string; error?: string }> {
    return this.request('/api/admin/sales/predict', {
      method: 'POST',
      body: JSON.stringify(data),
    });
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

  async analyzeAds(adData: any[]): Promise<{ success: boolean; recommendations: any[]; overallStrategy: string; error?: string }> {
    return this.request('/api/admin/sales/analyze-ads', {
      method: 'POST',
      body: JSON.stringify({ adData }),
    });
  }

  async saveAdsPerformance(adData: any[], level?: string, date?: string): Promise<{ success: boolean; count: number; error?: string }> {
    return this.request('/api/admin/sales/ads-performance', {
      method: 'POST',
      body: JSON.stringify({ adData, level, date }),
    });
  }

  async getAdsPerformanceStatus(): Promise<{ success: boolean; count: number; latestDate: string | null; archivedDates: string[]; error?: string }> {
    return this.request('/api/admin/sales/ads-performance/status');
  }

  async clearAdsPerformance(): Promise<{ success: boolean; message: string; error?: string }> {
    return this.request('/api/admin/sales/ads-performance', { method: 'DELETE' });
  }

  async deleteAdsPerformanceByDate(date: string): Promise<{ success: boolean; message: string; error?: string }> {
    return this.request(`/api/admin/sales/ads-performance/${date}`, { method: 'DELETE' });
  }

  async getAdsPerformanceDaily(): Promise<{ success: boolean; data: any[]; error?: string }> {
    return this.request('/api/admin/sales/ads-performance/daily');
  }

  async getAdsAnalysis(date: string): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.request(`/api/admin/sales/ads-analysis/${date}`);
  }

  async getAdsAnalysisLatest(): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.request('/api/admin/sales/ads-analysis-latest');
  }

  async getAdsAnalysisDates(): Promise<{ success: boolean; dates: string[]; error?: string }> {
    return this.request('/api/admin/sales/ads-analysis-dates');
  }

    async getAdsPerformance(date: string): Promise<{ success: boolean; data?: any; error?: string }> {
    return this.request(`/api/admin/sales/ads-performance/${date}`);
  }

  async getAdsPerformanceAll(): Promise<{ success: boolean; count: number; data: any[]; error?: string }> {
    return this.request('/api/admin/sales/ads-performance-all');
  }

  async adsChat(userQuestion: string, date: string): Promise<{ success: boolean; aiResponse: string; chat: any[]; error?: string }> {
    return this.request('/api/admin/sales/ads-chat', {
      method: 'POST',
      body: JSON.stringify({ userQuestion, date })
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
}


export const api = new ApiService();
export type { AdminUser, MagicLinkInfo, UploadInfo, ShopifyOrder };
