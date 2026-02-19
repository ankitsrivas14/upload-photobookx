import mongoose, { Schema, Document } from 'mongoose';

export interface IShippingCharge extends Document {
  orderNumber: string; // Shopify order number (e.g., "PB1159S")
  shippingCharge: number; // TOTAL amount paid to Shiprocket (in INR)
  
  // Detailed breakdown of charges
  freightForward: number; // Forward shipping charge
  freightCOD: number; // COD handling charge (positive if applied, negative if reversed)
  freightRTO: number; // RTO/return shipping charge
  whatsappCharges: number; // WhatsApp communication charges
  otherCharges: number; // Any other charges
  
  shiprocketOrderId?: number; // Shiprocket's internal order ID
  awbCode?: string; // AWB tracking code
  courierName?: string; // Courier company name
  weight?: number; // Package weight in kg
  status?: string; // Shipment status (e.g., "Delivered", "In Transit")
  fetchedAt: Date; // When this was fetched from Shiprocket
  updatedAt: Date;
}

const ShippingChargeSchema = new Schema<IShippingCharge>({
  orderNumber: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  shippingCharge: {
    type: Number,
    required: true,
  },
  freightForward: {
    type: Number,
    default: 0,
  },
  freightCOD: {
    type: Number,
    default: 0,
  },
  freightRTO: {
    type: Number,
    default: 0,
  },
  whatsappCharges: {
    type: Number,
    default: 0,
  },
  otherCharges: {
    type: Number,
    default: 0,
  },
  shiprocketOrderId: {
    type: Number,
  },
  awbCode: {
    type: String,
  },
  courierName: {
    type: String,
  },
  weight: {
    type: Number,
  },
  status: {
    type: String,
  },
  fetchedAt: {
    type: Date,
    required: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model<IShippingCharge>('ShippingCharge', ShippingChargeSchema);
