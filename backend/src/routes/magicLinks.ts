import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import magicLinkService from '../services/magicLinkService';
import shopifyService from '../services/shopifyService';
import type { AuthenticatedRequest } from '../types';
import config from '../config';

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
 * GET /api/admin/shopify/orders
 * Get recent orders from Shopify
 */
router.get('/shopify/orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limitParam = req.query.limit;
    const limit = parseInt(typeof limitParam === 'string' ? limitParam : '50', 10) || 50;
    const orders = await shopifyService.getRecentOrders(limit);
    
    res.json({
      success: true,
      orders: orders.map(order => ({
        id: order.id,
        name: order.name,
        email: order.email,
        createdAt: order.created_at,
        maxUploads: shopifyService.getMaxUploadsForOrder(order),
        lineItems: order.line_items?.map(item => ({
          title: item.title,
          quantity: item.quantity,
          variantTitle: item.variant_title,
        })),
      })),
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
    const productId = req.params.productId;
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

export default router;
