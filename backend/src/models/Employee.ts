import mongoose, { Document, Schema } from 'mongoose';

export interface IEmployee extends Document {
  name: string;
  employeeType: 'monthly' | 'hourly';
  monthlySalary: number;
  hourlyRate: number;
  joiningDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const employeeSchema = new Schema<IEmployee>({
  name: { type: String, required: true },
  employeeType: { type: String, enum: ['monthly', 'hourly'], default: 'monthly' },
  monthlySalary: { type: Number, default: 0 },
  hourlyRate: { type: Number, default: 0 },
  joiningDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true
});

export const Employee = mongoose.model<IEmployee>('Employee', employeeSchema);
