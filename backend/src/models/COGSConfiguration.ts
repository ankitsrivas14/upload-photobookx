import mongoose from 'mongoose';

const COGSFieldSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  smallValue: { type: Number, required: true, default: 0 },
  largeValue: { type: Number, required: true, default: 0 },
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
