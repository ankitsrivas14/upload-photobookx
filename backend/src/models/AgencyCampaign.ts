import mongoose, { Document, Schema } from 'mongoose';

/**
 * A campaign the agency created on a given day, logged manually.
 * `name` is matched (case/whitespace-insensitively) against MetaAdPerformance
 * campaign-level rows to derive spend / ROAS / purchases.
 */
export interface IAgencyCampaign extends Document {
  name: string;
  createdDate: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const agencyCampaignSchema = new Schema<IAgencyCampaign>({
  name: { type: String, required: true, trim: true },
  createdDate: { type: Date, required: true },
  notes: { type: String, trim: true, default: '' },
}, {
  timestamps: true
});

agencyCampaignSchema.index({ createdDate: -1 });

export const AgencyCampaign = mongoose.model<IAgencyCampaign>('AgencyCampaign', agencyCampaignSchema);
