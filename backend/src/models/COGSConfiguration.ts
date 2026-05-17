import mongoose from 'mongoose';

const COGSFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  // 'pre' = pre-production costs, 'post' = post-production costs. Default 'pre' for migration.
  category: { type: String, enum: ['pre', 'post'], default: 'pre' },
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

const TotalOverrideSchema = new mongoose.Schema({
  smallPrepaidValue: { type: Number },
  smallCODValue: { type: Number },
  largePrepaidValue: { type: Number },
  largeCODValue: { type: Number },
}, { _id: false });

const COGSConfigurationSchema = new mongoose.Schema({
  fields: [COGSFieldSchema],
  // Per-category total overrides. When set, replaces field-level summation for that column.
  totalOverrides: {
    pre: { type: TotalOverrideSchema, default: {} },
    post: { type: TotalOverrideSchema, default: {} },
  },
  // Applies to all orders on/after this date. Migration default: start of time.
  effectiveFrom: { type: Date, required: true, default: new Date('2000-01-01') },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

COGSConfigurationSchema.pre('save', function() {
  this.updatedAt = new Date();
});

export const COGSConfiguration = mongoose.model('COGSConfiguration', COGSConfigurationSchema);
