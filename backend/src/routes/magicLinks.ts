import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import magicLinkService from '../services/magicLinkService';
import shopifyService from '../services/shopifyService';
import shiprocketService from '../services/shiprocketService';
import type { AuthenticatedRequest } from '../types';
import config from '../config';
import { UploadedImage } from '../models';
import OrderDeliveryDate from '../models/OrderDeliveryDate';
import ShippingCharge from '../models/ShippingCharge';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { fromInstanceMetadata } from '@aws-sdk/credential-provider-imds';
import archiver from 'archiver';

const router = Router();

/**
 * GET /api/admin/magic-links
 * Get all magic links (paginated)
 */
router.get('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pageParam = req.query.page;
    const limitParam = req.query.limit;
    const page = parseInt(typeof pageParam === 'string' ? pageParam : '1', 10) || 1;
    const limit = parseInt(typeof limitParam === 'string' ? limitParam : '20', 10) || 20;
    
    const { links, total } = await magicLinkService.getAllLinks(page, limit);
    
    res.json({
      success: true,
      links: links.map(link => ({
        id: link._id,
        token: link.token,
        orderNumber: link.orderNumber,
        customerName: link.customerName,
        customerEmail: link.customerEmail,
        customerPhone: link.customerPhone,
        maxUploads: link.maxUploads,
        currentUploads: link.currentUploads,
        expiresAt: link.expiresAt,
        isActive: link.isActive,
        imagesDeleted: link.imagesDeleted,
        imagesDeletedAt: link.imagesDeletedAt,
        createdAt: link.createdAt,
        uploadUrl: `${config.frontendUrl}/upload/${link.token}`,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching magic links:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch magic links' });
  }
});

/**
 * POST /api/admin/magic-links
 * Create a new magic link
 */
router.post('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderNumber, customerName, customerEmail, customerPhone, expiresInDays } = req.body;

    if (!orderNumber || !customerName) {
      res.status(400).json({ success: false, error: 'Order number and customer name are required' });
      return;
    }

    // Get order from Shopify to determine max uploads from variant
    let orderId: string | undefined;
    let maxUploads = 25; // Default fallback
    
    try {
      const order = await shopifyService.findOrderByNumber(orderNumber);
      if (order) {
        orderId = String(order.id);
        // Get max uploads from the variant (12, 15, 20, or 25)
        maxUploads = shopifyService.getMaxUploadsForOrder(order);
      }
    } catch (e) {
      console.warn('Could not verify order in Shopify:', e);
    }

    const magicLink = await magicLinkService.createMagicLink({
      orderNumber,
      orderId,
      customerName,
      customerEmail,
      customerPhone,
      maxUploads,
      expiresInDays: expiresInDays || 30,
      createdBy: req.user!.userId,
    });

    res.status(201).json({
      success: true,
      magicLink: {
        id: magicLink._id,
        token: magicLink.token,
        orderNumber: magicLink.orderNumber,
        customerName: magicLink.customerName,
        maxUploads: magicLink.maxUploads,
        currentUploads: magicLink.currentUploads,
        isActive: magicLink.isActive,
        imagesDeleted: magicLink.imagesDeleted,
        expiresAt: magicLink.expiresAt,
        uploadUrl: `${config.frontendUrl}/upload/${magicLink.token}`,
      },
    });
  } catch (error) {
    console.error('Error creating magic link:', error);
    res.status(500).json({ success: false, error: 'Failed to create magic link' });
  }
});

/**
 * GET /api/admin/magic-links/:token
 * Get a specific magic link
 */
router.get('/:token', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.params.token as string;
    const magicLink = await magicLinkService.findByToken(token);

    if (!magicLink) {
      res.status(404).json({ success: false, error: 'Magic link not found' });
      return;
    }

    res.json({
      success: true,
      magicLink: {
        id: magicLink._id,
        token: magicLink.token,
        orderNumber: magicLink.orderNumber,
        customerName: magicLink.customerName,
        customerEmail: magicLink.customerEmail,
        customerPhone: magicLink.customerPhone,
        maxUploads: magicLink.maxUploads,
        currentUploads: magicLink.currentUploads,
        expiresAt: magicLink.expiresAt,
        isActive: magicLink.isActive,
        createdAt: magicLink.createdAt,
        uploadUrl: `${config.frontendUrl}/upload/${magicLink.token}`,
      },
    });
  } catch (error) {
    console.error('Error fetching magic link:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch magic link' });
  }
});

/**
 * DELETE /api/admin/magic-links/:token
 * Deactivate a magic link
 */
