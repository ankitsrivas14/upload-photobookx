import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config';
import { SuperUser, ISuperUser } from '../models';
import type { AdminJwtPayload, AuthenticatedRequest } from '../types';

const router = Router();

/**
 * Middleware to verify admin JWT token
 */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as AdminJwtPayload;
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
      };
      next();
    } catch (jwtError) {
      res.status(401).json({ success: false, error: 'Invalid or expired token' });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * POST /api/admin/auth/login
 * Login with email and password
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required' });
      return;
    }

    // Find user
    const user = await SuperUser.findOne({ email: email.toLowerCase(), isActive: true });
    
    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      res.status(401).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Generate JWT token
    const payload: AdminJwtPayload = {
      userId: user._id.toString(),
      email: user.email,
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
    });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

/**
 * GET /api/admin/auth/me
 * Get current admin user
 */
router.get('/me', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await SuperUser.findById(req.user?.userId).select('-password');
    
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: 'Failed to get user' });
  }
});

/**
 * POST /api/admin/auth/register
 * Register a new admin (only if no admins exist, or require existing admin)
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, adminSecret } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ success: false, error: 'Email, password, and name are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
      return;
    }

    // Check if any admins exist
    const existingAdmins = await SuperUser.countDocuments();
    
    // If admins exist, require admin secret (set in env)
    if (existingAdmins > 0) {
      const expectedSecret = process.env.ADMIN_REGISTRATION_SECRET;
      if (!expectedSecret || adminSecret !== expectedSecret) {
        res.status(403).json({ success: false, error: 'Admin registration is restricted' });
        return;
      }
    }

    // Check if email already exists
    const existingUser = await SuperUser.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(400).json({ success: false, error: 'Email already registered' });
      return;
    }

    // Create new admin
    const user = new SuperUser({
      email: email.toLowerCase(),
      password,
      name,
      isActive: true,
    });

    await user.save();

    // Generate JWT token
    const payload: AdminJwtPayload = {
      userId: user._id.toString(),
      email: user.email,
    };

    const token = jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
    });

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Registration failed' });
  }
});

/**
 * POST /api/admin/auth/change-password
 * Change password for current user
 */
router.post('/change-password', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      res.status(400).json({ success: false, error: 'Current and new password are required' });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
      return;
    }

    const user = await SuperUser.findById(req.user?.userId);
    
    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    
    if (!isMatch) {
      res.status(401).json({ success: false, error: 'Current password is incorrect' });
      return;
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
});

export default router;
