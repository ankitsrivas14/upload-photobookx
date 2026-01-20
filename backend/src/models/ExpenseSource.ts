import mongoose, { Schema, Document } from 'mongoose';

export interface IExpenseSource extends Document {
  name: string;
  category: 'meta-ads' | 'other';
  createdAt: Date;
  updatedAt: Date;
}

const ExpenseSourceSchema = new Schema<IExpenseSource>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['meta-ads', 'other'],
      default: 'meta-ads',
    },
  },
  {
    timestamps: true,
  }
);

// Ensure unique source names per category
ExpenseSourceSchema.index({ name: 1, category: 1 }, { unique: true });

export const ExpenseSource = mongoose.model<IExpenseSource>('ExpenseSource', ExpenseSourceSchema);
