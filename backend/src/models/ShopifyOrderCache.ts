import mongoose, { Schema, Document } from 'mongoose';

export interface IShopifyOrderCache extends Document {
  cacheKey: string; // 'all_orders_250' or 'printed_photos_50' etc.
  orders: any[]; // Array of Shopify order objects
  cachedAt: Date;
  expiresAt: Date;
}

const ShopifyOrderCacheSchema = new Schema<IShopifyOrderCache>({
  cacheKey: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  orders: {
    type: Schema.Types.Mixed,
    required: true,
    default: [],
  },
  cachedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true,
  },
});

// Index for automatic cleanup of expired cache entries
ShopifyOrderCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ShopifyOrderCache = mongoose.model<IShopifyOrderCache>('ShopifyOrderCache', ShopifyOrderCacheSchema);

export default ShopifyOrderCache;
