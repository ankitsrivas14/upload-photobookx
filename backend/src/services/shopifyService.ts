import config from '../config';
import type { ShopifyOrder, ShopifyOrdersResponse } from '../types';

/**
 * Simplified Shopify Admin API Service
 * Just for fetching order details (no auth verification)
 */
class ShopifyService {
  private storeDomain: string;
  private accessToken: string;
  private apiVersion: string;

  constructor() {
    this.storeDomain = config.shopify.storeDomain;
    this.accessToken = config.shopify.accessToken;
    this.apiVersion = '2024-01';
  }

  private getBaseUrl(): string {
    return `https://${this.storeDomain}/admin/api/${this.apiVersion}`;
  }

  private async makeRequest<T>(endpoint: string): Promise<T> {
    const url = `${this.getBaseUrl()}${endpoint}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shopify API Error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Find order by order number
   */
  async findOrderByNumber(orderNumber: string): Promise<ShopifyOrder | null> {
    const cleanOrderNumber = orderNumber.replace(/^#/, '').trim();
    
    try {
      // Search by order name
      const data = await this.makeRequest<ShopifyOrdersResponse>(
        `/orders.json?name=${encodeURIComponent(cleanOrderNumber)}&status=any`
      );
      
      if (data.orders && data.orders.length > 0) {
        return data.orders[0];
      }
      
      // Try with # prefix
      const dataWithHash = await this.makeRequest<ShopifyOrdersResponse>(
        `/orders.json?name=${encodeURIComponent('#' + cleanOrderNumber)}&status=any`
      );
      
      if (dataWithHash.orders && dataWithHash.orders.length > 0) {
        return dataWithHash.orders[0];
      }
      
      return null;
    } catch (error) {
      console.error('Error finding order:', error);
      throw error;
    }
  }

  /**
   * Get recent orders (for admin to browse)
   */
  async getRecentOrders(limit: number = 50): Promise<ShopifyOrder[]> {
    try {
      const data = await this.makeRequest<ShopifyOrdersResponse>(
        `/orders.json?status=any&limit=${limit}`
      );
      return data.orders || [];
    } catch (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }
  }
}

export default new ShopifyService();
