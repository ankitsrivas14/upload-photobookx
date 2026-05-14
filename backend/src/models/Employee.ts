import mongoose, { Document, Schema } from 'mongoose';

export interface IEmployee extends Document {
  name: string;
  monthlySalary: number;
  joiningDate: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const employeeSchema = new Schema<IEmployee>({
  name: { type: String, required: true },
  monthlySalary: { type: Number, required: true },
  joiningDate: { type: Date, required: true },
  isActive: { type: Boolean, default: true },
}, {
  timestamps: true
});

export const Employee = mongoose.model<IEmployee>('Employee', employeeSchema);
