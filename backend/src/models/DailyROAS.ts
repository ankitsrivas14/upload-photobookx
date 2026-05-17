import mongoose, { Schema, Document } from 'mongoose';

export interface IDailyROAS extends Document {
  dateKey: string; // 'YYYY-MM-DD' in Asia/Kolkata
  revenue: number;
  adSpend: number;
  roas: number | null;
  updatedAt: Date;
}

const DailyROASSchema = new Schema<IDailyROAS>(
  {
    dateKey: { type: String, required: true, unique: true, index: true },
    revenue: { type: Number, required: true, default: 0 },
    adSpend: { type: Number, required: true, default: 0 },
    roas: { type: Number, default: null },
  },
  { timestamps: true }
);

export const DailyROAS = mongoose.model<IDailyROAS>('DailyROAS', DailyROASSchema);