router.delete('/:token', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.params.token as string;
    await magicLinkService.deactivate(token);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deactivating magic link:', error);
    res.status(500).json({ success: false, error: 'Failed to deactivate magic link' });
  }
});

/**
 * POST /api/admin/shopify/orders/clear-cache
 * Clear the orders cache to force fresh data from Shopify
 */
router.post('/shopify/orders/clear-cache', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    await shopifyService.clearOrdersCache();
    res.json({
      success: true,
      message: 'Orders cache cleared successfully',
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    res.status(500).json({ success: false, error: 'Failed to clear cache' });
  }
});

/**
 * GET /api/admin/shopify/orders
 * Get recent orders from Shopify (with caching)
 */
router.get('/shopify/orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limitParam = req.query.limit;
    const limit = parseInt(typeof limitParam === 'string' ? limitParam : '50', 10) || 50;
    
    // Check if we want all orders or just printed photos orders
    const allOrders = req.query.all === 'true';
    const createdAtMin = typeof req.query.created_at_min === 'string' ? req.query.created_at_min : undefined;
    
    const orders = allOrders 
      ? await shopifyService.getAllOrders(limit, createdAtMin)
      : await shopifyService.getRecentOrders(limit);
    
    // Fetch delivery dates from database for all orders
    const orderNumbers = orders.map(o => o.name);
    const deliveryDates = await OrderDeliveryDate.find({
      orderNumber: { $in: orderNumbers }
    });
    
    // Create a map for quick lookup
    const deliveryDateMap = new Map(
      deliveryDates.map(dd => [dd.orderNumber, dd.deliveredAt])
    );
    
    // Fetch shipping charges from database only (no auto-fetch)
    let shippingChargesMap = new Map<string, any>();
    try {
      shippingChargesMap = await shiprocketService.getShippingCharges(orderNumbers);
    } catch (error) {
      console.error('[API] Error fetching shipping charges:', error);
    }
    
    res.json({
      success: true,
      orders: orders.map(order => {
        // Get delivery status from multiple sources
        let deliveryStatus = null;
        let deliveredAt = null; // Track when the order was delivered
        
        let trackingUrl = null;
        // First, check fulfillments for shipment status
        if (order.fulfillments && order.fulfillments.length > 0) {
          // Get the most recent fulfillment's shipment status
          const latestFulfillment = order.fulfillments[order.fulfillments.length - 1];
          deliveryStatus = latestFulfillment.shipment_status;
          trackingUrl = latestFulfillment.tracking_url || null;
          
          // If this fulfillment shows delivered, use its updated_at as delivery date
          if (latestFulfillment.shipment_status?.toLowerCase() === 'delivered') {
            deliveredAt = (latestFulfillment as any).updated_at || null;
          }
        }
        
        // If no delivery status from fulfillments, check order-level fulfillment_status
        if (!deliveryStatus && order.fulfillment_status) {
          deliveryStatus = order.fulfillment_status;
        }
        
        // Determine payment method (Prepaid or COD)
        let paymentMethod = 'Prepaid'; // Default to prepaid
        
        // Check gateway field
        const gateway = order.gateway?.toLowerCase() || '';
        const paymentGateways = order.payment_gateway_names?.map(g => g.toLowerCase()) || [];
        const tags = order.tags?.toLowerCase() || '';
        
        // Check if it's COD
        if (
          gateway.includes('cash on delivery') ||
          gateway.includes('cod') ||
          paymentGateways.some(g => g.includes('cash on delivery') || g.includes('cod')) ||
          tags.includes('cod')
        ) {
          paymentMethod = 'COD';
        }
        
        // If no deliveredAt from Shopify, check database for CSV-imported date
        if (!deliveredAt) {
          const csvDate = deliveryDateMap.get(order.name);
          if (csvDate) {
            deliveredAt = csvDate.toISOString();
          }
        }
        
        return {
          id: order.id,
          name: order.name,
          email: order.email,
          createdAt: order.created_at,
          fulfillmentStatus: order.fulfillment_status,
          deliveryStatus: deliveryStatus,
          deliveredAt: deliveredAt,
          trackingUrl: trackingUrl,
          paymentMethod: paymentMethod,
          maxUploads: shopifyService.getMaxUploadsForOrder(order),
          totalPrice: order.current_total_price ? parseFloat(order.current_total_price) : undefined,
          shippingCharge: shippingChargesMap.get(order.name)?.shippingCharge || 0,
          shippingBreakdown: shippingChargesMap.get(order.name)?.breakdown || null,
          cancelledAt: order.cancelled_at,
          lineItems: order.line_items?.map(item => ({
            title: item.title,
            quantity: item.quantity,
            variantTitle: item.variant_title,
          })),
        };
      }),
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/admin/shopify/orders/:orderNumber
 * Search for a specific order
 */
router.get('/shopify/orders/:orderNumber', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orderNumber = req.params.orderNumber as string;
    const order = await shopifyService.findOrderByNumber(orderNumber);

    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    res.json({
      success: true,
      order: {
        id: order.id,
        name: order.name,
        email: order.email,
        createdAt: order.created_at,
        lineItems: order.line_items?.map(item => ({
          title: item.title,
          quantity: item.quantity,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch order' });
  }
});

/**
 * GET /api/admin/magic-links/shopify/products
 * Get all products from Shopify
 */
router.get('/shopify/products', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const products = await shopifyService.getProducts(100);

    res.json({
      success: true,
      products: products.map(product => ({
        id: product.id,
        title: product.title,
        vendor: product.vendor,
        productType: product.product_type,
        status: product.status,
        createdAt: product.created_at,
        updatedAt: product.updated_at,
        variants: product.variants?.map((variant: any) => ({
          id: variant.id,
          title: variant.title,
          price: variant.price,
          compareAtPrice: variant.compare_at_price,
          sku: variant.sku,
          inventoryQuantity: variant.inventory_quantity,
          weight: variant.weight,
          weightUnit: variant.weight_unit,
        })) || [],
        image: product.images?.[0]?.src || product.image?.src || null,
      })),
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch products' });
  }
});

/**
 * GET /api/admin/magic-links/shopify/products/:productId
 * Get a single product by ID
 */
router.get('/shopify/products/:productId', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const productId = Array.isArray(req.params.productId) 
      ? req.params.productId[0] 
      : req.params.productId;
    const product = await shopifyService.getProduct(productId);

    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    res.json({
      success: true,
      product: {
        id: product.id,
        title: product.title,
        vendor: product.vendor,
        productType: product.product_type,
        status: product.status,
        description: product.body_html,
        createdAt: product.created_at,
        updatedAt: product.updated_at,
        variants: product.variants?.map((variant: any) => ({
          id: variant.id,
          title: variant.title,
          price: variant.price,
          compareAtPrice: variant.compare_at_price,
          sku: variant.sku,
          inventoryQuantity: variant.inventory_quantity,
          weight: variant.weight,
          weightUnit: variant.weight_unit,
        })) || [],
        images: product.images?.map((img: any) => img.src) || [],
      },
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch product' });
  }
});

/**
 * PUT /api/admin/magic-links/shopify/products/bulk-update-prices
 * Bulk update prices for multiple products
 */
router.put('/shopify/products/bulk-update-prices', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      productIds,
      variant1Price,
      variant1CompareAtPrice,
      variant2Price,
      variant2CompareAtPrice,
      priceChangePercent,
      priceChangeAmount,
      updateType,
    } = req.body;

    if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
      res.status(400).json({ success: false, error: 'Product IDs are required' });
      return;
    }

    if (!updateType || !['set', 'increase', 'decrease'].includes(updateType)) {
      res.status(400).json({ success: false, error: 'Valid update type is required' });
      return;
    }

    if (updateType === 'set') {
      if (!variant1Price && !variant2Price && !variant1CompareAtPrice && !variant2CompareAtPrice) {
        res.status(400).json({ success: false, error: 'At least one price field is required' });
        return;
      }
    } else {
      if (!priceChangePercent && !priceChangeAmount) {
        res.status(400).json({ success: false, error: 'Percentage or amount change is required' });
        return;
      }
    }

    const updates: any = {
      updateType,
    };

    if (updateType === 'set') {
      if (variant1Price) updates.variant1Price = variant1Price;
      if (variant1CompareAtPrice !== undefined) updates.variant1CompareAtPrice = variant1CompareAtPrice || null;
      if (variant2Price) updates.variant2Price = variant2Price;
      if (variant2CompareAtPrice !== undefined) updates.variant2CompareAtPrice = variant2CompareAtPrice || null;
    } else {
      if (priceChangePercent) updates.priceChangePercent = parseFloat(priceChangePercent);
      if (priceChangeAmount) updates.priceChangeAmount = parseFloat(priceChangeAmount);
    }

    const results = await shopifyService.bulkUpdateProductPrices(productIds, updates);

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    res.json({
      success: true,
      results,
      summary: {
        total: productIds.length,
        successful: successCount,
        failed: failureCount,
      },
    });
  } catch (error) {
    console.error('Error bulk updating prices:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to update prices';
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/admin/magic-links/:token/download-images
 * Download all images for a magic link as a zip file
 */
router.get('/:token/download-images', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.params.token as string;
    
    // Validate the magic link
    const magicLink = await magicLinkService.findByToken(token);
    
    if (!magicLink) {
      res.status(404).json({ success: false, error: 'Magic link not found' });
      return;
    }

    // Get all images for this magic link
    const images = await UploadedImage.find({ magicLinkId: magicLink._id }).sort({ uploadedAt: 1 });

    console.log(`Found ${images.length} images for order ${magicLink.orderNumber}`);

    if (images.length === 0) {
      res.status(404).json({ success: false, error: 'No images found for this order' });
      return;
    }

    // Configure S3 client - use environment credentials for local dev, instance metadata for production
    const s3Client = new S3Client({
      region: config.aws.region,
      credentials: config.aws.accessKeyId && config.aws.secretAccessKey ? {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      } : fromInstanceMetadata(),
      forcePathStyle: false,
    });

    // Set response headers for zip download
    const zipFileName = `${magicLink.orderNumber.replace(/[^a-zA-Z0-9]/g, '_')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFileName}"`);

    // Create archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });

    // Handle errors
    archive.on('error', (err) => {
      console.error('Archive error:', err);
    });

    // Pipe archive to response
    archive.pipe(res);

    let successCount = 0;
    let failCount = 0;

    // Add each image to the archive
    for (const image of images) {
      try {
        console.log(`Fetching image: ${image.originalName} from S3 key: ${image.s3Key}`);
        
        // Fetch image from S3
        const s3Response = await s3Client.send(new GetObjectCommand({
          Bucket: config.aws.s3Bucket,
          Key: image.s3Key,
        }));

        if (s3Response.Body) {
          // Convert stream to buffer
          const stream = s3Response.Body as NodeJS.ReadableStream;
          const chunks: Buffer[] = [];
          
          for await (const chunk of stream) {
            chunks.push(Buffer.from(chunk));
          }
          
          const buffer = Buffer.concat(chunks);
          
          console.log(`Adding ${image.originalName} to archive (${buffer.length} bytes)`);
          
          // Add buffer to archive with original name
          archive.append(buffer, { name: image.originalName });
          successCount++;
        } else {
          console.error(`No body in S3 response for ${image.fileName}`);
          failCount++;
        }
      } catch (imageError) {
        console.error(`Error fetching image ${image.fileName}:`, imageError);
        failCount++;
        // Continue with other images even if one fails
      }
    }

    console.log(`Archive stats: ${successCount} successful, ${failCount} failed`);

    // Finalize the archive
    await archive.finalize();
    
    console.log('Archive finalized');
  } catch (error) {
    console.error('Error downloading images:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to download images' });
    }
  }
});

/**
 * DELETE /api/admin/magic-links/:token/delete-images
 * Delete all images for a magic link from S3 and database
 */
router.delete('/:token/delete-images', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.params.token as string;
    
    // Validate the magic link
    const magicLink = await magicLinkService.findByToken(token);
    
    if (!magicLink) {
      res.status(404).json({ success: false, error: 'Magic link not found' });
      return;
    }

    // Check if images are already deleted
    if (magicLink.imagesDeleted) {
      res.status(400).json({ success: false, error: 'Images have already been deleted' });
      return;
    }

    // Get all images for this magic link
    const images = await UploadedImage.find({ magicLinkId: magicLink._id });

    console.log(`Deleting ${images.length} images for order ${magicLink.orderNumber}`);

    // Configure S3 client
    const s3Client = new S3Client({
      region: config.aws.region,
      credentials: config.aws.accessKeyId && config.aws.secretAccessKey ? {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      } : fromInstanceMetadata(),
      forcePathStyle: false,
    });

    let deletedCount = 0;
    let failedCount = 0;
    const failedKeys: string[] = [];

    // Delete each image from S3
    for (const image of images) {
      try {
        const deleteCommand = new DeleteObjectCommand({
          Bucket: config.aws.s3Bucket,
          Key: image.s3Key,
        });
        
        await s3Client.send(deleteCommand);
        
        console.log(`✓ Deleted from S3: ${image.s3Key}`);
        deletedCount++;
      } catch (s3Error) {
        console.error(`✗ Failed to delete ${image.s3Key} from S3:`, s3Error);
        failedCount++;
        failedKeys.push(image.s3Key);
      }
    }

    console.log(`S3 Deletion Summary: ${deletedCount} successful, ${failedCount} failed`);

    // Only proceed if ALL images were successfully deleted from S3
    if (failedCount > 0) {
      res.status(500).json({
        success: false,
        error: `Failed to delete ${failedCount} image(s) from S3. Cannot proceed.`,
        deletedCount,
        failedCount,
        failedKeys,
      });
      return;
    }

    // All S3 deletions successful - now delete from database
    await UploadedImage.deleteMany({ magicLinkId: magicLink._id });

    // Update magic link to mark images as deleted
    magicLink.imagesDeleted = true;
    magicLink.imagesDeletedAt = new Date();
    await magicLink.save();

    console.log(`✓ Deletion complete: All ${deletedCount} images removed from S3 and database`);

    res.json({
      success: true,
      message: `Successfully deleted all ${deletedCount} images`,
      deletedCount,
    });
  } catch (error) {
    console.error('Error deleting images:', error);
    res.status(500).json({ success: false, error: 'Failed to delete images' });
  }
});

