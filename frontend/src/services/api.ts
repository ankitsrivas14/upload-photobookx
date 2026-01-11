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

// Upload Types
interface UploadInfo {
  success: boolean;
  orderNumber?: string;
  customerName?: string;
  maxUploads?: number;
  currentUploads?: number;
  remainingUploads?: number;
  expiresAt?: string;
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
    maxUploads?: number;
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

  // Upload (public - no auth needed)
  async validateUploadToken(token: string): Promise<UploadInfo> {
    return this.request<UploadInfo>(`/api/upload/${token}`);
  }
}

export const api = new ApiService();
export type { AdminUser, MagicLinkInfo, UploadInfo };
