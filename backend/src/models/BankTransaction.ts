import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBankTransaction extends Document {
    date: string; // Storing as string to match HDFC format exactly for now
    narration: string;
    reference: string;
    withdrawal: number;
    deposit: number;
    balance: number;
    category: string;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const BankTransactionSchema = new Schema<IBankTransaction>(
    {
        date: {
            type: String,
            required: true,
        },
        narration: {
            type: String,
            required: true,
            trim: true,
        },
        reference: {
            type: String,
            trim: true,
        },
        withdrawal: {
            type: Number,
            default: 0,
        },
        deposit: {
            type: Number,
            default: 0,
        },
        balance: {
            type: Number,
            default: 0,
        },
        category: {
            type: String,
            required: true,
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

// Index for common queries
BankTransactionSchema.index({ category: 1 });
BankTransactionSchema.index({ date: 1 });

export const BankTransaction = mongoose.model<IBankTransaction>('BankTransaction', BankTransactionSchema);
