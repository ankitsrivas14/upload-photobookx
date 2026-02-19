import config from '../config';
import type { ShopifyOrder, ShopifyOrdersResponse } from '../types';
import ShopifyOrderCache from '../models/ShopifyOrderCache';

/**
 * Simplified Shopify Admin API Service
 * Just for fetching order details (no auth verification)
 */
class ShopifyService {
  private storeDomain: string;
  private accessToken: string;
  private apiVersion: string;
  private printedPhotosProductId: number;
  // Cache is now infinite - only cleared by explicit refresh button click

  constructor() {
    this.storeDomain = config.shopify.storeDomain;
    this.accessToken = config.shopify.accessToken;
    this.apiVersion = '2024-01';
    this.printedPhotosProductId = parseInt(config.shopify.printedPhotosProductId, 10);
  }

  private getBaseUrl(): string {
    return `https://${this.storeDomain}/admin/api/${this.apiVersion}`;
  }

  private async makeRequest<T>(endpoint: string, options?: { method?: string; body?: any }): Promise<T> {
    const url = `${this.getBaseUrl()}${endpoint}`;
    const method = options?.method || 'GET';
    
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
    };

    if (options?.body && (method === 'PUT' || method === 'POST')) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shopify API Error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Make request that returns both data and headers (for pagination with Link header)
   */
  private async makeRequestWithHeaders<T>(endpoint: string): Promise<{ data: T; linkHeader: string | null }> {
    const url = `${this.getBaseUrl()}${endpoint}`;
    
    const fetchOptions: RequestInit = {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shopify API Error: ${response.status} - ${error}`);
    }

    const data = await response.json() as T;
    const linkHeader = response.headers.get('Link');

    return { data, linkHeader };
  }

  /**
   * Parse page_info from Shopify's Link header
   * Format: '<https://shop.myshopify.com/...?page_info=TOKEN&limit=250>; rel="next"'
   */
  private parseNextPageInfo(linkHeader: string | null): string | null {
    if (!linkHeader) return null;

    // Link header can have multiple links separated by comma
    const links = linkHeader.split(',');
    
    for (const link of links) {
      // Check if this is the "next" link
      if (link.includes('rel="next"') || link.includes("rel='next'") || link.includes('rel=next')) {
        // Extract URL from <URL>
        const urlMatch = link.match(/<([^>]+)>/);
        if (urlMatch && urlMatch[1]) {
          // Extract page_info parameter
          const url = new URL(urlMatch[1]);
          const pageInfo = url.searchParams.get('page_info');
          return pageInfo;
        }
      }
    }

    return null;
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
   * Check if cached data exists (infinite cache - no expiry check)
   */
  private async getCachedOrders(cacheKey: string): Promise<ShopifyOrder[] | null> {
    try {
      const cached = await ShopifyOrderCache.findOne({ cacheKey });
      
      if (cached) {
        console.log(`Cache hit for ${cacheKey}, cached at ${cached.cachedAt}`);
        return cached.orders;
      }
      
      console.log(`Cache miss for ${cacheKey}`);
      return null;
    } catch (error) {
      console.error('Error fetching from cache:', error);
      return null;
    }
  }

  /**
   * Update cache with fresh data (infinite cache)
   */
  private async updateCache(cacheKey: string, orders: ShopifyOrder[]): Promise<void> {
    try {
      const now = new Date();
      // Set expiresAt to 100 years in the future (effectively infinite)
      const expiresAt = new Date(now.getTime() + (100 * 365 * 24 * 60 * 60 * 1000));
      
      await ShopifyOrderCache.findOneAndUpdate(
        { cacheKey },
        {
          orders,
          cachedAt: now,
          expiresAt,
        },
        { upsert: true, new: true }
      );
      
    } catch (error) {
      console.error('Error updating cache:', error);
      // Don't throw - caching is not critical
    }
  }

  /**
   * Clear all cached orders
   * Useful for forcing a refresh of Shopify data
   */
  async clearOrdersCache(): Promise<void> {
    try {
      await ShopifyOrderCache.deleteMany({});
      console.log('All order caches cleared');
    } catch (error) {
      console.error('Error clearing cache:', error);
      throw error;
    }
  }

  /**
   * Clear specific cache entry
   */
  async clearSpecificCache(cacheKey: string): Promise<void> {
    try {
      await ShopifyOrderCache.deleteOne({ cacheKey });
      console.log(`Cache cleared for ${cacheKey}`);
    } catch (error) {
      console.error('Error clearing specific cache:', error);
      throw error;
    }
  }

  /**
   * Get orders that contain the printed photos product
   * Fetches more orders and filters to only those with the product
   * Uses caching with 5-minute TTL
   */
  async getOrdersWithPrintedPhotos(limit: number = 50): Promise<ShopifyOrder[]> {
    try {
      const cacheKey = `printed_photos_${limit}`;
      
      // Try to get from cache first
      const cachedOrders = await this.getCachedOrders(cacheKey);
      if (cachedOrders) {
        return cachedOrders;
      }
      
      // Cache miss - fetch from Shopify
      console.log('Fetching orders from Shopify API...');
      
      // Fetch more orders than needed since we'll filter them
      const fetchLimit = Math.min(limit * 3, 250); // Shopify max is 250
      
      const data = await this.makeRequest<ShopifyOrdersResponse>(
        `/orders.json?status=any&limit=${fetchLimit}`
      );
      
      const allOrders = data.orders || [];
      
      // Filter to only orders containing the printed photos product
      const filteredOrders = allOrders.filter(order => this.orderContainsPrintedPhotos(order));
      
      // Return up to the requested limit
      const result = filteredOrders.slice(0, limit);
      
      // Update cache
      await this.updateCache(cacheKey, result);
      
      return result;
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
   * Get ALL recent orders (not filtered by product)
   * For sales tracking and general order management
   * Uses caching with 5-minute TTL
   */
  async getAllOrders(limit: number = 50, createdAtMin?: string): Promise<ShopifyOrder[]> {
    try {
      const cacheKey = createdAtMin ? `all_orders_${limit}_${createdAtMin}` : `all_orders_${limit}`;
      
      // Try to get from cache first
      const cachedOrders = await this.getCachedOrders(cacheKey);
      if (cachedOrders) {
        console.log(`Using cached orders: ${cachedOrders.length}`);
        return cachedOrders;
      }
      
      // Cache miss - fetch from Shopify with pagination using Link header
      console.log(`Fetching up to ${limit} orders from Shopify API${createdAtMin ? ` since ${createdAtMin}` : ''}...`);
      
      const allOrders: ShopifyOrder[] = [];
      const perPage = 250; // Shopify max per request
      let page = 1;
      let pageInfo: string | null = null;
      
      // Build initial request URL with filters
      // IMPORTANT: Filters (created_at_min) must be in the FIRST request only
      // Subsequent requests with page_info cannot include other params
      let initialParams = new URLSearchParams({
        status: 'any',
        limit: perPage.toString(),
      });
      
      if (createdAtMin) {
        // Shopify expects ISO 8601 format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS
        initialParams.append('created_at_min', createdAtMin);
      }
      
      // Fetch pages using cursor-based pagination with Link header
      while (allOrders.length < limit) {
        let url: string;
        
        if (page === 1) {
          // First request: use filters
          url = `/orders.json?${initialParams.toString()}`;
          console.log(`Fetching page ${page}: limit=${perPage}, created_at_min=${createdAtMin || 'none'}`);
        } else if (pageInfo) {
          // Subsequent requests: use page_info token from Link header
          // Can only include limit, no other params allowed
          url = `/orders.json?page_info=${pageInfo}&limit=${perPage}`;
          console.log(`Fetching page ${page}: using page_info token`);
        } else {
          // No more pages
          console.log('No page_info found, reached end');
          break;
        }
        
        const { data, linkHeader } = await this.makeRequestWithHeaders<ShopifyOrdersResponse>(url);
        const orders = data.orders || [];
        
        console.log(`Fetched page ${page}: ${orders.length} orders (total so far: ${allOrders.length + orders.length})`);
        
        if (orders.length === 0) {
          break; // No more orders
        }
        
        allOrders.push(...orders);
        
        // Parse page_info for next page from Link header
        pageInfo = this.parseNextPageInfo(linkHeader);
        
        if (pageInfo) {
          console.log(`Found next page_info token: ${pageInfo.substring(0, 20)}...`);
        } else {
          console.log('No next page_info found in Link header, reached end');
          break;
        }
        
        // If we got less than requested, we've reached the end
        if (orders.length < perPage) {
          console.log('Reached end of orders (got less than limit)');
          break;
        }
        
        // If we've collected enough orders, stop
        if (allOrders.length >= limit) {
          console.log(`Collected ${allOrders.length} orders, reached requested limit`);
          break;
        }
        
        page++;
        
        // Safety: max 10 pages (2500 orders)
        if (page > 10) {
          console.log('Reached max pages limit (10)');
          break;
        }
      }
      
      console.log(`Total fetched: ${allOrders.length} orders`);
      
      // Debug: Log date range of orders
      if (allOrders.length > 0) {
        const dates = allOrders.map(o => new Date(o.created_at).toISOString().split('T')[0]);
        const uniqueDates = [...new Set(dates)].sort();
        console.log(`Order dates range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`);
        console.log(`Total unique dates: ${uniqueDates.length}`);
        
        // Count orders per date
        const dateCounts: Record<string, number> = {};
        dates.forEach(d => {
          dateCounts[d] = (dateCounts[d] || 0) + 1;
        });
        console.log('Orders per date:', JSON.stringify(dateCounts, null, 2));
      }
      
      // Update cache
      await this.updateCache(cacheKey, allOrders);
      
      return allOrders;
    } catch (error) {
      console.error('Error fetching all orders:', error);
      throw error;
    }
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

  /**
   * Update a product's variants with new prices and compare_at_prices
   */
  async updateProductVariants(productId: string, variantUpdates: Array<{
    variantId: string;
    price?: string;
    compareAtPrice?: string | null;
  }>): Promise<any> {
    try {
      // First get the product to get current variant data
      const product = await this.getProduct(productId);
      
      if (!product) {
        throw new Error('Product not found');
      }

      // Map updates by variant ID for quick lookup
      const updatesMap = new Map(
        variantUpdates.map(update => [update.variantId, update])
      );

      // Update variants with new prices
      const updatedVariants = product.variants.map((variant: any) => {
        const update = updatesMap.get(String(variant.id));
        if (!update) {
          return variant; // Keep unchanged variants as-is
        }

        const updatedVariant: any = {
          id: variant.id,
          price: update.price !== undefined ? update.price : variant.price,
        };

        // Only include compare_at_price if explicitly set (including null to remove it)
        if (update.compareAtPrice !== undefined) {
          updatedVariant.compare_at_price = update.compareAtPrice;
        } else {
          // Keep existing compare_at_price if not specified
          if (variant.compare_at_price) {
            updatedVariant.compare_at_price = variant.compare_at_price;
          }
        }

        return updatedVariant;
      });

      // Update the product
      const updateData = {
        product: {
          id: productId,
          variants: updatedVariants,
        },
      };

      const result = await this.makeRequest<{ product: any }>(
        `/products/${productId}.json`,
        {
          method: 'PUT',
          body: updateData,
        }
      );

      return result.product;
    } catch (error) {
      console.error('Error updating product variants:', error);
      throw error;
    }
  }

  /**
   * Update delivery status for an order
   */
  async updateOrderDeliveryStatus(orderNumber: string, status: 'Delivered' | 'Failed'): Promise<{ success: boolean; error?: string }> {
    try {
      // Find the order first
      const order = await this.findOrderByNumber(orderNumber);
      
      if (!order) {
        return {
          success: false,
          error: `Order ${orderNumber} not found`,
        };
      }

      // Step 1: Get existing fulfillments
      const existingFulfillmentsResponse = await this.makeRequest<{ fulfillments: any[] }>(
        `/orders/${order.id}/fulfillments.json`,
        { method: 'GET' }
      );

      const existingFulfillments = existingFulfillmentsResponse.fulfillments || [];
      let fulfillmentId: number;

      if (existingFulfillments.length > 0) {
        // Use the latest fulfillment
        fulfillmentId = existingFulfillments[existingFulfillments.length - 1].id;
        console.log(`[Shopify] Using existing fulfillment ${fulfillmentId} for order ${orderNumber}`);
      } else {
        // Create a new fulfillment if none exists
        const fulfillmentOrdersResponse = await this.makeRequest<{ fulfillment_orders: any[] }>(
          `/orders/${order.id}/fulfillment_orders.json`,
          { method: 'GET' }
        );

        const fulfillmentOrders = fulfillmentOrdersResponse.fulfillment_orders;
        
        if (!fulfillmentOrders || fulfillmentOrders.length === 0) {
          return {
            success: false,
            error: 'No fulfillment orders found for this order',
          };
        }

        const fulfillmentOrder = fulfillmentOrders.find(
          (fo: any) => fo.status === 'open' || fo.status === 'in_progress'
        );

        if (!fulfillmentOrder) {
          return {
            success: false,
            error: 'No open fulfillment orders found. Order may already be fulfilled.',
          };
        }

        // Create a new fulfillment
        const fulfillmentData = {
          fulfillment: {
            line_items_by_fulfillment_order: [
              {
                fulfillment_order_id: fulfillmentOrder.id,
              },
            ],
            tracking_info: {
              company: 'Other',
              number: `MANUAL-${Date.now()}`,
              url: '',
            },
            notify_customer: false,
          },
        };

        const fulfillmentResponse = await this.makeRequest<{ fulfillment: any }>(
          `/fulfillments.json`,
          {
            method: 'POST',
            body: fulfillmentData,
          }
        );

        fulfillmentId = fulfillmentResponse.fulfillment.id;
        console.log(`[Shopify] Created new fulfillment ${fulfillmentId} for order ${orderNumber}`);
      }

      // Step 2: Create a fulfillment event to mark as delivered or failed
      // This is what actually updates the delivery status in Shopify!
      const eventStatus = status === 'Delivered' ? 'delivered' : 'failure';
      
      const eventData = {
        event: {
          status: eventStatus,
          message: `Order manually marked as ${status}`,
        },
      };

      await this.makeRequest<{ fulfillment_event: any }>(
        `/orders/${order.id}/fulfillments/${fulfillmentId}/events.json`,
        {
          method: 'POST',
          body: eventData,
        }
      );

      console.log(`[Shopify] Created fulfillment event '${eventStatus}' for order ${orderNumber}`);
      
      // Step 3: Also update note_attributes for backward compatibility
      const deliveryStatus = status.toLowerCase();
      const updateData = {
        order: {
          note_attributes: [
            {
              name: 'delivery_status',
              value: deliveryStatus,
            },
            {
              name: 'delivery_status_updated_at',
              value: new Date().toISOString(),
            },
          ],
        },
      };

      await this.makeRequest<{ order: any }>(
        `/orders/${order.id}.json`,
        {
          method: 'PUT',
          body: updateData,
        }
      );
      
      // Clear orders cache so the change is reflected
      await this.clearOrdersCache();

      return { success: true };
    } catch (error: any) {
      console.error('[Shopify] Error updating delivery status:', error.message || error);
      return {
        success: false,
        error: error.message || 'Failed to update delivery status',
      };
    }
  }

  /**
   * Bulk update prices for multiple products
   */
  async bulkUpdateProductPrices(
    productIds: number[],
    updates: {
      variant1Price?: string;
      variant1CompareAtPrice?: string | null;
      variant2Price?: string;
      variant2CompareAtPrice?: string | null;
      priceChangePercent?: number;
      priceChangeAmount?: number;
      updateType: 'set' | 'increase' | 'decrease';
    }
  ): Promise<Array<{ productId: number; success: boolean; error?: string }>> {
    const results: Array<{ productId: number; success: boolean; error?: string }> = [];

    for (const productId of productIds) {
      try {
        const product = await this.getProduct(String(productId));
        
        if (!product || !product.variants || product.variants.length === 0) {
          results.push({
            productId,
            success: false,
            error: 'Product not found or has no variants',
          });
          continue;
        }

        const variantUpdates: Array<{
          variantId: string;
          price?: string;
          compareAtPrice?: string | null;
        }> = [];

        if (updates.updateType === 'set') {
          // Set specific prices
          if (product.variants[0] && updates.variant1Price) {
            variantUpdates.push({
              variantId: String(product.variants[0].id),
              price: updates.variant1Price,
              compareAtPrice: updates.variant1CompareAtPrice,
            });
          }

          if (product.variants[1] && updates.variant2Price) {
            variantUpdates.push({
              variantId: String(product.variants[1].id),
              price: updates.variant2Price,
              compareAtPrice: updates.variant2CompareAtPrice,
            });
          }
        } else {
          // Increase or decrease all variants
          const isIncrease = updates.updateType === 'increase';

          for (const variant of product.variants) {
            let newPrice: number = parseFloat(variant.price || '0');
            let newCompareAtPrice: number | null = variant.compare_at_price 
              ? parseFloat(variant.compare_at_price) 
              : null;

            if (updates.priceChangePercent) {
              const percentChange = updates.priceChangePercent / 100;
              if (isIncrease) {
                newPrice = newPrice * (1 + percentChange);
                if (newCompareAtPrice !== null) {
                  newCompareAtPrice = newCompareAtPrice * (1 + percentChange);
                }
              } else {
                newPrice = newPrice * (1 - percentChange);
                if (newCompareAtPrice !== null) {
                  newCompareAtPrice = newCompareAtPrice * (1 - percentChange);
                }
              }
            } else if (updates.priceChangeAmount) {
              const amount = updates.priceChangeAmount;
              if (isIncrease) {
                newPrice = newPrice + amount;
                if (newCompareAtPrice !== null) {
                  newCompareAtPrice = newCompareAtPrice + amount;
                }
              } else {
                newPrice = Math.max(0, newPrice - amount);
                if (newCompareAtPrice !== null) {
                  newCompareAtPrice = Math.max(0, newCompareAtPrice - amount);
                }
              }
            }

            variantUpdates.push({
              variantId: String(variant.id),
              price: newPrice.toFixed(2),
              compareAtPrice: newCompareAtPrice !== null ? newCompareAtPrice.toFixed(2) : null,
            });
          }
        }

        if (variantUpdates.length > 0) {
          await this.updateProductVariants(String(productId), variantUpdates);
          results.push({ productId, success: true });
        } else {
          results.push({
            productId,
            success: false,
            error: 'No updates to apply',
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({
          productId,
          success: false,
          error: errorMessage,
        });
      }
    }

    return results;
  }
}

export default new ShopifyService();
