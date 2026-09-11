import dotenv from 'dotenv';

// Local dev loads its env from `.env.local` (resolves to backend/.env.local from both
// src/ and dist/). It is deliberately NOT named `.env`: Firebase Functions auto-ingests a
// `.env` in the functions source dir and rejects reserved keys such as PORT, which broke
// deploys. On Cloud Functions the values come from Secret Manager, and on Render from the
// dashboard, so in those environments this simply finds no file and does nothing.
dotenv.config({ path: `${__dirname}/../../.env.local` });

interface Config {
  port: number;
  nodeEnv: string;
  mongoUri: string;
  shopify: {
    storeDomain: string;
    accessToken: string;
    printedPhotosProductId: string;
  };
  shiprocket: {
    email: string;
    password: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  aws: {
    accessKeyId: string;
    secretAccessKey: string;
    region: string;
    s3Bucket: string;
  };
  frontendUrl: string;
}

const config: Config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks',
  
  shopify: {
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN || '',
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
    printedPhotosProductId: process.env.PRINTED_PHOTOS_PRODUCT_ID || '9990160548160',
  },
  
  shiprocket: {
    email: process.env.SHIPROCKET_API_EMAIL || '',
    password: process.env.SHIPROCKET_API_PASSWORD || '',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
    expiresIn: '7d',
  },
  
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'ap-south-1',
    s3Bucket: process.env.AWS_S3_BUCKET || '',
  },
  
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};

export default config;
