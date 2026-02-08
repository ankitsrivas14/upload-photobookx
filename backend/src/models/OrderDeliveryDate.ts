import mongoose, { Schema, Document } from 'mongoose';

export interface IOrderDeliveryDate extends Document {
  orderNumber: string; // e.g., "PB1159S"
  deliveredAt: Date;
  source: 'csv' | 'shopify'; // Track where the date came from
  updatedAt: Date;
}

const OrderDeliveryDateSchema = new Schema<IOrderDeliveryDate>({
  orderNumber: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  deliveredAt: {
    type: Date,
    required: true,
  },
  source: {
    type: String,
    enum: ['csv', 'shopify'],
    default: 'csv',
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model<IOrderDeliveryDate>('OrderDeliveryDate', OrderDeliveryDateSchema);
