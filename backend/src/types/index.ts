import { Request } from 'express';

// Super User (Admin)
export interface SuperUser {
  _id: string;
  email: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Magic Link
export interface MagicLink {
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
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// Uploaded Image
export interface UploadedImage {
  _id: string;
  magicLinkId: string;
  orderNumber: string;
  fileName: string;
  originalName: string;
  s3Key: string;
  s3Url: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
}

// JWT Payload for admin auth
export interface AdminJwtPayload {
  userId: string;
  email: string;
}

// Authenticated request with user
export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

// Magic link request (for upload pages)
export interface MagicLinkRequest extends Request {
  magicLink?: MagicLink;
}

// Shopify Order (simplified)
export interface ShopifyOrder {
  id: number;
  name: string;
  email?: string;
  created_at: string;
  line_items: Array<{
    id: number;
    title: string;
    quantity: number;
    product_id: number;
    variant_id: number;
  }>;
}

export interface ShopifyOrdersResponse {
  orders: ShopifyOrder[];
}
