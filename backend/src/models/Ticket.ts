import mongoose from 'mongoose';

const TicketSchema = new mongoose.Schema({
  orderNumber: { type: String, required: true },
  customerName: { type: String, required: true },
  awb: { type: String, required: true },
  courierName: { type: String, required: true },
  currentStatus: { type: String, required: true },
  activities: { type: Array, required: true },
  generatedMessage: { type: String, required: true },
  status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' }
}, {
  timestamps: true
});

export default mongoose.model('Ticket', TicketSchema);
