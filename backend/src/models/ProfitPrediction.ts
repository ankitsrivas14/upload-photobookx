import mongoose, { Schema, Document } from 'mongoose';

export interface IProfitPrediction extends Document {
  monthYear: string; // YYYY-MM
  predictedFinalProfit: number;
  predictedOrders: number;
  predictedNDR: number;
  reasoning?: string;
  lastUpdated: Date;
  status: 'active' | 'archived';
}

const ProfitPredictionSchema: Schema = new Schema({
  monthYear: { type: String, required: true },
  predictedFinalProfit: { type: Number, required: true },
  predictedOrders: { type: Number, default: 0 },
  predictedNDR: { type: Number, default: 0 },
  reasoning: { type: String },
  lastUpdated: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'archived'], default: 'active' }
}, { timestamps: true });

// Ensure we only have one 'active' prediction per month
ProfitPredictionSchema.index({ monthYear: 1, status: 1 }, { 
  unique: true, 
  partialFilterExpression: { status: 'active' } 
});

export default mongoose.model<IProfitPrediction>('ProfitPrediction', ProfitPredictionSchema);
