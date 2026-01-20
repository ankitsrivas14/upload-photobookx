import mongoose, { Schema, Document } from 'mongoose';

export interface IDiscardedOrder extends Document {
  shopifyOrderId: number;
  orderName: string;
  discardedAt: Date;
  discardedBy: mongoose.Types.ObjectId;
}

const DiscardedOrderSchema = new Schema<IDiscardedOrder>({
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
  discardedAt: {
    type: Date,
    default: Date.now,
  },
  discardedBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    required: true,
  },
});

export default mongoose.model<IDiscardedOrder>('DiscardedOrder', DiscardedOrderSchema);
