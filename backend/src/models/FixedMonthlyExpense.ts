import mongoose from 'mongoose';

export interface IFixedMonthlyExpense extends mongoose.Document {
  month: string; // YYYY-MM
  label: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
}

const FixedMonthlyExpenseSchema = new mongoose.Schema(
  {
    month: { type: String, required: true }, // e.g. "2026-05"
    label: { type: String, required: true },
    amount: { type: Number, required: true },
  },
  { timestamps: true }
);

FixedMonthlyExpenseSchema.index({ month: 1 });

export const FixedMonthlyExpense = mongoose.model<IFixedMonthlyExpense>(
  'FixedMonthlyExpense',
  FixedMonthlyExpenseSchema
);
