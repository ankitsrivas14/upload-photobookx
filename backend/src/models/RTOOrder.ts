import mongoose, { Schema, Document } from 'mongoose';

export interface IRTOOrder extends Document {
  shopifyOrderId: number;
  orderName: string;
  markedRTOAt: Date;
  markedRTOBy: mongoose.Types.ObjectId;
  notes?: string;
}

const RTOOrderSchema = new Schema<IRTOOrder>({
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
  markedRTOAt: {
    type: Date,
    default: Date.now,
  },
  markedRTOBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    required: true,
  },
  notes: {
    type: String,
  },
});

export default mongoose.model<IRTOOrder>('RTOOrder', RTOOrderSchema);
