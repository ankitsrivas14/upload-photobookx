import mongoose, { Document, Schema } from 'mongoose';

export interface IDailyPnl extends Document {
  dateKey: string;
  // Whether all non-cancelled orders on this day have an explicit final status
  // (delivered or failed). True for no-order days too. Drives bar chart visibility.
  isCompleted: boolean;
  // Full-day P&L (all orders, prepaid assumed delivered). Valid when isCompleted=true.
  barChartProfit: number;
  // P&L for final + prepaid orders only. For ad-spend-only days: -adSpend.
  heatmapProfit: number;
  orderCount: number;
  adSpend: number;
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
  },
  { timestamps: true }
);

export const DailyPnl = mongoose.model<IDailyPnl>('DailyPnl', schema);
