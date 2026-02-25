import shopifyService from './shopifyService';
import RTOOrder from '../models/RTOOrder';
import { ShopifyOrder } from '../types';

class AutomatedTaggingService {
    private isRunning = false;

    /**
     * Start the automated tagging job
     * Runs every 5 minutes
     */
    public start() {
        console.log('🤖 Automated Tagging Job started (every 5 mins)');

        // Run immediately on start
        this.runJob().catch(err => console.error('Error in initial tagging job:', err));

        // Schedule every 5 minutes
        setInterval(() => {
            this.runJob().catch(err => console.error('Error in scheduled tagging job:', err));
        }, 5 * 60 * 1000);
    }

    private async runJob() {
        if (this.isRunning) {
            console.log('Skipping tagging job, already running');
            return;
        }

        this.isRunning = true;
        try {
            console.log('🔍 Running automated tagging job for failed orders...');

            // 1. Fetch recent orders from Shopify
            // We take 100 to cover enough history
            const orders = await shopifyService.getAllOrders(100);

            // 2. Get all RTO order IDs from our database
            const rtoOrders = await RTOOrder.find({}, { shopifyOrderId: 1 });
            const rtoOrderIds = new Set(rtoOrders.map(o => o.shopifyOrderId));

            let taggedCount = 0;

            for (const order of orders) {
                if (!order.customer) continue;

                // Check if order is failed
                const isFailed = this.isOrderFailed(order, rtoOrderIds);

                if (isFailed) {
                    const customerId = order.customer.id;
                    const currentTags = order.customer.tags || '';
                    const tagsArray = currentTags.split(',').map((t: string) => t.trim().toLowerCase());

                    // Check if no-cod tag is missing
                    if (!tagsArray.includes('no-cod')) {
                        console.log(`🏷️ Tagging customer ${customerId} (Order ${order.name}) with no-cod due to failure`);
                        const result = await shopifyService.addCustomerTag(customerId, 'no-cod');
                        if (result.success) {
                            taggedCount++;
                        } else {
                            console.error(`Failed to tag customer ${customerId}:`, result.error);
                        }
                    }
                }
            }

            if (taggedCount > 0) {
                console.log(`✅ Automated tagging job complete. Tagged ${taggedCount} customers.`);
                // Optional: clear cache if any tags were added so UI is fresh
                await shopifyService.clearOrdersCache();
            } else {
                console.log('✅ Automated tagging job complete. No new customers to tag.');
            }

        } catch (error) {
            console.error('Error in automated tagging job:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Logic to determine if an order is "failed"
     */
    private isOrderFailed(order: ShopifyOrder, rtoOrderIds: Set<number>): boolean {
        // 1. Check if marked RTO in our database
        if (rtoOrderIds.has(order.id)) return true;

        // 2. Check fulfillment shipment status
        if (order.fulfillments && order.fulfillments.length > 0) {
            const latestFulfillment = order.fulfillments[order.fulfillments.length - 1];
            const status = latestFulfillment.shipment_status?.toLowerCase();
            if (status === 'failure' || status === 'rto' || status === 'cancelled') {
                return true;
            }
        }

        // 3. Check order tags for failure markers
        const tags = (order.tags || '').toLowerCase();
        if (tags.includes('rto') || tags.includes('failed') || tags.includes('delivery failed')) {
            return true;
        }

        // 4. Check cancelled_at
        if (order.cancelled_at) return true;

        return false;
    }
}

export const automatedTaggingService = new AutomatedTaggingService();
