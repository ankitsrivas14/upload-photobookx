import 'dotenv/config';

interface Config {
  port: number;
  nodeEnv: string;
  shopify: {
    storeDomain: string;
    accessToken: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  frontendUrl: string;
}

const config: Config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  
  shopify: {
    storeDomain: process.env.SHOPIFY_STORE_DOMAIN || '',
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
    expiresIn: '7d',
  },
  
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};

export default config;
