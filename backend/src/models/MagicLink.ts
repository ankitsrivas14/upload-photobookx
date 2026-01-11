import mongoose, { Schema, Document } from 'mongoose';

export interface IMagicLink extends Document {
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
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MagicLinkSchema = new Schema<IMagicLink>(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    orderNumber: {
      type: String,
      required: true,
      index: true,
    },
    orderId: {
      type: String,
    },
    customerName: {
      type: String,
      required: true,
    },
    customerEmail: {
      type: String,
    },
    customerPhone: {
      type: String,
    },
    maxUploads: {
      type: Number,
      default: 50, // Default max photos
    },
    currentUploads: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'SuperUser',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for finding active, non-expired links
MagicLinkSchema.index({ token: 1, isActive: 1, expiresAt: 1 });

export default mongoose.model<IMagicLink>('MagicLink', MagicLinkSchema);
