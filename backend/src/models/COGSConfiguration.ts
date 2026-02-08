import mongoose from 'mongoose';

const COGSFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  // Support both old and new structure for backwards compatibility
  smallValue: { type: Number, default: 0 }, // Deprecated, kept for migration
  largeValue: { type: Number, default: 0 }, // Deprecated, kept for migration
  // New structure with payment method support
  smallPrepaidValue: { type: Number, default: 0 },
  smallCODValue: { type: Number, default: 0 },
  largePrepaidValue: { type: Number, default: 0 },
  largeCODValue: { type: Number, default: 0 },
  type: { type: String, enum: ['cogs', 'ndr', 'both'], default: 'cogs' },
  calculationType: { type: String, enum: ['fixed', 'percentage'], default: 'fixed' },
  percentageType: { type: String, enum: ['included', 'excluded'], default: 'excluded' },
});

const COGSConfigurationSchema = new mongoose.Schema({
  fields: [COGSFieldSchema],
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

// We'll only keep one configuration document
COGSConfigurationSchema.pre('save', function() {
  this.updatedAt = new Date();
});

export const COGSConfiguration = mongoose.model('COGSConfiguration', COGSConfigurationSchema);
