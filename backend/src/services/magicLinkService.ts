import { v4 as uuidv4 } from 'uuid';
import { MagicLink, IMagicLink } from '../models';

interface CreateMagicLinkInput {
  orderNumber: string;
  orderId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  maxUploads?: number;
  expiresInDays?: number;
  createdBy: string;
}

class MagicLinkService {
  /**
   * Generate a unique magic link token
   */
  generateToken(): string {
    // Create a URL-safe token
    return uuidv4().replace(/-/g, '');
  }

  /**
   * Create a new magic link for an order
   */
  async createMagicLink(input: CreateMagicLinkInput): Promise<IMagicLink> {
    const token = this.generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays || 30));

    const magicLink = new MagicLink({
      token,
      orderNumber: input.orderNumber,
      orderId: input.orderId,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      maxUploads: input.maxUploads || 50,
      currentUploads: 0,
      expiresAt,
      isActive: true,
      createdBy: input.createdBy,
    });

    await magicLink.save();
    return magicLink;
  }

  /**
   * Find a magic link by token
   */
  async findByToken(token: string): Promise<IMagicLink | null> {
    return MagicLink.findOne({ token });
  }

  /**
   * Validate a magic link (active, not expired, not maxed out)
   */
  async validateToken(token: string): Promise<{ valid: boolean; magicLink?: IMagicLink; error?: string }> {
    const magicLink = await this.findByToken(token);

    if (!magicLink) {
      return { valid: false, error: 'Invalid link' };
    }

    if (!magicLink.isActive) {
      return { valid: false, error: 'This link has been deactivated' };
    }

    if (new Date() > magicLink.expiresAt) {
      return { valid: false, error: 'This link has expired' };
    }

    if (magicLink.currentUploads >= magicLink.maxUploads) {
      return { valid: false, error: 'Maximum upload limit reached' };
    }

    return { valid: true, magicLink };
  }

  /**
   * Increment upload count
   */
  async incrementUploadCount(token: string): Promise<void> {
    await MagicLink.updateOne({ token }, { $inc: { currentUploads: 1 } });
  }

  /**
   * Decrement upload count (when image is deleted)
   */
  async decrementUploadCount(token: string): Promise<void> {
    await MagicLink.updateOne(
      { token, currentUploads: { $gt: 0 } }, // Only decrement if > 0
      { $inc: { currentUploads: -1 } }
    );
  }

  /**
   * Submit for printing - marks the link as submitted and locks it
   */
  async submitForPrinting(token: string): Promise<void> {
    await MagicLink.updateOne(
      { token },
      { 
        submittedForPrinting: true, 
        submittedAt: new Date(),
      }
    );
  }

  /**
   * Deactivate a magic link
   */
  async deactivate(token: string): Promise<void> {
    await MagicLink.updateOne({ token }, { isActive: false });
  }

  /**
   * Get all magic links (for admin)
   */
  async getAllLinks(page: number = 1, limit: number = 20): Promise<{ links: IMagicLink[]; total: number }> {
    const skip = (page - 1) * limit;
    const [links, total] = await Promise.all([
      MagicLink.find().sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy', 'name email'),
      MagicLink.countDocuments(),
    ]);
    return { links, total };
  }

  /**
   * Get magic links for a specific order
   */
  async getLinksForOrder(orderNumber: string): Promise<IMagicLink[]> {
    return MagicLink.find({ orderNumber }).sort({ createdAt: -1 });
  }
}

export default new MagicLinkService();
