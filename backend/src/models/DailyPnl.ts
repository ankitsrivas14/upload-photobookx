import mongoose, { Document, Schema } from 'mongoose';

export interface IDailyPnl extends Document {
  dateKey: string;
  isCompleted: boolean;
  barChartProfit: number;
  heatmapProfit: number;
  orderCount: number;
  adSpend: number;
  // Revenue from delivered orders (excl. failed/pending). Populated by recomputePnlForDate.
  totalRevenue: number;
  // COGS + shipping per day (excl. ad spend). Populated by recomputePnlForDate.
  totalCogs: number;
  updatedAt: Date;
}

const schema = new Schema<IDailyPnl>(
  {
    dateKey: { type: String, required: true, unique: true, index: true },
    isCompleted: { type: Boolean, default: false },
    barChartProfit: { type: Number, default: 0 },
    heatmapProfit: { type: Number, default: 0 },
    orderCount: { type: Number, default: 0 },
    adSpend: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    totalCogs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const DailyPnl = mongoose.model<IDailyPnl>('DailyPnl', schema);
