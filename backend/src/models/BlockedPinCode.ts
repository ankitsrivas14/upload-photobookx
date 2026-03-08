import mongoose, { Schema, Document } from 'mongoose';

export interface IBlockedPinCode extends Document {
    pinCode: string;
    notes?: string;
    createdAt: Date;
}

const BlockedPinCodeSchema: Schema = new Schema({
    pinCode: { type: String, required: true, unique: true },
    notes: { type: String, required: false },
    createdAt: { type: Date, default: Date.now },
});

export default mongoose.model<IBlockedPinCode>('BlockedPinCode', BlockedPinCodeSchema);
