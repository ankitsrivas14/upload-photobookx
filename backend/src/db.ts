import mongoose from 'mongoose';
import config from './config';

/**
 * Cached Mongo connection.
 *
 * On Cloud Functions each warm instance handles many requests, so we connect once and
 * reuse the connection across invocations rather than reconnecting per request. The
 * promise is memoised; if the first connect fails it's cleared so a later request can retry
 * (instead of a poisoned rejected promise sticking forever). `serverSelectionTimeoutMS` keeps
 * a cold Atlas outage from hanging the request — it fails fast and returns 503.
 */
let connPromise: Promise<typeof mongoose> | null = null;

export function connectMongo(): Promise<typeof mongoose> {
  if (!connPromise) {
    connPromise = mongoose
      .connect(config.mongoUri, { serverSelectionTimeoutMS: 8000 })
      .catch((err) => {
        connPromise = null; // allow retry on the next request
        throw err;
      });
  }
  return connPromise;
}
