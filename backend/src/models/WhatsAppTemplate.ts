import mongoose, { Document, Schema } from 'mongoose';

export interface IWhatsAppTemplate extends Document {
  name: string; // e.g., 'abandoned_checkout'
  message: string;
  updatedAt: Date;
}

const WhatsAppTemplateSchema = new Schema({
  name: { type: String, required: true, unique: true },
  message: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
});

export const WhatsAppTemplate = mongoose.model<IWhatsAppTemplate>('WhatsAppTemplate', WhatsAppTemplateSchema);
