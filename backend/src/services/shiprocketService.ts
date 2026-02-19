import config from '../config';
import ShippingCharge from '../models/ShippingCharge';

interface ShiprocketAuthResponse {
  token: string;
}

interface ShiprocketOrderResponse {
  data: ShiprocketOrder[];
}

interface ShiprocketOrder {
  id: number;
  channel_order_id: string; // Shopify order number
  order_id: number;
  shipments: ShiprocketShipment[];
  awb_data?: {
    charges?: {
      freight_charges?: string | number;
      cod_charges?: string | number;
      applied_weight_amount?: string | number;
      charged_weight_amount_rto?: string | number;
      applied_weight_amount_rto?: string | number;
    };
  };
}

interface WalletTransaction {
  id: number;
  type: string; // e.g., "Freight Forward", "Freight COD", "Freight RTO", "WhatsApp Communication"
  amount: number; // Positive = credit, Negative = debit
  balance: number;
  description: string;
  awb?: string;
  order_id?: string;
  created_at: string;
}

interface WalletTransactionResponse {
  data: WalletTransaction[];
}

interface ShiprocketShipment {
  id: number;
  awb_code: string;
  courier_name: string;
  status: string;
  weight: string;
  freight_charge?: number; // Shipping charge paid
  charge_weight?: number;
  volumetric_weight?: number;
  // Try alternative field names
  shipping_charges?: number;
  total_charge?: number;
  charged_weight?: string;
}

/**
 * Service for interacting with Shiprocket API
 */
class ShiprocketService {
  private email: string;
  private password: string;
  private baseUrl: string = 'https://apiv2.shiprocket.in/v1/external';
  private token: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor() {
    this.email = config.shiprocket.email;
    this.password = config.shiprocket.password;
  }

