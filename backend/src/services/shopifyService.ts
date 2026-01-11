import config from '../config';
import type { 
  ShopifyOrder, 
  ShopifyOrdersResponse, 
  ShopifyCustomerFull,
  ShopifyCustomerResponse,
  VerifyOrderResult,
  OrderInfo 
} from '../types';

/**
 * Shopify Admin API Service
 * Uses the Shopify Admin REST API to verify orders
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

  /**
   * Get the base URL for Shopify Admin API
   */
  private getBaseUrl(): string {
    return `https://${this.storeDomain}/admin/api/${this.apiVersion}`;
  }

  /**
   * Make a request to Shopify Admin API
   */
  private async makeRequest<T>(endpoint: string, method: string = 'GET'): Promise<T> {
    const url = `${this.getBaseUrl()}${endpoint}`;
    
    console.log(`[Shopify API] ${method} ${url}`);
    
    const response = await fetch(url, {
      method,
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Shopify API] Error: ${response.status} - ${error}`);
      throw new Error(`Shopify API Error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Search for an order by order number
   */
  async findOrderByNumber(orderNumber: string): Promise<ShopifyOrder | null> {
    const cleanOrderNumber = orderNumber.replace(/^#/, '').trim();
    
    console.log(`[Order Search] Looking for order: "${orderNumber}" (cleaned: "${cleanOrderNumber}")`);
    
    try {
      // Search orders by name (order number)
      const data = await this.makeRequest<ShopifyOrdersResponse>(
        `/orders.json?name=${encodeURIComponent(cleanOrderNumber)}&status=any`
      );
      
      if (data.orders && data.orders.length > 0) {
        console.log(`[Order Search] Found order with name: ${data.orders[0].name}`);
        return data.orders[0];
      }
      
      // Try with # prefix
      const dataWithHash = await this.makeRequest<ShopifyOrdersResponse>(
        `/orders.json?name=${encodeURIComponent('#' + cleanOrderNumber)}&status=any`
      );
      
      if (dataWithHash.orders && dataWithHash.orders.length > 0) {
        console.log(`[Order Search] Found order with # prefix: ${dataWithHash.orders[0].name}`);
        return dataWithHash.orders[0];
      }
      
      console.log(`[Order Search] No order found for: "${orderNumber}"`);
      return null;
    } catch (error) {
      console.error('[Order Search] Error finding order:', error);
      throw error;
    }
  }

  /**
   * Search for orders by phone number
   * Tries multiple search methods
   */
  async findOrdersByPhone(phoneNumber: string): Promise<ShopifyOrder[]> {
    // Normalize phone - try with and without country code
    const cleanPhone = phoneNumber.replace(/\D/g, '').slice(-10);
    const phoneWithCode = '+91' + cleanPhone;
    
    console.log(`[Phone Search] Searching orders for phone: "${phoneNumber}"`);
    console.log(`[Phone Search] Clean phone: "${cleanPhone}", With code: "${phoneWithCode}"`);
    
    const foundOrders: ShopifyOrder[] = [];
    
    try {
      // Method 1: Search orders with query parameter
      console.log('[Phone Search] Trying orders search query...');
      const querySearch = await this.makeRequest<ShopifyOrdersResponse>(
        `/orders.json?status=any&query=${encodeURIComponent(cleanPhone)}`
      );
      console.log(`[Phone Search] Query search returned ${querySearch.orders?.length || 0} orders`);
      if (querySearch.orders) {
        foundOrders.push(...querySearch.orders);
      }

      // Method 2: Try with country code
      if (foundOrders.length === 0) {
        console.log('[Phone Search] Trying with +91 country code...');
        const querySearchWithCode = await this.makeRequest<ShopifyOrdersResponse>(
          `/orders.json?status=any&query=${encodeURIComponent(phoneWithCode)}`
        );
        console.log(`[Phone Search] Query with +91 returned ${querySearchWithCode.orders?.length || 0} orders`);
        if (querySearchWithCode.orders) {
          foundOrders.push(...querySearchWithCode.orders);
        }
      }
      
      // Log found orders
      if (foundOrders.length > 0) {
        console.log(`[Phone Search] Found ${foundOrders.length} orders:`);
        foundOrders.forEach(o => console.log(`  - ${o.name} (ID: ${o.id})`));
      } else {
        console.log('[Phone Search] No orders found by phone');
      }
      
      return foundOrders;
    } catch (error) {
      console.error('[Phone Search] Error searching by phone:', error);
      return [];
    }
  }

  /**
   * Fetch full customer details by customer ID
   */
  async getCustomerById(customerId: number): Promise<ShopifyCustomerFull | null> {
    console.log(`[Customer Fetch] Getting customer details for ID: ${customerId}`);
    
    try {
      const data = await this.makeRequest<ShopifyCustomerResponse>(
        `/customers/${customerId}.json`
      );
      
      // Log the FULL raw response to debug
      console.log('[Customer Fetch] Full customer response:', JSON.stringify(data, null, 2));
      
      if (data.customer) {
        console.log(`[Customer Fetch] Found customer: ${data.customer.first_name} ${data.customer.last_name}`);
        console.log(`[Customer Fetch] Email: ${data.customer.email}`);
        console.log(`[Customer Fetch] Phone: ${data.customer.phone}`);
        console.log(`[Customer Fetch] Default address phone: ${data.customer.default_address?.phone}`);
        return data.customer;
      }
      
      return null;
    } catch (error) {
      console.error('[Customer Fetch] Error fetching customer:', error);
      return null;
    }
  }

  /**
   * Normalize phone number for comparison
   */
  private normalizePhone(phone: string | null | undefined): string {
    if (!phone) return '';
    // Remove all non-digit characters
    const normalized = phone.replace(/\D/g, '');
    // Take last 10 digits (removes country codes like +91, 91, etc.)
    return normalized.slice(-10);
  }

  /**
   * Verify if the provided mobile number matches any phone in order/customer
   */
  async verifyMobileNumber(
    order: ShopifyOrder, 
    customer: ShopifyCustomerFull | null,
    mobileNumber: string
  ): Promise<boolean> {
    if (!order || !mobileNumber) {
      console.log('[Phone Verify] Missing order or mobile number');
      return false;
    }

    const inputPhone = this.normalizePhone(mobileNumber);
    
    console.log('[Phone Verify] ====== PHONE COMPARISON DEBUG ======');
    console.log(`[Phone Verify] Input mobile (raw): "${mobileNumber}"`);
    console.log(`[Phone Verify] Input mobile (normalized 10 digits): "${inputPhone}"`);
    
    // Collect all possible phone numbers
    const phoneNumbers: { source: string; raw: string | null | undefined; normalized: string }[] = [];
    
    // From full customer data (fetched separately)
    if (customer) {
      phoneNumbers.push({
        source: 'Customer (full)',
        raw: customer.phone,
        normalized: this.normalizePhone(customer.phone),
      });
      phoneNumbers.push({
        source: 'Customer default_address',
        raw: customer.default_address?.phone,
        normalized: this.normalizePhone(customer.default_address?.phone),
      });
    }
    
    // From order's customer object (may be partial)
    if (order.customer) {
      phoneNumbers.push({
        source: 'Order.customer',
        raw: order.customer.phone,
        normalized: this.normalizePhone(order.customer.phone),
      });
      phoneNumbers.push({
        source: 'Order.customer.default_address',
        raw: order.customer.default_address?.phone,
        normalized: this.normalizePhone(order.customer.default_address?.phone),
      });
    }
    
    // From order addresses
    phoneNumbers.push({
      source: 'Billing address',
      raw: order.billing_address?.phone,
      normalized: this.normalizePhone(order.billing_address?.phone),
    });
    phoneNumbers.push({
      source: 'Shipping address',
      raw: order.shipping_address?.phone,
      normalized: this.normalizePhone(order.shipping_address?.phone),
    });
    
    // Order-level phone (if exists)
    if (order.phone) {
      phoneNumbers.push({
        source: 'Order.phone',
        raw: order.phone,
        normalized: this.normalizePhone(order.phone),
      });
    }
    
    // Log all phone numbers found
    console.log('[Phone Verify] Phone numbers found in order/customer:');
    for (const pn of phoneNumbers) {
      console.log(`[Phone Verify]   ${pn.source}: raw="${pn.raw}" -> normalized="${pn.normalized}"`);
    }
    
    // Check for matches
    for (const pn of phoneNumbers) {
      if (pn.normalized && pn.normalized === inputPhone) {
        console.log(`[Phone Verify] ✅ Match found: ${pn.source}`);
        console.log('[Phone Verify] ====================================');
        return true;
      }
    }

    console.log('[Phone Verify] ❌ No match found');
    console.log('[Phone Verify] ====================================');
    
    return false;
  }

  /**
   * Transform order and customer data to sanitized order info
   */
  private transformOrderToInfo(order: ShopifyOrder, customer: ShopifyCustomerFull | null): OrderInfo {
    const customerName = customer 
      ? `${customer.first_name || ''} ${customer.last_name || ''}`.trim()
      : `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim();
    
    const email = customer?.email || order.email || '';
    
    return {
      id: order.id,
      orderNumber: order.name,
      email,
      customerName: customerName || 'Customer',
      createdAt: order.created_at,
      lineItems: order.line_items?.map(item => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        productId: item.product_id,
        variantId: item.variant_id,
      })) || [],
    };
  }

  /**
   * Verify order authentication
   * Returns order details if valid, null otherwise
   */
  async verifyOrderAuth(orderNumber: string, mobileNumber: string): Promise<VerifyOrderResult> {
    console.log('\n========== ORDER AUTH VERIFICATION ==========');
    console.log(`[Auth] Order Number: "${orderNumber}"`);
    console.log(`[Auth] Mobile Number: "${mobileNumber}"`);
    
    try {
      const order = await this.findOrderByNumber(orderNumber);
      
      if (!order) {
        console.log('[Auth] ❌ Order not found');
        return { success: false, error: 'Order not found' };
      }

      console.log(`[Auth] Order found - ID: ${order.id}, Name: ${order.name}`);
      
      // Fetch full customer details if customer ID exists
      let customer: ShopifyCustomerFull | null = null;
      if (order.customer?.id) {
        customer = await this.getCustomerById(order.customer.id);
      } else {
        console.log('[Auth] No customer ID in order, skipping customer fetch');
      }

      const isMobileValid = await this.verifyMobileNumber(order, customer, mobileNumber);
      
      if (!isMobileValid) {
        console.log('[Auth] ❌ Mobile number verification failed');
        console.log('==============================================\n');
        return { success: false, error: 'Mobile number does not match order' };
      }

      console.log('[Auth] ✅ Authentication successful');
      console.log('==============================================\n');
      
      return {
        success: true,
        order: this.transformOrderToInfo(order, customer),
      };
    } catch (error) {
      console.error('[Auth] Error during verification:', error);
      console.log('==============================================\n');
      return { success: false, error: 'Failed to verify order' };
    }
  }
}

export default new ShopifyService();
