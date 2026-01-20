import mongoose from 'mongoose';

const DailyAdSpendSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true
  },
  notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Index for querying by date
DailyAdSpendSchema.index({ date: 1, createdAt: -1 });

export const DailyAdSpend = mongoose.model('DailyAdSpend', DailyAdSpendSchema);
