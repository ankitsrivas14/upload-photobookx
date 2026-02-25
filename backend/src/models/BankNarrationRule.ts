import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBankNarrationRule extends Document {
    keyword: string;
    nickname: string;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const BankNarrationRuleSchema = new Schema<IBankNarrationRule>(
    {
        keyword: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        nickname: {
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

export const BankNarrationRule = mongoose.model<IBankNarrationRule>('BankNarrationRule', BankNarrationRuleSchema);
