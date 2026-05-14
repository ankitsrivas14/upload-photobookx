import mongoose, { Schema, Document } from 'mongoose';

export interface IAttendanceAuditLog extends Document {
  action: string;
  employeeId?: mongoose.Types.ObjectId;
  details: string;
  adminUser?: string;
  createdAt: Date;
}

const AttendanceAuditLogSchema = new Schema({
  action: { type: String, required: true },
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee' },
  details: { type: String, required: true },
  adminUser: { type: String },
  createdAt: { type: Date, default: Date.now }
});

export const AttendanceAuditLog = mongoose.model<IAttendanceAuditLog>('AttendanceAuditLog', AttendanceAuditLogSchema);
