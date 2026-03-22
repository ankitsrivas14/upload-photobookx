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
  customer_name?: string;
  customer_city?: string;
  customer_state?: string;
  customer_pincode?: string;
  customer_phone?: string;
  picked_up_date?: string;
  delivered_date?: string;
  first_out_for_delivery_date?: string;
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
  awb?: string;
  courier_name: string;
  courier?: string;
  status: string;
  weight: string;
  freight_charge?: number; // Shipping charge paid
  charge_weight?: number;
  volumetric_weight?: number;
  // Try alternative field names
  shipping_charges?: number;
  total_charge?: number;
  charged_weight?: string;
  cost?: number | string;
  pickup_date?: string;
  pickup_scheduled_date?: string;
  pickup_actual_date?: string;
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

      const data = await response.json() as ShiprocketAuthResponse;

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
      const searchQuery = awbCode || orderNumber.replace(/^#/, '');
      const response = await this.makeRequest<WalletTransactionResponse>(
        `/wallet/transactions?search=${encodeURIComponent(searchQuery)}&per_page=100`
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
      const normalizedRequested = channelOrderId.replace(/^#/, '');
      
      // 1. Try Primary Order
      const response = await this.makeRequest<ShiprocketOrderResponse>(
        `/orders?search=${encodeURIComponent(normalizedRequested)}`
      );

      if (response.data && response.data.length > 0) {
        // IMPORTANT: Verify Shiprocket actually matched the ID (it often ignores the filter)
        const match = response.data.find((o: any) => {
          const srId = (o.channel_order_id || '').replace(/^#/, '');
          return srId === normalizedRequested;
        });
        if (match) return match;
      }

      // 2. Try Clone Order (-C)
      if (!channelOrderId.endsWith('-C')) {
        const cloneId = normalizedRequested + '-C';
        console.log(`[Shiprocket] Primary order ${channelOrderId} not matched. Trying clone: ${cloneId}`);
        const cloneResponse = await this.makeRequest<ShiprocketOrderResponse>(
          `/orders?search=${encodeURIComponent(cloneId)}`
        );
        
        if (cloneResponse.data && cloneResponse.data.length > 0) {
          const cloneMatch = cloneResponse.data.find((o: any) => {
            const srId = (o.channel_order_id || '').replace(/^#/, '');
            return srId === cloneId;
          });
          if (cloneMatch) {
            console.log(`[Shiprocket] Found valid clone order for ${channelOrderId}: ${cloneId}`);
            return cloneMatch;
          }
        }
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
      if (existing && existing.pickupDate) {
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
          const searchStr = `${txn.type || ''} ${txn.description || ''} ${(txn as any).sub_category || ''} ${(txn as any).category || ''}`.toLowerCase();

          if (searchStr.includes('freight forward') || searchStr.includes('forward charges')) {
            freightForward += amount;
          } else if (searchStr.includes('freight cod') || searchStr.includes('cod charges')) {
            // COD can be positive (reversed) or negative (applied)
            freightCOD += txn.amount; // Keep sign
          } else if (searchStr.includes('freight rto') || searchStr.includes('rto charges') || searchStr.includes('rto')) {
            freightRTO += amount;
          } else if (searchStr.includes('whatsapp')) {
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

      // We now store even if total charge is 0 to save customer city/state data
      // if (totalShippingCost === 0) {
      //   return null;
      // }

      // Update or store in database with full breakdown
      await ShippingCharge.findOneAndUpdate(
        { orderNumber },
        {
          shippingCharge: totalShippingCost,
          freightForward,
          freightCOD,
          freightRTO,
          whatsappCharges,
          otherCharges,
          shiprocketOrderId: shiprocketOrder.id,
          shopifyOrderId: (shiprocketOrder as any).api_order_id || (shiprocketOrder as any).others?.api_order_id,
          awbCode,
          courierName: shipment.courier_name || shipment.courier,
          weight: parseFloat(shipment.weight) || undefined,
          status: shipment.status?.toString(),
          pickupDate: this.isValidDate(shiprocketOrder.picked_up_date)
            ? shiprocketOrder.picked_up_date
            : (this.isValidDate(shipment.pickup_actual_date)
              ? shipment.pickup_actual_date
              : (this.isStatusPickedUp(shipment.status?.toString()) && this.isValidDate(shipment.pickup_date)
                ? shipment.pickup_date
                : undefined)),
          deliveredDate: this.parseShiprocketDate(shiprocketOrder.delivered_date),
          firstAttemptDate: this.parseShiprocketDate(shiprocketOrder.first_out_for_delivery_date),
          customerName: shiprocketOrder.customer_name,
          customerCity: shiprocketOrder.customer_city,
          customerState: shiprocketOrder.customer_state,
          customerPincode: shiprocketOrder.customer_pincode,
          customerPhone: shiprocketOrder.customer_phone || (shiprocketOrder as any).customer_mobile,
          fetchedAt: new Date(),
        },
        { upsert: true }
      );

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

    // Step 2: Fetch recent wallet transactions in bulk (last 30 days) to avoid individual calls
    // This is much faster and stays under rate limits
    const allWalletTransactions = await this.getAllWalletTransactions();
    
    // Group transactions by AWB and order ID
    const txnMap = new Map<string, WalletTransaction[]>();
    allWalletTransactions.forEach(txn => {
      const keys = [txn.awb, txn.order_id, txn.description].filter(Boolean);
      keys.forEach(key => {
        if (!key) return;
        const normalized = key.toString().replace(/^#/, '');
        if (!txnMap.has(normalized)) txnMap.set(normalized, []);
        txnMap.get(normalized)!.push(txn);
      });
    });

    // Step 3: Process orders in batches (parallel processing for individual fallbacks if needed)
    const batchSize = 10;
    let fetched = 0;
    let skipped = 0;

    const terminalStatuses = [
      '7', '12', '13', '15', '16', '17', '18', '19', '20', '42', '46', 
      'delivered', 'canceled', 'cancelled', 'rto delivered', 'rto acknowledged', 
      'rto initiated', 'rto in transit', 'failure', 'failed', 'rto'
    ];

    for (let i = 0; i < orderNumbers.length; i += batchSize) {
      const batch = orderNumbers.slice(i, i + batchSize);

      await Promise.all(batch.map(async (orderNumber) => {
        try {
          const normalizedOrderNumber = orderNumber.replace(/^#/, '');
          
          // Check if already exists in DB and has reached a terminal state
          const existing = await ShippingCharge.findOne({ orderNumber });
          if (existing) {
            const hasDelivered = !!existing.deliveredDate;
            const statusStr = existing.status?.toString().toLowerCase() || '';
            const isTerminal = hasDelivered || terminalStatuses.includes(statusStr);

            // Skip terminal orders if they have a good charge OR were recently fetched
            const FIX_DATE = new Date('2026-03-21T00:00:00Z');
            const wasFetchedAfterFix = existing.fetchedAt && new Date(existing.fetchedAt) >= FIX_DATE;
            
            if (isTerminal && (existing.shippingCharge > 0 || wasFetchedAfterFix)) {
              skipped++;
              return;
            }
          }

          // Get from pre-fetched map or fetch individually if older
          let shiprocketOrder = shiprocketOrdersMap.get(orderNumber) || shiprocketOrdersMap.get(normalizedOrderNumber);
          if (!shiprocketOrder) {
            shiprocketOrder = await this.getOrderByChannelOrderId(orderNumber) || undefined;
          }
          
          if (!shiprocketOrder || !shiprocketOrder.shipments || shiprocketOrder.shipments.length === 0) {
            // Create a placeholder record so we don't keep retrying orders not on Shiprocket
            await ShippingCharge.findOneAndUpdate(
              { orderNumber },
              { shippingCharge: 0, fetchedAt: new Date(), status: 'not found' },
              { upsert: true }
            );
            return;
          }

          const shipment = shiprocketOrder.shipments[0];
          const awbCode = shipment.awb_code || shipment.awb || '';

          let freightForward = 0;
          let freightCOD = 0;
          let freightRTO = 0;
          let whatsappCharges = 0;
          let otherCharges = 0;

          // Use our bulk transaction map first (FAST)
          const transactions = (awbCode ? txnMap.get(awbCode) : null) || txnMap.get(normalizedOrderNumber) || [];

          if (transactions.length > 0) {
            // Parse transactions for detailed breakdown
            transactions.forEach(txn => {
              const amount = Math.abs(txn.amount);
              const searchStr = `${txn.type || ''} ${txn.description || ''} ${(txn as any).sub_category || ''} ${(txn as any).category || ''}`.toLowerCase();

              if (searchStr.includes('freight forward') || searchStr.includes('forward charges')) {
                freightForward += amount;
              } else if (searchStr.includes('freight cod') || searchStr.includes('cod charges')) {
                freightCOD += txn.amount; // Keep sign for reversals
              } else if (searchStr.includes('freight rto') || searchStr.includes('rto charges') || searchStr.includes('rto')) {
                freightRTO += amount;
              } else if (searchStr.includes('whatsapp')) {
                whatsappCharges += amount;
              } else {
                otherCharges += amount;
              }
            });
          } else if (awbCode) {
            // Only if not in bulk map, try individual fetch (SLOWER - fallback)
            const individualTxns = await this.getWalletTransactionsForOrder(awbCode, orderNumber);
            if (individualTxns.length > 0) {
              individualTxns.forEach(txn => {
                const amount = Math.abs(txn.amount);
                const searchStr = `${txn.type || ''} ${txn.description || ''} ${(txn as any).sub_category || ''} ${(txn as any).category || ''}`.toLowerCase();
                if (searchStr.includes('freight forward')) freightForward += amount;
                else if (searchStr.includes('freight cod')) freightCOD += txn.amount;
                else if (searchStr.includes('freight rto')) freightRTO += amount;
                else if (searchStr.includes('whatsapp')) whatsappCharges += amount;
                else otherCharges += amount;
              });
            }
          }

          // Fallback to AWB charges if no wallet transactions found anywhere
          if (freightForward === 0 && freightCOD === 0 && freightRTO === 0) {
            if (shiprocketOrder.awb_data?.charges) {
              const charges = shiprocketOrder.awb_data.charges;
              const totalFreight = parseFloat(charges.freight_charges as any) || 0;
              const codComponent = parseFloat(charges.cod_charges as any) || 0;
              freightForward = totalFreight - codComponent;
              freightCOD = codComponent;
              freightRTO = parseFloat(charges.applied_weight_amount_rto as any) || 0;
            }

            if (freightForward === 0 && shipment.cost) {
              freightForward = parseFloat(shipment.cost as any) || 0;
            }
          }

          const totalShippingCost = freightForward + freightCOD + freightRTO + whatsappCharges + otherCharges;

          const detectedPickupDate = this.isValidDate(shiprocketOrder.picked_up_date)
            ? shiprocketOrder.picked_up_date
            : (this.isValidDate(shipment.pickup_actual_date)
              ? shipment.pickup_actual_date
              : (this.isStatusPickedUp(shipment.status?.toString()) && this.isValidDate(shipment.pickup_date)
                ? shipment.pickup_date
                : undefined));

          await ShippingCharge.findOneAndUpdate(
            { orderNumber },
            {
              shippingCharge: totalShippingCost,
              freightForward,
              freightCOD,
              freightRTO,
              whatsappCharges,
              otherCharges,
              shiprocketOrderId: shiprocketOrder.id,
              shopifyOrderId: (shiprocketOrder as any).api_order_id || (shiprocketOrder as any).others?.api_order_id,
              awbCode,
              courierName: shipment.courier_name || shipment.courier,
              weight: parseFloat(shipment.weight) || undefined,
              status: shipment.status?.toString(),
              pickupDate: detectedPickupDate,
              deliveredDate: this.parseShiprocketDate(shiprocketOrder.delivered_date),
              firstAttemptDate: this.parseShiprocketDate(shiprocketOrder.first_out_for_delivery_date),
              customerName: shiprocketOrder.customer_name,
              customerCity: shiprocketOrder.customer_city,
              customerState: shiprocketOrder.customer_state,
              customerPincode: shiprocketOrder.customer_pincode,
              customerPhone: shiprocketOrder.customer_phone || (shiprocketOrder as any).customer_mobile,
              fetchedAt: new Date(),
            },
            { upsert: true }
          );
          fetched++;
        } catch (error) {
          console.error(`[Shiprocket] Error processing ${orderNumber}:`, error);
        }
      }));

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
        },
        pickupDate: charge.pickupDate,
        deliveredDate: charge.deliveredDate,
        firstAttemptDate: charge.firstAttemptDate,
        courierName: charge.courierName,
        customerName: charge.customerName,
        customerCity: charge.customerCity,
        customerState: charge.customerState,
        customerPincode: charge.customerPincode,
        customerPhone: charge.customerPhone,
        fetchedAt: charge.fetchedAt,
      });
    });

    return shippingChargesMap;
  }
  /**
   * Check if the shipment status indicates that pickup has likely occurred
   */
  private isStatusPickedUp(statusStr: string | undefined): boolean {
    if (!statusStr) return false;
    const status = statusStr.toLowerCase();

    // Statuses that mean pickup HAS NOT HAPPENED yet
    const awaitingPickup = [
      'confirmed',
      'awb assigned',
      'ready to ship',
      'label generated',
      'pickup scheduled',
      'pickup queued',
      'manifest generated',
      '1', '2', '3', '4' // Common early status codes
    ];

    return !awaitingPickup.some(s => status.includes(s));
  }

  /**
   * Validate if a date string is actually a valid date and not junk like "0000-00-00"
   */
  private isValidDate(dateStr: string | undefined): boolean {
    if (!dateStr) return false;
    if (dateStr.startsWith('0000-00-00')) return false;
    const date = new Date(dateStr);
    return !isNaN(date.getTime());
  }

  /**
   * Parse shiprocket dates which might be DD-MM-YYYY HH:mm:ss or YYYY-MM-DD HH:mm:ss
   */
  private parseShiprocketDate(dateStr: string | undefined): string | undefined {
    if (!dateStr) return undefined;
    if (dateStr.startsWith('0000-00-00')) return undefined;
    // Check if format is DD-MM-YYYY
    const parts = dateStr.split(' ');
    if (parts.length > 0 && parts[0].includes('-')) {
      const dateParts = parts[0].split('-');
      // If year is the last part (DD-MM-YYYY)
      if (dateParts[2] && dateParts[2].length === 4) {
        const isoStr = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}${parts[1] ? ' ' + parts[1] : ''}`;
        const date = new Date(isoStr);
        return isNaN(date.getTime()) ? undefined : isoStr;
      }
    }
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? undefined : dateStr;
  }
  /**
   * Fetch tracking activities for a specific AWB
   */
  async getAWBTrackingActivities(awbCode: string) {
    try {
      const response = await this.makeRequest<any>(`/courier/track/awb/${awbCode}`);
      return response;
    } catch (error) {
      console.error(`Error fetching tracking for AWB ${awbCode}:`, error);
      return null;
    }
  }
}

export default new ShiprocketService();
