import mongoose, { Schema, Document } from 'mongoose';

export interface IDailyPerformancePrediction extends Document {
  dateKey: string; // YYYY-MM-DD
  expectedAdSpend: number;
  predictedHourlyCumul: number[];
  predictedHourlyRevenueCumul: number[];
  predictedTotalOrders: number;
  predictedTotalRevenue: number;
  reasoning: string;
  createdAt: Date;
}

const DailyPerformancePredictionSchema: Schema = new Schema({
  dateKey: { type: String, required: true },
  expectedAdSpend: { type: Number, required: true },
  predictedHourlyCumul: { type: [Number], required: true },
  predictedHourlyRevenueCumul: { type: [Number], required: true },
  predictedTotalOrders: { type: Number, required: true },
  predictedTotalRevenue: { type: Number, required: true },
  reasoning: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// We want to keep track of predictions for each day
DailyPerformancePredictionSchema.index({ dateKey: 1, createdAt: -1 });

export default mongoose.model<IDailyPerformancePrediction>('DailyPerformancePrediction', DailyPerformancePredictionSchema);
