import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IMetaAdsExpense extends Document {
  amount: number;
  date: Date;
  sourceId: Types.ObjectId;
  sourceName: string; // Denormalized for easier queries
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MetaAdsExpenseSchema = new Schema<IMetaAdsExpense>(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    date: {
      type: Date,
      required: true,
    },
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: 'ExpenseSource',
      required: true,
    },
    sourceName: {
      type: String,
      required: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'SuperUser',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient date queries
MetaAdsExpenseSchema.index({ date: -1 });
MetaAdsExpenseSchema.index({ sourceId: 1 });

export const MetaAdsExpense = mongoose.model<IMetaAdsExpense>('MetaAdsExpense', MetaAdsExpenseSchema);
