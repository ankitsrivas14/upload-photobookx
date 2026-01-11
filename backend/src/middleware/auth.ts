import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import type { AuthenticatedRequest, JwtPayload } from '../types';

/**
 * Authentication middleware
 * Verifies JWT token and attaches user info to request
 */
function authMiddleware(
  req: AuthenticatedRequest, 
  res: Response, 
  next: NextFunction
): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
      req.user = {
        orderId: decoded.orderId,
        orderNumber: decoded.orderNumber,
        mobile: decoded.mobile,
      };
      next();
    } catch (jwtError) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
      });
      return;
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}

export default authMiddleware;
