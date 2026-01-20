const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Admin Auth Types
interface AdminUser {
  id: string;
  email: string;
  name: string;
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
  paymentMethod?: string;
  maxUploads: number;
  lineItems?: Array<{
    title: string;
    quantity: number;
    variantTitle?: string;
  }>;
}

interface OrdersResponse {
  success: boolean;
  orders?: ShopifyOrder[];
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

  // Shopify Orders
  async getOrders(limit = 50, allOrders = false): Promise<OrdersResponse> {
    const allParam = allOrders ? '&all=true' : '';
    return this.request<OrdersResponse>(`/api/admin/magic-links/shopify/orders?limit=${limit}${allParam}`);
  }

  async getOrder(orderNumber: string): Promise<{ success: boolean; order?: ShopifyOrder; error?: string }> {
    return this.request(`/api/admin/magic-links/shopify/orders/${encodeURIComponent(orderNumber)}`);
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

  async getProducts(): Promise<{ success: boolean; products?: Array<{
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
  }>; error?: string }> {
    return this.request('/api/admin/magic-links/shopify/products');
  }

  async getProduct(productId: string): Promise<{ success: boolean; product?: any; error?: string }> {
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

}

export const api = new ApiService();
export type { AdminUser, MagicLinkInfo, UploadInfo, ShopifyOrder };
