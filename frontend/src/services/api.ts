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
  async getOrders(limit = 50): Promise<OrdersResponse> {
    return this.request<OrdersResponse>(`/api/admin/magic-links/shopify/orders?limit=${limit}`);
  }

  async getOrder(orderNumber: string): Promise<{ success: boolean; order?: ShopifyOrder; error?: string }> {
    return this.request(`/api/admin/magic-links/shopify/orders/${encodeURIComponent(orderNumber)}`);
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
