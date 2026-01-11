import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import shopifyService from '../services/shopifyService';
import type { AuthenticatedRequest, JwtPayload } from '../types';

const router = Router();

/**
 * GET /api/auth/test-phone-search?phone=9820448163
 * Test endpoint to check if we can search orders by phone
 */
router.get('/test-phone-search', async (req: Request, res: Response) => {
  try {
    const phone = req.query.phone as string;
    
    if (!phone) {
      res.status(400).json({ success: false, error: 'Phone parameter required' });
      return;
    }
    
    console.log('\n========== TEST PHONE SEARCH ==========');
    const orders = await shopifyService.findOrdersByPhone(phone);
    console.log('========================================\n');
    
    res.json({
      success: true,
      phone,
      ordersFound: orders.length,
      orders: orders.map(o => ({
        id: o.id,
        name: o.name,
        createdAt: o.created_at,
      })),
    });
  } catch (error) {
    console.error('Phone search test error:', error);
    res.status(500).json({ success: false, error: 'Search failed' });
  }
});

interface VerifyRequestBody {
  orderNo: string;
  mobile: string;
}

/**
 * POST /api/auth/verify
 * Verify order number and mobile number against Shopify
 */
router.post('/verify', async (req: Request<object, object, VerifyRequestBody>, res: Response) => {
  try {
    const { orderNo, mobile } = req.body;

    // Validate input
    if (!orderNo || !orderNo.trim()) {
      res.status(400).json({
        success: false,
        error: 'Order number is required',
      });
      return;
    }

    if (!mobile || mobile.length < 10) {
      res.status(400).json({
        success: false,
        error: 'Valid mobile number is required',
      });
      return;
    }

    // Verify with Shopify
    const result = await shopifyService.verifyOrderAuth(orderNo.trim(), mobile.trim());

    if (!result.success || !result.order) {
      res.status(401).json({
        success: false,
        error: result.error,
      });
      return;
    }

    // Generate JWT token for authenticated session
    const payload: JwtPayload = {
      orderId: result.order.id,
      orderNumber: result.order.orderNumber,
      mobile: mobile.slice(-4), // Only store last 4 digits
    };

    const token = jwt.sign(payload, config.jwt.secret, { 
      expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn']
    });

    res.json({
      success: true,
      token,
      order: result.order,
    });
  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/auth/me
 * Get current authenticated user/order info
 */
router.get('/me', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'No token provided',
      });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
      res.json({
        success: true,
        user: {
          orderId: decoded.orderId,
          orderNumber: decoded.orderNumber,
        },
      });
    } catch (jwtError) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
    }
  } catch (error) {
    console.error('Auth me error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
