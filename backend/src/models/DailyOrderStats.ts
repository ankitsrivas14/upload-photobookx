import mongoose, { Document, Schema } from 'mongoose';

export interface IDailyOrderStats extends Document {
  dateKey: string;
  // Payment method split
  prepaidCount: number;
  codCount: number;
  // Delivery status counts
  deliveredCount: number;
  failedCount: number;
  inTransitCount: number;
  outForDeliveryCount: number;
  attemptedDeliveryCount: number;
  confirmedCount: number;
  // COD terminal status
  codDeliveredCount: number;
  codFailedCount: number;
  // True when every order on this day is in a final state (delivered, failed, or prepaid)
  isCompleted: boolean;
  updatedAt: Date;
}

const schema = new Schema<IDailyOrderStats>(
  {
    dateKey: { type: String, required: true, unique: true, index: true },
    prepaidCount: { type: Number, default: 0 },
    codCount: { type: Number, default: 0 },
    deliveredCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    inTransitCount: { type: Number, default: 0 },
    outForDeliveryCount: { type: Number, default: 0 },
    attemptedDeliveryCount: { type: Number, default: 0 },
    confirmedCount: { type: Number, default: 0 },
    codDeliveredCount: { type: Number, default: 0 },
    codFailedCount: { type: Number, default: 0 },
    isCompleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const DailyOrderStats = mongoose.model<IDailyOrderStats>('DailyOrderStats', schema);
