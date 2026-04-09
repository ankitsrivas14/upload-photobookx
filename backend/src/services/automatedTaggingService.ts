import shopifyService from './shopifyService';
import { RTOOrder, ProcessedNoCodOrder, TaggingJobLog } from '../models';
import { ShopifyOrder } from '../types';

class AutomatedTaggingService {
    private isRunning = false;

    /**
     * Run the tagging job manually
     * This processes orders and tags customers as "no-cod" if delivery failed or was attempted.
     */
    public async runTaggingJob() {
        if (this.isRunning) {
            console.log('Skipping tagging job, already running');
            return;
        }

        this.isRunning = true;
        const startTime = new Date();
        const taggedCustomersList: Array<{ customerId: number; orderNumber: string; customerName?: string }> = [];
        const processedOrderIds: number[] = [];

        try {
            console.log('🔍 Running refined tagging job for failed/attempted orders...');

            // 1. Fetch ALL recent orders from cache (limit 10000 to cover full history)
            // The cache should be fresh if syncOrders was called just before this.
            const orders = await shopifyService.getAllOrders(10000);
            console.log(`Analyzing ${orders.length} orders from cache...`);

            // 2. Get all RTO order IDs from our database
            const rtoOrders = await RTOOrder.find({}, { shopifyOrderId: 1 });
            const rtoOrderIds = new Set(rtoOrders.map(o => o.shopifyOrderId));

            // 3. Get all orders already processed for no-cod tagging
            const processedNoCod = await ProcessedNoCodOrder.find({}, { shopifyOrderId: 1 });
            const processedNoCodIds = new Set(processedNoCod.map(o => o.shopifyOrderId));

            for (const order of orders) {
                if (!order.customer) continue;
                
                // Skip if this specific order was already used to tag the customer (prevent redundant DB/API work)
                if (processedNoCodIds.has(order.id)) continue;

                // Check if order is failed or attempted delivery
                const isFailed = this.isOrderFailedOrAttempted(order, rtoOrderIds);

                if (isFailed) {
                    const customerId = order.customer.id;
                    const customerName = `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || undefined;
                    const currentTags = order.customer.tags || '';
                    const tagsArray = currentTags.split(',').map((t: string) => t.trim().toLowerCase());

                    // Check if no-cod tag is missing on Shopify customer
                    if (!tagsArray.includes('no-cod')) {
                        console.log(`🏷️ Tagging customer ${customerId} (Order ${order.name}) with no-cod...`);
                        const result = await shopifyService.addCustomerTag(customerId, 'no-cod');
                        if (result.success) {
                            taggedCustomersList.push({
                                customerId,
                                orderNumber: order.name,
                                customerName
                            });
                        } else {
                            console.error(`Failed to tag customer ${customerId}:`, result.error);
                        }
                    }

                    // Even if the customer already had the tag on Shopify, we mark the order as processed
                    // so we don't scan it again next time.
                    processedOrderIds.push(order.id);
                    
                    // Add to our DB to persist that we've checked this order
                    await ProcessedNoCodOrder.create({
                        shopifyOrderId: order.id,
                        orderName: order.name,
                        processedAt: new Date()
                    });
                    
                    // Update the local set to prevent processing duplicates in the same run (e.g. if same order appears twice)
                    processedNoCodIds.add(order.id);
                }
            }

            if (taggedCustomersList.length > 0) {
                console.log(`✅ Refined tagging job complete. Tagged ${taggedCustomersList.length} customers.`);
                // Clear cache so UI reflects the new tags on next load
                await shopifyService.clearOrdersCache();
            } else {
                console.log('✅ Refined tagging job complete. No new customers to tag.');
            }

            // Save log to database
            await TaggingJobLog.create({
                startedAt: startTime,
                completedAt: new Date(),
                outcome: 'success',
                taggedCount: taggedCustomersList.length,
                taggedCustomers: taggedCustomersList,
            });

        } catch (error: any) {
            console.error('Error in tagging job:', error);

            // Save error log to database
            await TaggingJobLog.create({
                startedAt: startTime,
                completedAt: new Date(),
                outcome: 'error',
                taggedCount: taggedCustomersList.length,
                taggedCustomers: taggedCustomersList,
                errorMessage: error.message || String(error)
            });
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Logic to determine if an order is "failed" or "attempted"
     */
    private isOrderFailedOrAttempted(order: ShopifyOrder, rtoOrderIds: Set<number>): boolean {
        // 1. Check if marked RTO in our database
        if (rtoOrderIds.has(order.id)) return true;

        // 2. Check fulfillment shipment status
        if (order.fulfillments && order.fulfillments.length > 0) {
            const latestFulfillment = order.fulfillments[order.fulfillments.length - 1];
            const status = latestFulfillment.shipment_status?.toLowerCase();
            
            // Expanded statuses to include attempted delivery as requested
            const failedStatuses = ['failure', 'rto', 'cancelled', 'attempted_delivery', 'undelivered'];
            if (status && failedStatuses.includes(status)) {
                return true;
            }
        }

        // 3. Check order tags for failure markers
        const tags = (order.tags || '').toLowerCase();
        if (
            tags.includes('rto') || 
            tags.includes('failed') || 
            tags.includes('delivery failed') || 
            tags.includes('attempted delivery') || 
            tags.includes('attempted_delivery') ||
            tags.includes('order_cancelled')
        ) {
            return true;
        }

        // 4. Check cancelled_at
        if (order.cancelled_at) return true;

        return false;
    }
}

export const automatedTaggingService = new AutomatedTaggingService();
