import mongoose, { Document, Schema } from 'mongoose';

export interface ISalaryAdvance extends Document {
  employeeId: mongoose.Types.ObjectId;
  date: Date;
  amount: number;
  reason: string;
  deductedInMonth?: string; // YYYY-MM
  createdAt: Date;
  updatedAt: Date;
}

const salaryAdvanceSchema = new Schema<ISalaryAdvance>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  date: { type: Date, required: true },
  amount: { type: Number, required: true },
  reason: { type: String },
  deductedInMonth: { type: String } 
}, {
  timestamps: true
});

export const SalaryAdvance = mongoose.model<ISalaryAdvance>('SalaryAdvance', salaryAdvanceSchema);