  /**
   * Authenticate and get access token
   * Token is valid for 10 days (240 hours)
   */
  private async authenticate(): Promise<string> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: this.email,
          password: this.password,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Shiprocket Auth Error: ${response.status} - ${error}`);
      }

      const data: ShiprocketAuthResponse = await response.json();
      
      this.token = data.token;
      this.tokenExpiry = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      
      return this.token;
    } catch (error) {
      console.error('Shiprocket authentication failed:', error);
      throw error;
    }
  }

  /**
   * Get valid token (auto-refresh if expired)
   */
  private async getToken(): Promise<string> {
    // If no token or token expired, authenticate
    if (!this.token || !this.tokenExpiry || new Date() >= this.tokenExpiry) {
      return await this.authenticate();
    }
    return this.token;
  }

  /**
   * Make authenticated request to Shiprocket API
   */
  private async makeRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const token = await this.getToken();
    
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Shiprocket API Error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Get all wallet transactions for a date range (bulk fetch for month)
   * Returns all transactions so frontend can filter/match
   */
  async getAllWalletTransactions(startDate?: string, endDate?: string): Promise<WalletTransaction[]> {
    try {
      const allTransactions: WalletTransaction[] = [];
      let page = 1;
      const perPage = 100;
      const maxPages = 20; // Max 2000 transactions (recent ones)
      
      console.log(`[Shiprocket] Fetching recent wallet transactions (no date filter - endpoint limitation)`);
      
      while (page <= maxPages) {
        // Try without date filters as the endpoint might not support them
        const queryParams = `page=${page}&per_page=${perPage}`;
        
        const response = await this.makeRequest<WalletTransactionResponse>(
          `/wallet/transactions?${queryParams}`
        );

        if (!response.data || response.data.length === 0) {
          break;
        }

        allTransactions.push(...response.data);
        
        // If we got less than perPage, we've reached the end
        if (response.data.length < perPage) {
          break;
        }
        
        page++;
      }

      console.log(`[Shiprocket] Fetched ${allTransactions.length} wallet transactions`);
      
      // Filter by date range on the client side if dates provided
      if (startDate || endDate) {
        const filtered = allTransactions.filter(txn => {
          const txnDate = txn.created_at ? new Date(txn.created_at).toISOString().split('T')[0] : null;
          if (!txnDate) return false;
          
          if (startDate && txnDate < startDate) return false;
          if (endDate && txnDate > endDate) return false;
          
          return true;
        });
        
        console.log(`[Shiprocket] Filtered to ${filtered.length} transactions between ${startDate || 'start'} and ${endDate || 'end'}`);
        return filtered;
      }
      
      return allTransactions;
    } catch (error: any) {
      // 404 means endpoint doesn't exist or no access
      if (error?.message?.includes('404')) {
        console.log('[Shiprocket] Wallet transactions API not available (404) - this feature requires Shiprocket API access');
        return [];
      }
      console.error(`Error fetching wallet transactions:`, error);
      return [];
    }
  }

  /**
   * Get wallet transactions for an AWB/Order to get detailed charge breakdown
   * Note: Returns empty array for unshipped orders (404 expected)
   */
  async getWalletTransactionsForOrder(awbCode: string, orderNumber: string): Promise<WalletTransaction[]> {
    try {
      // Try to fetch wallet transactions
      // This endpoint might be /wallet/transactions or /billing/transactions
      // We'll search by AWB code or order number
      const response = await this.makeRequest<WalletTransactionResponse>(
        `/wallet/transactions?search=${encodeURIComponent(orderNumber)}&per_page=100`
      );

      if (response.data && response.data.length > 0) {
        // Filter transactions related to this order/AWB
        return response.data.filter(txn => 
          txn.order_id === orderNumber || 
          txn.awb === awbCode ||
          txn.description?.includes(orderNumber) ||
          txn.description?.includes(awbCode)
        );
      }

      return [];
    } catch (error: any) {
      // 404 is expected for orders not yet shipped/billed - silently ignore
      if (error?.message?.includes('404')) {
        return [];
      }
      // Log other errors
      console.error(`Error fetching wallet transactions for ${orderNumber}:`, error);
      return [];
    }
  }

  /**
   * Get all recent orders in bulk and create a map by channel_order_id
   * Much faster than fetching orders one by one
   */
  async getAllRecentOrdersMap(maxOrders: number = 500): Promise<Map<string, ShiprocketOrder>> {
    const orderMap = new Map<string, ShiprocketOrder>();
    
    try {
      let page = 1;
      const perPage = 50;
      const maxPages = Math.ceil(maxOrders / perPage);
      let totalFetched = 0;
      
      console.log(`[Shiprocket] Fetching up to ${maxOrders} recent orders in bulk...`);
      
      while (page <= maxPages && totalFetched < maxOrders) {
        const response = await this.makeRequest<ShiprocketOrderResponse>(
          `/orders?page=${page}&per_page=${perPage}`
        );

        if (!response.data || response.data.length === 0) {
          break;
        }

        // Add all orders to map
        for (const order of response.data) {
          const channelOrderId = order.channel_order_id;
          if (channelOrderId) {
            // Store with and without # prefix for easy lookup
            orderMap.set(channelOrderId, order);
            orderMap.set(channelOrderId.replace(/^#/, ''), order);
            if (!channelOrderId.startsWith('#')) {
              orderMap.set(`#${channelOrderId}`, order);
            }
          }
          totalFetched++;
        }
        
        // If we got less than perPage orders, we've reached the end
        if (response.data.length < perPage) {
          break;
        }
        
        page++;
      }

      console.log(`[Shiprocket] Fetched ${totalFetched} orders, mapped ${orderMap.size} lookup keys`);
      return orderMap;
    } catch (error) {
      console.error(`Error fetching bulk Shiprocket orders:`, error);
      return orderMap;
    }
  }

  /**
   * Get order details by channel order ID (Shopify order number)
   * Tries multiple formats: as-is, with #, without #
   */
  async getOrderByChannelOrderId(channelOrderId: string): Promise<ShiprocketOrder | null> {
    try {
      // Normalize the order number (remove # prefix if present)
      const normalizedOrderId = channelOrderId.replace(/^#/, '');
      
      // Shiprocket's channel_order_id filter doesn't work properly!
      // Fetch recent orders and search through them manually
      let page = 1;
      const perPage = 50;
      const maxPages = 10; // Search through max 500 orders
      
      while (page <= maxPages) {
        const response = await this.makeRequest<ShiprocketOrderResponse>(
          `/orders?page=${page}&per_page=${perPage}`
        );

        if (!response.data || response.data.length === 0) {
          break;
        }

        // Search through this page for matching order
        for (const order of response.data) {
          const orderChannelId = order.channel_order_id;
          
          // Check if this order matches (with or without # prefix)
          if (orderChannelId === normalizedOrderId || 
              orderChannelId === `#${normalizedOrderId}` ||
              orderChannelId === channelOrderId) {
            return order;
          }
        }
        
        // If we got less than perPage orders, we've reached the end
        if (response.data.length < perPage) {
          break;
        }
        
        page++;
      }

      return null;
    } catch (error) {
      console.error(`Error fetching Shiprocket order ${channelOrderId}:`, error);
      return null;
    }
  }

  /**
   * Fetch and store shipping charge for an order
   */
  async fetchShippingChargeForOrder(orderNumber: string): Promise<number | null> {
    try {
      // Check if we already have shipping charge for this order
      const existing = await ShippingCharge.findOne({ orderNumber });
      if (existing) {
        return existing.shippingCharge;
      }

      // Fetch from Shiprocket
      const shiprocketOrder = await this.getOrderByChannelOrderId(orderNumber);
      
      if (!shiprocketOrder || !shiprocketOrder.shipments || shiprocketOrder.shipments.length === 0) {
        return null;
      }

      const shipment = shiprocketOrder.shipments[0];
      const awbCode = shipment.awb_code || shipment.awb || '';
      
      // Try to get detailed charge breakdown from wallet transactions
      let freightForward = 0;
      let freightCOD = 0;
      let freightRTO = 0;
      let whatsappCharges = 0;
      let otherCharges = 0;
      
      // Fetch wallet transactions for this order
      const transactions = await this.getWalletTransactionsForOrder(awbCode, orderNumber);
      
      if (transactions.length > 0) {
        // Parse transactions to extract charges
        transactions.forEach(txn => {
          const amount = Math.abs(txn.amount); // Use absolute value
          const type = txn.type?.toLowerCase() || '';
          
          if (type.includes('freight forward')) {
            freightForward += amount;
          } else if (type.includes('freight cod')) {
            // COD can be positive (reversed) or negative (applied)
            freightCOD += txn.amount; // Keep sign
          } else if (type.includes('freight rto') || type.includes('rto')) {
            freightRTO += amount;
          } else if (type.includes('whatsapp')) {
            whatsappCharges += amount;
          } else {
            otherCharges += amount;
          }
        });
      } else {
        // Fallback to awb_data.charges if no wallet transactions found
        if (shiprocketOrder.awb_data?.charges) {
          const charges = shiprocketOrder.awb_data.charges;
          const totalFreight = parseFloat(charges.freight_charges as any) || 0;
          const codComponent = parseFloat(charges.cod_charges as any) || 0;
          
          // freight_charges INCLUDES COD, so extract base freight
          freightForward = totalFreight - codComponent;
          freightCOD = codComponent;
          freightRTO = parseFloat(charges.applied_weight_amount_rto as any) || 0;
        }
        
        // Last fallback: use shipment.cost
        if (freightForward === 0 && shipment.cost) {
          freightForward = parseFloat(shipment.cost as any) || 0;
        }
      }
      
      // Calculate total shipping cost
      // Base Freight + COD + RTO + WhatsApp + Other
      // COD will be reversed in frontend for RTO COD orders
      const totalShippingCost = freightForward + freightCOD + freightRTO + whatsappCharges + otherCharges;

      // Don't store if total charge is 0
      if (totalShippingCost === 0) {
        return null;
      }

      // Store in database with full breakdown
      const saved = await ShippingCharge.create({
        orderNumber,
        shippingCharge: totalShippingCost,
        freightForward,
        freightCOD,
        freightRTO,
        whatsappCharges,
        otherCharges,
        shiprocketOrderId: shiprocketOrder.id,
        awbCode,
        courierName: shipment.courier_name || shipment.courier,
        weight: parseFloat(shipment.weight) || undefined,
        status: shipment.status?.toString(),
        fetchedAt: new Date(),
      });

      return totalShippingCost;
    } catch (error) {
      console.error(`Error fetching shipping charge for ${orderNumber}:`, error);
      return null;
    }
  }

  /**
   * Fetch shipping charges for multiple orders
   * Only fetches for orders that don't have shipping charges yet
   */
  async fetchShippingChargesForOrders(orderNumbers: string[]): Promise<Map<string, number>> {
    const shippingCharges = new Map<string, number>();

    // Get existing shipping charges from DB
    const existingCharges = await ShippingCharge.find({
      orderNumber: { $in: orderNumbers }
    });

    existingCharges.forEach(charge => {
      shippingCharges.set(charge.orderNumber, charge.shippingCharge);
    });

    return shippingCharges;
  }

  /**
   * Bulk fetch shipping charges for multiple orders (FAST with parallel wallet transactions)
   * Fetches all Shiprocket orders once, then fetches wallet transactions in parallel
   */
  async bulkFetchShippingCharges(orderNumbers: string[]): Promise<{ fetched: number; skipped: number }> {
    console.log(`[Shiprocket] Starting bulk fetch for ${orderNumbers.length} orders`);
    
    // Step 1: Fetch all recent Shiprocket orders in bulk
    const shiprocketOrdersMap = await this.getAllRecentOrdersMap(1000);
    
    // Step 2: Process orders in batches of 5 (parallel processing with wallet transactions)
    const batchSize = 5; // Smaller batches since we're calling wallet API
    let fetched = 0;
    let skipped = 0;
    
    for (let i = 0; i < orderNumbers.length; i += batchSize) {
      const batch = orderNumbers.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (orderNumber) => {
        try {
          // Check if already exists in DB
          const existing = await ShippingCharge.findOne({ orderNumber });
          if (existing) {
            skipped++;
            return;
          }
          
          // Get from pre-fetched map
          const shiprocketOrder = shiprocketOrdersMap.get(orderNumber);
          if (!shiprocketOrder || !shiprocketOrder.shipments || shiprocketOrder.shipments.length === 0) {
            return;
          }
          
          const shipment = shiprocketOrder.shipments[0];
          const awbCode = shipment.awb_code || shipment.awb || '';
          
          let freightForward = 0;
          let freightCOD = 0;
          let freightRTO = 0;
          let whatsappCharges = 0;
          let otherCharges = 0;
          
          // Try wallet transactions if AWB exists (shipped orders)
          if (awbCode) {
            const transactions = await this.getWalletTransactionsForOrder(awbCode, orderNumber);
            
            if (transactions.length > 0) {
              // Parse transactions for detailed breakdown
              transactions.forEach(txn => {
                const amount = Math.abs(txn.amount);
                const type = txn.type?.toLowerCase() || '';
                
                if (type.includes('freight forward')) {
                  freightForward += amount;
                } else if (type.includes('freight cod')) {
                  freightCOD += txn.amount; // Keep sign for reversals
                } else if (type.includes('freight rto') || type.includes('rto')) {
                  freightRTO += amount;
                } else if (type.includes('whatsapp')) {
                  whatsappCharges += amount;
                } else {
                  otherCharges += amount;
                }
              });
            }
          }
          
          // Fallback to AWB charges if no wallet transactions
          if (freightForward === 0 && freightCOD === 0 && freightRTO === 0) {
            if (shiprocketOrder.awb_data?.charges) {
              const charges = shiprocketOrder.awb_data.charges;
              const totalFreight = parseFloat(charges.freight_charges as any) || 0;
              const codComponent = parseFloat(charges.cod_charges as any) || 0;
              
              // freight_charges INCLUDES COD, so we need to extract base freight
              // Base Freight = Total Freight - COD Component
              freightForward = totalFreight - codComponent;
              freightCOD = codComponent;
              freightRTO = parseFloat(charges.applied_weight_amount_rto as any) || 0;
            }
            
            // Last fallback: shipment.cost
            if (freightForward === 0 && shipment.cost) {
              freightForward = parseFloat(shipment.cost as any) || 0;
            }
          }
          
          // Calculate total: Base Freight + COD + RTO + Other
          // Note: COD will be reversed in frontend for RTO orders
          const totalShippingCost = freightForward + freightCOD + freightRTO + whatsappCharges + otherCharges;
          
          // Only store if > 0
          if (totalShippingCost > 0) {
            await ShippingCharge.create({
              orderNumber,
              shippingCharge: totalShippingCost,
              freightForward,
              freightCOD,
              freightRTO,
              whatsappCharges,
              otherCharges,
              shiprocketOrderId: shiprocketOrder.id,
              awbCode,
              courierName: shipment.courier_name || shipment.courier,
              weight: parseFloat(shipment.weight) || undefined,
              status: shipment.status?.toString(),
              fetchedAt: new Date(),
            });
            fetched++;
          }
        } catch (error) {
          console.error(`[Shiprocket] Error processing ${orderNumber}:`, error);
        }
      }));
      
      // Log progress every batch
      console.log(`[Shiprocket] Progress: ${Math.min(i + batchSize, orderNumbers.length)}/${orderNumbers.length} orders processed`);
    }
    
    console.log(`[Shiprocket] Bulk fetch complete: ${fetched} fetched, ${skipped} skipped`);
    return { fetched, skipped };
  }

  /**
   * Get shipping charges from database only (no API calls)
   * Returns full shipping charge objects with breakdown
   */
  async getShippingCharges(orderNumbers: string[]): Promise<Map<string, any>> {
    const charges = await ShippingCharge.find({
      orderNumber: { $in: orderNumbers }
    });

    const shippingChargesMap = new Map<string, any>();
    charges.forEach(charge => {
      shippingChargesMap.set(charge.orderNumber, {
        shippingCharge: charge.shippingCharge,
        breakdown: {
          freightForward: charge.freightForward || 0,
          freightCOD: charge.freightCOD || 0,
          freightRTO: charge.freightRTO || 0,
          whatsappCharges: charge.whatsappCharges || 0,
          otherCharges: charge.otherCharges || 0,
        }
      });
    });

    return shippingChargesMap;
  }
}

export default new ShiprocketService();
