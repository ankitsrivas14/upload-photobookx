import mongoose, { Schema, Document } from 'mongoose';

export interface IProcessedNoCodOrder extends Document {
  shopifyOrderId: number;
  orderName: string;
  processedAt: Date;
}

const ProcessedNoCodOrderSchema = new Schema<IProcessedNoCodOrder>({
  shopifyOrderId: {
    type: Number,
    required: true,
    unique: true,
    index: true,
  },
  orderName: {
    type: String,
    required: true,
  },
  processedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model<IProcessedNoCodOrder>('ProcessedNoCodOrder', ProcessedNoCodOrderSchema);
