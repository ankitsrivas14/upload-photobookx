import mongoose, { Schema, Document } from 'mongoose';

export interface IUploadedImage extends Document {
  magicLinkId: mongoose.Types.ObjectId;
  orderNumber: string;
  fileName: string;
  originalName: string;
  s3Key: string;
  s3Url: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: Date;
}

const UploadedImageSchema = new Schema<IUploadedImage>(
  {
    magicLinkId: {
      type: Schema.Types.ObjectId,
      ref: 'MagicLink',
      required: true,
      index: true,
    },
    orderNumber: {
      type: String,
      required: true,
      index: true,
    },
    fileName: {
      type: String,
      required: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    s3Key: {
      type: String,
      required: true,
    },
    s3Url: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IUploadedImage>('UploadedImage', UploadedImageSchema);
