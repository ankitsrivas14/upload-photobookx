import mongoose, { Document, Schema } from 'mongoose';

export interface IHourlyLog extends Document {
  employeeId: mongoose.Types.ObjectId;
  dateStr: string; // YYYY-MM-DD
  hoursWorked: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const HourlyLogSchema = new Schema<IHourlyLog>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  dateStr: { type: String, required: true },
  hoursWorked: { type: Number, required: true, min: 0, max: 24 },
  notes: { type: String },
}, {
  timestamps: true
});

// One log per employee per day
HourlyLogSchema.index({ employeeId: 1, dateStr: 1 }, { unique: true });

export const HourlyLog = mongoose.model<IHourlyLog>('HourlyLog', HourlyLogSchema);
