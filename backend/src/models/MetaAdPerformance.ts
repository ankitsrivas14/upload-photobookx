import mongoose, { Schema, Document } from 'mongoose';

export interface IMetaAdPerformance extends Document {
  date: string; // YYYY-MM-DD
  level: 'campaign' | 'adset' | 'ad';
  name: string;
  status: string;
  spend: number;
  purchases: number;
  roas: number;
  reach: number;
  impressions: number;
  cpc?: number;
  ctr?: number;
  cpa?: number;
  clicks?: number;
  cpm?: number;
  frequency?: number;
  addsToCart?: number;
  outboundClicks?: number;
  dailyBudget?: number;
  videoPlays?: number;
  videoAvgPlayTime?: number;
  videoPlays25?: number;
  videoPlays50?: number;
  videoPlays75?: number;
  videoPlays95?: number;
  videoPlays100?: number;
  updatedAt: Date;
}

const MetaAdPerformanceSchema: Schema = new Schema({
  date: { type: String, required: true },
  level: { type: String, enum: ['campaign', 'adset', 'ad'], required: true },
  name: { type: String, required: true },
  status: { type: String, default: 'active' },
  spend: { type: Number, required: true },
  purchases: { type: Number, default: 0 },
  roas: { type: Number, default: 0 },
  reach: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  cpc: { type: Number },
  ctr: { type: Number },
  cpa: { type: Number },
  clicks: { type: Number },
  cpm: { type: Number },
  frequency: { type: Number },
  addsToCart: { type: Number },
  outboundClicks: { type: Number },
  dailyBudget: { type: Number },
  videoPlays: { type: Number },
  videoAvgPlayTime: { type: Number },
  videoPlays25: { type: Number },
  videoPlays50: { type: Number },
  videoPlays75: { type: Number },
  videoPlays95: { type: Number },
  videoPlays100: { type: Number },
}, {
  timestamps: true
});

// Index for fast searching by date and level
MetaAdPerformanceSchema.index({ date: 1, level: 1 });
MetaAdPerformanceSchema.index({ name: 1 });

export const MetaAdPerformance = mongoose.model<IMetaAdPerformance>('MetaAdPerformance', MetaAdPerformanceSchema);

export interface IMetaAdAnalysis extends Document {
  date: string;
  recommendations: any[];
  overallStrategy: string;
  chat?: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
}

const MetaAdAnalysisSchema: Schema = new Schema({
  date: { type: String, required: true, unique: true },
  recommendations: { type: [Schema.Types.Mixed], default: [] },
  overallStrategy: { type: String },
  chat: {
    type: [{
      role: { type: String, enum: ['user', 'assistant'] },
      content: { type: String },
      timestamp: { type: Date, default: Date.now }
    }],
    default: []
  }
}, { 
  timestamps: true 
});

export const MetaAdAnalysis = mongoose.model<IMetaAdAnalysis>('MetaAdAnalysis', MetaAdAnalysisSchema);
