import mongoose, { Schema, Document } from 'mongoose';

export interface ICodAddedCity extends Document {
    city: string;
    addedAt: Date;
}

const CodAddedCitySchema: Schema = new Schema({
    city:    { type: String, required: true, unique: true },
    addedAt: { type: Date, default: Date.now },
});

export default mongoose.model<ICodAddedCity>('CodAddedCity', CodAddedCitySchema);
