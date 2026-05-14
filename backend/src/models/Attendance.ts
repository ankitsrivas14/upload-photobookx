import mongoose, { Document, Schema } from 'mongoose';

export interface IAttendance extends Document {
  employeeId: mongoose.Types.ObjectId;
  dateStr: string; // YYYY-MM-DD format in local timezone
  status: 'present' | 'absent' | 'half-day' | 'holiday';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<IAttendance>({
  employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
  dateStr: { type: String, required: true },
  status: { type: String, enum: ['present', 'absent', 'half-day', 'holiday'], required: true },
  notes: { type: String }
}, {
  timestamps: true
});

attendanceSchema.index({ employeeId: 1, dateStr: 1 }, { unique: true });

export const Attendance = mongoose.model<IAttendance>('Attendance', attendanceSchema);
