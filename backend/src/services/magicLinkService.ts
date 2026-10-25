import { v4 as uuidv4 } from 'uuid';
import * as uploads from '../db/uploadsRepo';

/** A magic link as stored in Firestore `magicLinks` (see db/uploadsRepo). */
export interface MagicLinkDoc {
  _id: string;
  token: string;
  orderNumber: string;
  orderId?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  maxUploads: number;
  currentUploads: number;
  expiresAt: Date;
  isActive: boolean;
  submittedForPrinting?: boolean;
  submittedAt?: Date;
  photoSize?: 'large' | 'small';
  photoType?: 'normal' | 'polaroid';
  imagesDeleted?: boolean;
  imagesDeletedAt?: Date;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

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
  async createMagicLink(input: CreateMagicLinkInput): Promise<MagicLinkDoc> {
    const token = this.generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays || 30));

    return uploads.createLink({
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
      submittedForPrinting: false,
      imagesDeleted: false,
      createdBy: input.createdBy,
    });
  }

  /**
   * Find a magic link by token
   */
  async findByToken(token: string): Promise<MagicLinkDoc | null> {
    return uploads.linkByToken(token);
  }

  /**
   * Validate a magic link (active, not expired)
   * @param checkUploadLimit - if true, also checks if upload limit is reached (default: false)
   */
  async validateToken(token: string, checkUploadLimit: boolean = false): Promise<{ valid: boolean; magicLink?: MagicLinkDoc; error?: string }> {
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

    // Only check upload limit when explicitly requested (for upload operations)
    if (checkUploadLimit && magicLink.currentUploads >= magicLink.maxUploads) {
      return { valid: false, error: 'Maximum upload limit reached' };
    }

    return { valid: true, magicLink };
  }

  /**
   * Increment upload count
   */
  async incrementUploadCount(token: string): Promise<void> {
    const link = await this.findByToken(token);
    if (link) await uploads.addUploads(link._id, 1);
  }

  /**
   * Decrement upload count (when image is deleted)
   */
  async decrementUploadCount(token: string): Promise<void> {
    const link = await this.findByToken(token);
    if (link) await uploads.addUploads(link._id, -1); // never goes below 0
  }

  /**
   * Update print settings
   */
  async updatePrintSettings(token: string, photoSize: 'large' | 'small', photoType: 'normal' | 'polaroid'): Promise<void> {
    const link = await this.findByToken(token);
    if (link) await uploads.updateLink(link._id, { photoSize, photoType });
  }

  /**
   * Submit for printing - marks the link as submitted and locks it
   */
  async submitForPrinting(token: string): Promise<void> {
    const link = await this.findByToken(token);
    if (link) await uploads.updateLink(link._id, { submittedForPrinting: true, submittedAt: new Date() });
  }

  /**
   * Deactivate a magic link
   */
  async deactivate(token: string): Promise<void> {
    const link = await this.findByToken(token);
    if (link) await uploads.updateLink(link._id, { isActive: false });
  }

  /**
   * Record that a link's photos were deleted from storage
   */
  async markImagesDeleted(id: string): Promise<void> {
    await uploads.updateLink(id, { imagesDeleted: true, imagesDeletedAt: new Date() });
  }

  /**
   * Get all magic links (for admin)
   */
  async getAllLinks(page: number = 1, limit: number = 20): Promise<{ links: MagicLinkDoc[]; total: number }> {
    return uploads.listLinks(page, limit);
  }
}

export default new MagicLinkService();
