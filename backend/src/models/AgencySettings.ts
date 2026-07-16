import mongoose, { Document, Schema } from 'mongoose';

/**
 * Singleton settings for the Agency page.
 * `namePrefixes` decides which campaigns belong to the agency: a campaign is the
 * agency's if its name starts with any one of these strings (case-insensitive).
 * An empty list means "no filter configured" — everything is kept.
 */
export interface IAgencySettings extends Document {
  key: string;
  namePrefixes: string[];
  createdAt: Date;
  updatedAt: Date;
}

const agencySettingsSchema = new Schema<IAgencySettings>({
  key: { type: String, required: true, unique: true, default: 'default' },
  namePrefixes: { type: [String], default: [] },
}, {
  timestamps: true
});

export const AgencySettings = mongoose.model<IAgencySettings>('AgencySettings', agencySettingsSchema);
