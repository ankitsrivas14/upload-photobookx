import mongoose, { Schema, Document } from 'mongoose';

export interface IDailyShipping extends Document {
  dateKey: string; // 'YYYY-MM-DD' in Asia/Kolkata
  avgShipping: number | null;
  avgShippingSmall: number | null;
  avgShippingLarge: number | null;
  orderCount: number;
  smallCount: number;
  largeCount: number;
  updatedAt: Date;
}

const DailyShippingSchema = new Schema<IDailyShipping>(
  {
    dateKey: { type: String, required: true, unique: true, index: true },
    avgShipping: { type: Number, default: null },
    avgShippingSmall: { type: Number, default: null },
    avgShippingLarge: { type: Number, default: null },
    orderCount: { type: Number, default: 0 },
    smallCount: { type: Number, default: 0 },
    largeCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const DailyShipping = mongoose.model<IDailyShipping>('DailyShipping', DailyShippingSchema);
