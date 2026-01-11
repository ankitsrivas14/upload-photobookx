import 'dotenv/config';

interface Config {
  port: number;
  nodeEnv: string;
  mongoUri: string;
  shopify: {
    storeDomain: string;
    accessToken: string;
    printedPhotosProductId: string;
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
