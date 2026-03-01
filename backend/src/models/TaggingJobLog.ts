import mongoose, { Schema, Document } from 'mongoose';

export interface ITaggingJobLog extends Document {
    startedAt: Date;
    completedAt: Date;
    outcome: 'success' | 'error' | 'skipped';
    taggedCount: number;
    taggedCustomers: Array<{
        customerId: number;
        orderNumber: string;
    }>;
    errorMessage?: string;
}

const TaggingJobLogSchema = new Schema<ITaggingJobLog>({
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, required: true },
    outcome: { type: String, enum: ['success', 'error', 'skipped'], required: true },
    taggedCount: { type: Number, required: true, default: 0 },
    taggedCustomers: [{
        customerId: { type: Number, required: true },
        orderNumber: { type: String, required: true },
    }],
    errorMessage: { type: String },
});

export default mongoose.model<ITaggingJobLog>('TaggingJobLog', TaggingJobLogSchema);
