import mongoose, { Document, Schema } from 'mongoose';

export interface ISalaryPayment extends Document {
  employeeId: mongoose.Types.ObjectId;
  month: string; // YYYY-MM
  amountPaid: number;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const salaryPaymentSchema = new Schema<ISalaryPayment>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  month: { type: String, required: true },
  amountPaid: { type: Number, required: true },
  paidAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

salaryPaymentSchema.index({ employeeId: 1, month: 1 }, { unique: true });

export const SalaryPayment = mongoose.model<ISalaryPayment>('SalaryPayment', salaryPaymentSchema);