/**
 * POST /api/admin/magic-links/shiprocket/fetch-shipping-charge
 * Fetch shipping charge for a single order from Shiprocket with breakdown
 */
router.post('/shiprocket/fetch-shipping-charge', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderNumber, refetch } = req.body;
    
    if (!orderNumber) {
      return res.status(400).json({ 
        success: false, 
        error: 'orderNumber is required' 
      });
    }
    
    // If refetch is true, delete existing cache first
    if (refetch) {
      const ShippingCharge = (await import('../models/ShippingCharge')).default;
      await ShippingCharge.deleteOne({ orderNumber });
    }
    
    const shippingCharge = await shiprocketService.fetchShippingChargeForOrder(orderNumber);
    
    if (shippingCharge === null) {
      return res.json({
        success: true,
        shippingCharge: 0,
        breakdown: null,
        message: 'Order not found in Shiprocket or not yet shipped',
      });
    }
    
    // Get the saved record to return breakdown
    const ShippingCharge = (await import('../models/ShippingCharge')).default;
    const saved = await ShippingCharge.findOne({ orderNumber });
    
    res.json({
      success: true,
      shippingCharge,
      breakdown: saved ? {
        freightForward: saved.freightForward || 0,
        freightCOD: saved.freightCOD || 0,
        freightRTO: saved.freightRTO || 0,
        whatsappCharges: saved.whatsappCharges || 0,
        otherCharges: saved.otherCharges || 0,
      } : null,
      message: `Fetched shipping charge: ₹${shippingCharge}`,
    });
  } catch (error) {
    console.error('Error fetching shipping charge:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch shipping charge' 
    });
  }
});

