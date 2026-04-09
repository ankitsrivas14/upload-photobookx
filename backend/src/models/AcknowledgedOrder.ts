import mongoose, { Schema, Document } from 'mongoose';

export interface IAcknowledgedOrder extends Document {
  shopifyOrderId: number;
  orderName: string;
  acknowledgedAt: Date;
  acknowledgedBy: mongoose.Types.ObjectId;
}

const AcknowledgedOrderSchema = new Schema<IAcknowledgedOrder>({
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
  acknowledgedAt: {
    type: Date,
    default: Date.now,
  },
  acknowledgedBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    required: true,
  },
});

export default mongoose.model<IAcknowledgedOrder>('AcknowledgedOrder', AcknowledgedOrderSchema);
