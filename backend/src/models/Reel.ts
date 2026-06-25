import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IReel extends Document {
  name: string;
  url: string;
  date: Date;
  // Strategies marked (ticked) for this reel
  strategyIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const reelSchema = new Schema<IReel>({
  name: { type: String, required: true, trim: true },
  url: { type: String, required: true, trim: true },
  date: { type: Date, required: true },
  strategyIds: [{ type: Schema.Types.ObjectId, ref: 'ReelStrategy' }],
}, {
  timestamps: true
});

export const Reel = mongoose.model<IReel>('Reel', reelSchema);
