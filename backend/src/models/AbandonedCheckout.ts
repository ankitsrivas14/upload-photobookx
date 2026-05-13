import mongoose, { Document, Schema } from 'mongoose';

export interface IAbandonedCheckout extends Document {
  dateStr: string;
  phone: string;
  name: string;
  status: 'pending' | 'message_sent' | 'not_required';
  createdAt: Date;
}

const AbandonedCheckoutSchema = new Schema({
  dateStr: { type: String, required: true },
  phone: { type: String, required: true },
  name: { type: String, required: true },
  status: { type: String, enum: ['pending', 'message_sent', 'not_required'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

// Compound index to avoid duplicates if pasted multiple times
AbandonedCheckoutSchema.index({ phone: 1, dateStr: 1 }, { unique: true });

export const AbandonedCheckout = mongoose.model<IAbandonedCheckout>('AbandonedCheckout', AbandonedCheckoutSchema);
