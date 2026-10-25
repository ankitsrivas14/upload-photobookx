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
   * Trims a Shopify order object to keep only the fields used by our application.
   * This is critical to keep the cache size under MongoDB's 16MB limit.
   */
  private trimOrderForCache(order: any): any {
    if (!order) return order;

    return {
      id: order.id,
      name: order.name,
      email: order.email,
      created_at: order.created_at,
      createdAt: order.created_at, // Map for frontend
      fulfillment_status: order.fulfillment_status,
      financial_status: order.financial_status,
      cancelled_at: order.cancelled_at,
      total_price: order.total_price,
      current_total_price: order.current_total_price,
      total_price_set: order.total_price_set,
      gateway: order.gateway,
      payment_gateway_names: order.payment_gateway_names,
      tags: order.tags,
      customer: order.customer ? {
        id: order.customer.id,
        email: order.customer.email,
        first_name: order.customer.first_name,
        last_name: order.customer.last_name,
        tags: order.customer.tags
      } : undefined,
      line_items: Array.isArray(order.line_items) ? order.line_items.map((li: any) => ({
        id: li.id,
        title: li.title,
        quantity: li.quantity,
        variant_title: li.variant_title,
        price: li.price,
        product_id: li.product_id,
        sku: li.sku
      })) : [],
      shipping_address: order.shipping_address ? {
        first_name: order.shipping_address.first_name,
        last_name: order.shipping_address.last_name,
        name: order.shipping_address.name,
        address1: order.shipping_address.address1,
        city: order.shipping_address.city,
        province: order.shipping_address.province,
        zip: order.shipping_address.zip,
        phone: order.shipping_address.phone
      } : undefined,
      fulfillments: Array.isArray(order.fulfillments) ? order.fulfillments.map((f: any) => ({
        id: f.id,
        status: f.status,
        shipment_status: f.shipment_status,
        tracking_company: f.tracking_company,
        tracking_number: f.tracking_number,
        tracking_url: f.tracking_url
      })) : []
    };
  }


  /**
   * Most recent orders that contain the printed photos product, newest first, from the
   * Firestore orders the syncs keep current.
   */
  async getRecentOrders(limit: number = 50): Promise<ShopifyOrder[]> {
    const { getAll } = await import('../db/ordersRepo');
    const orders = (await getAll()) as ShopifyOrder[];
    return orders.filter((order) => this.orderContainsPrintedPhotos(order)).slice(0, limit);
  }

  /**
   * Fetch orders created on/after `since` (or, with `field = 'updated'`, changed on/after it)
   * straight from Shopify (trimmed), WITHOUT touching the Mongo cache. Used by the lightweight
   * Firestore sync so order freshness never depends on reading/writing the ~15MB cache doc.
   */
  async fetchRecentOrders(since: string, maxOrders: number = 2000, field: 'created' | 'updated' = 'created'): Promise<any[]> {
    const perPage = 250;
    const all: any[] = [];
    let pageInfo: string | null = null;
    let first = true;
    while (all.length < maxOrders) {
      let url: string;
      if (first) {
        url = `/orders.json?status=any&limit=${perPage}&${field}_at_min=${encodeURIComponent(since)}`;
        first = false;
      } else if (pageInfo) {
        url = `/orders.json?page_info=${pageInfo}&limit=${perPage}`;
      } else {
        break;
      }
      const { data, linkHeader } = await this.makeRequestWithHeaders<ShopifyOrdersResponse>(url);
      const orders = data.orders || [];
      if (orders.length === 0) break;
      all.push(...orders);
      pageInfo = this.parseNextPageInfo(linkHeader);
      if (!pageInfo || orders.length < perPage) break;
    }
    return all.map((o) => this.trimOrderForCache(o));
  }

  // Products change rarely, so serve them from memory for a while instead of calling Shopify on
  // every page open (0.8–1.7 s). Any price update clears it (see updateProductVariants).
  private productsCache = new Map<number, { products: any[]; at: number }>();
  private static PRODUCTS_TTL_MS = 10 * 60 * 1000;

  /**
   * Get all products with their variants
   */
  async getProducts(limit: number = 50): Promise<any[]> {
    const cached = this.productsCache.get(limit);
    if (cached && Date.now() - cached.at < ShopifyService.PRODUCTS_TTL_MS) return cached.products;
    try {
      const data = await this.makeRequest<{ products: any[] }>(
        `/products.json?limit=${limit}`
      );

      const products = data.products || [];
      this.productsCache.set(limit, { products, at: Date.now() });
      return products;
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
    this.productsCache.clear();
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

      // Reflect the change in Firestore, which the pages read, without waiting for the
      // next order sync.
      const shipmentStatus = status === 'Delivered' ? 'delivered' : 'failure';
      try {
        const { patchStatusByName } = await import('../db/ordersRepo');
        await patchStatusByName(orderNumber, shipmentStatus);
      } catch (e) {
        console.error('[Firestore] mark patch failed (non-fatal):', e);
      }

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

  /**
   * Add a tag to a Shopify customer
   */
  async addCustomerTag(customerId: number, tag: string): Promise<{ success: boolean; error?: string }> {
    try {
      // First get current customer data to get existing tags
      const data = await this.makeRequest<{ customer: any }>(
        `/customers/${customerId}.json`
      );

      const customer = data.customer;
      if (!customer) {
        return {
          success: false,
          error: 'Customer not found',
        };
      }

      const existingTags = customer.tags || '';
      const tagsArray = existingTags.split(',').map((t: string) => t.trim()).filter((t: string) => t !== '');
      const hadTag = tagsArray.includes(tag);
      if (!hadTag) tagsArray.push(tag);
      const newTags = tagsArray.join(', ');

      if (!hadTag) {
        await this.makeRequest<{ customer: any }>(
          `/customers/${customerId}.json`,
          {
            method: 'PUT',
            body: {
              customer: {
                id: customerId,
                tags: newTags
              }
            }
          }
        );
      }

      // Orders keep a copy of their customer's tags; update it so the Sales page shows the
      // tag now instead of after those orders next change in Shopify.
      try {
        const { setCustomerTags } = await import('../db/ordersRepo');
        await setCustomerTags(customerId, hadTag ? existingTags : newTags);
      } catch (e) {
        console.error('[Firestore] customer tag patch failed (non-fatal):', e);
      }

      return { success: true };
    } catch (error: any) {
      console.error('[Shopify] Error adding customer tag:', error.message || error);
      return {
        success: false,
        error: error.message || 'Failed to add customer tag',
      };
    }
  }

  /**
   * Get daily sessions for a given date range using ShopifyQL
   */
  async getDailySessions(startDate: string, endDate: string): Promise<Record<string, number>> {
    try {
      const url = `https://${this.storeDomain}/admin/api/unstable/graphql.json`;
      const query = `
        query {
          shopifyqlQuery(query: "FROM sessions SHOW sessions TIMESERIES day SINCE ${startDate} UNTIL ${endDate}") {
            tableData {
              columns {
                name
                dataType
                displayName
              }
              rows
            }
            parseErrors
          }
        }
      `;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': this.accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[ShopifyQL] HTTP Error:', response.status, error);
        return {};
      }

      const json = await response.json() as any;
      if (json.errors) {
        console.error('[ShopifyQL] GraphQL Errors:', json.errors);
        return {};
      }

      const shopifyqlQuery = json.data?.shopifyqlQuery;
      if (shopifyqlQuery?.parseErrors && shopifyqlQuery.parseErrors.length > 0) {
        console.error('[ShopifyQL] Parse Errors:', shopifyqlQuery.parseErrors);
        return {};
      }

      const rows = shopifyqlQuery?.tableData?.rows || [];
      const sessionsByDate: Record<string, number> = {};

      for (const row of rows) {
        const dateKey = row.day;
        const sessionsCount = parseInt(row.sessions || '0', 10);
        if (dateKey) {
          sessionsByDate[dateKey] = sessionsCount;
        }
      }

      return sessionsByDate;
    } catch (error) {
      console.error('[ShopifyQL] Error fetching daily sessions:', error);
      return {};
    }
  }
}

export default new ShopifyService();
