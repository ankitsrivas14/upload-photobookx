import mongoose, { Document, Schema } from 'mongoose';

export interface IReelStrategy extends Document {
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const reelStrategySchema = new Schema<IReelStrategy>({
  name: { type: String, required: true, trim: true },
}, {
  timestamps: true
});

export const ReelStrategy = mongoose.model<IReelStrategy>('ReelStrategy', reelStrategySchema);
