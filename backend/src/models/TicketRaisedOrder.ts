import mongoose, { Schema, Document } from 'mongoose';

export interface ITicketRaisedOrder extends Document {
  shopifyOrderId: number;
  orderName: string;
  markedAt: Date;
  markedBy: mongoose.Types.ObjectId;
}

const TicketRaisedOrderSchema = new Schema<ITicketRaisedOrder>({
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
  markedAt: {
    type: Date,
    default: Date.now,
  },
  markedBy: {
    type: Schema.Types.ObjectId,
    ref: 'SuperUser',
    required: true,
  },
});

export default mongoose.model<ITicketRaisedOrder>('TicketRaisedOrder', TicketRaisedOrderSchema);
