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
  private printedPhotosProductId: number;

  constructor() {
    this.storeDomain = config.shopify.storeDomain;
    this.accessToken = config.shopify.accessToken;
    this.apiVersion = '2024-01';
    this.printedPhotosProductId = parseInt(config.shopify.printedPhotosProductId, 10);
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
   * Check if an order contains the printed photos product
   */
  private orderContainsPrintedPhotos(order: ShopifyOrder): boolean {
    if (!order.line_items) return false;
    return order.line_items.some(item => item.product_id === this.printedPhotosProductId);
  }

  /**
   * Get the max uploads for an order based on the printed photos variant
   * Variant titles are "12", "15", "20", "25" representing photo counts
   */
  getMaxUploadsForOrder(order: ShopifyOrder): number {
    if (!order.line_items) return 25; // Default
    
    const printedPhotosItem = order.line_items.find(
      item => item.product_id === this.printedPhotosProductId
    );
    
    if (!printedPhotosItem || !printedPhotosItem.variant_title) {
      return 25; // Default if no variant found
    }
    
    // Parse the variant title (e.g., "12", "15", "20", "25")
    const maxUploads = parseInt(printedPhotosItem.variant_title, 10);
    
    // Validate it's a valid number, otherwise default to 25
    if (isNaN(maxUploads) || maxUploads <= 0) {
      return 25;
    }
    
    // Multiply by quantity in case they ordered multiple
    return maxUploads * printedPhotosItem.quantity;
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
   * Get orders that contain the printed photos product
   * Fetches more orders and filters to only those with the product
   */
  async getOrdersWithPrintedPhotos(limit: number = 50): Promise<ShopifyOrder[]> {
    try {
      // Fetch more orders than needed since we'll filter them
      const fetchLimit = Math.min(limit * 3, 250); // Shopify max is 250
      
      const data = await this.makeRequest<ShopifyOrdersResponse>(
        `/orders.json?status=any&limit=${fetchLimit}`
      );
      
      const allOrders = data.orders || [];
      
      // Filter to only orders containing the printed photos product
      const filteredOrders = allOrders.filter(order => this.orderContainsPrintedPhotos(order));
      
      // Return up to the requested limit
      return filteredOrders.slice(0, limit);
    } catch (error) {
      console.error('Error fetching orders:', error);
      throw error;
    }
  }

  /**
   * Get recent orders (for admin to browse) - DEPRECATED, use getOrdersWithPrintedPhotos
   */
  async getRecentOrders(limit: number = 50): Promise<ShopifyOrder[]> {
    return this.getOrdersWithPrintedPhotos(limit);
  }

  /**
   * Get all products with their variants
   */
  async getProducts(limit: number = 50): Promise<any[]> {
    try {
      const data = await this.makeRequest<{ products: any[] }>(
        `/products.json?limit=${limit}`
      );
      
      return data.products || [];
    } catch (error) {
      console.error('Error fetching products:', error);
      throw error;
    }
  }

  /**
   * Get a single product by ID with its variants
   */
  async getProduct(productId: string): Promise<any | null> {
    try {
      const data = await this.makeRequest<{ product: any }>(
        `/products/${productId}.json`
      );
      
      return data.product || null;
    } catch (error) {
      console.error('Error fetching product:', error);
      throw error;
    }
  }
}

export default new ShopifyService();
