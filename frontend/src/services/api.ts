const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface AuthResponse {
  success: boolean;
  token?: string;
  order?: {
    id: number;
    orderNumber: string;
    email: string;
    customerName: string;
    createdAt: string;
    lineItems: Array<{
      id: number;
      title: string;
      quantity: number;
      productId: number;
      variantId: number;
    }>;
  };
  error?: string;
}

interface UserResponse {
  success: boolean;
  user?: {
    orderId: number;
    orderNumber: string;
  };
  error?: string;
}

class ApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  private getToken(): string | null {
    return localStorage.getItem('authToken');
  }

  private setToken(token: string): void {
    localStorage.setItem('authToken', token);
  }

  private removeToken(): void {
    localStorage.removeItem('authToken');
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
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

    const data = await response.json();
    return data;
  }

  /**
   * Verify order number and mobile number
   */
  async verifyAuth(orderNo: string, mobile: string): Promise<AuthResponse> {
    const response = await this.request<AuthResponse>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ orderNo, mobile }),
    });

    if (response.success && response.token) {
      this.setToken(response.token);
    }

    return response;
  }

  /**
   * Get current authenticated user info
   */
  async getCurrentUser(): Promise<UserResponse> {
    return this.request<UserResponse>('/api/auth/me');
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  /**
   * Logout - clear token
   */
  logout(): void {
    this.removeToken();
  }
}

export const api = new ApiService();
export type { AuthResponse, UserResponse };
