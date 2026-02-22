import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBankCategory extends Document {
    name: string;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const BankCategorySchema = new Schema<IBankCategory>(
    {
        name: {
            type: String,
            required: true,
            unique: true,
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

export const BankCategory = mongoose.model<IBankCategory>('BankCategory', BankCategorySchema);