/**
 * POST /api/admin/magic-links/shiprocket/clear-cache
 * Clear all shipping charges from database
 */
router.post('/shiprocket/clear-cache', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await ShippingCharge.deleteMany({});
    res.json({
      success: true,
      message: `Cleared ${result.deletedCount} shipping charges from cache`,
    });
  } catch (error) {
    console.error('[API] Error clearing shipping charges cache:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear shipping charges cache' 
    });
  }
});

/**
 * POST /api/admin/magic-links/shiprocket/sync-shipping-charges
 * Fetch shipping charges for all provided orders (BULK - optimized)
 */
router.post('/shiprocket/sync-shipping-charges', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderNumbers } = req.body;
    
    if (!Array.isArray(orderNumbers)) {
      return res.status(400).json({ 
        success: false, 
        error: 'orderNumbers must be an array' 
      });
    }

    // Use bulk fetch method (much faster)
    const result = await shiprocketService.bulkFetchShippingCharges(orderNumbers);

    res.json({
      success: true,
      fetched: result.fetched,
      skipped: result.skipped,
      message: `Fetched ${result.fetched}, skipped ${result.skipped} out of ${orderNumbers.length} orders`,
    });
  } catch (error) {
    console.error('[API] Error syncing shipping charges:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to sync shipping charges' 
    });
  }
});

/**
 * GET /api/admin/magic-links/shiprocket/wallet-transactions
 * Get all wallet transactions for a date range
 * Query params: start_date (YYYY-MM-DD), end_date (YYYY-MM-DD)
 */
router.get('/shiprocket/wallet-transactions', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const startDate = typeof req.query.start_date === 'string' ? req.query.start_date : undefined;
    const endDate = typeof req.query.end_date === 'string' ? req.query.end_date : undefined;
    
    const transactions = await shiprocketService.getAllWalletTransactions(startDate, endDate);

    res.json({
      success: true,
      transactions,
      count: transactions.length,
    });
  } catch (error) {
    console.error('[API] Error fetching wallet transactions:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch wallet transactions' 
    });
  }
});

export default router;
