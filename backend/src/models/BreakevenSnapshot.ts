import mongoose, { Document, Schema } from 'mongoose';

/**
 * A tiny singleton doc holding the last computed breakeven metrics, so the dashboard
 * endpoint reads a pre-computed result instead of scanning the full order cache on
 * every request. Refreshed by the scheduled refresh job.
 */
export interface IBreakevenSnapshot extends Document {
  key: string; // always 'latest'
  metrics: Record<string, number>;
  updatedAt: Date;
}

const schema = new Schema<IBreakevenSnapshot>(
  {
    key: { type: String, required: true, unique: true, index: true },
    metrics: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

export const BreakevenSnapshot = mongoose.model<IBreakevenSnapshot>('BreakevenSnapshot', schema);
