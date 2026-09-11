import { onRequest } from 'firebase-functions/v2/https';
import { app } from './app';

/**
 * Cloud Functions (gen2) entry — the whole Express app behind one HTTPS function.
 *
 * Declared secrets are mounted into the instance environment at runtime, so `config`
 * (which reads `process.env`) resolves them normally. Region asia-south1 (Mumbai) matches
 * the store's India operations and the existing AWS ap-south-1 S3 bucket.
 *
 * Timeout is generous because two endpoints are legitimately long: the multi-batch OpenAI
 * ads analysis and the per-order zip download.
 */
const secrets = [
  'MONGO_URI',
  'JWT_SECRET',
  'FRONTEND_URL',
  'ADMIN_REGISTRATION_SECRET',
  'PRINTED_PHOTOS_PRODUCT_ID',
  'SHOPIFY_STORE_DOMAIN',
  'SHOPIFY_ACCESS_TOKEN',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'AWS_S3_BUCKET',
  'SHIPROCKET_API_EMAIL',
  'SHIPROCKET_API_PASSWORD',
  'OPENAI_API_KEY',
  'DELHIVERY_API_KEY',
  'DELHIVERY_API_URL',
  'DELHIVERY_PICKUP_LOCATION',
  'META_ACCESS_TOKEN',
  'META_AD_ACCOUNT_ID',
];

export const api = onRequest(
  {
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
    secrets,
  },
  app
);
