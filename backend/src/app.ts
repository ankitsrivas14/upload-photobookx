import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import config from './config';
import { connectMongo } from './db';
import adminAuthRoutes from './routes/adminAuth';
import magicLinksRoutes from './routes/magicLinks';
import uploadRoutes from './routes/upload';
import expensesRoutes from './routes/expenses';
import salesRoutes from './routes/sales';
import cogsRoutes from './routes/cogs';
import fixedMonthlyExpensesRoutes from './routes/fixedMonthlyExpenses';
import deliveryDatesRoutes from './routes/deliveryDates';
import bankAccountRoutes from './routes/bankAccount';
import pincodesRoutes from './routes/pincodes';
import abandonedCheckoutsRoutes from './routes/abandonedCheckouts';
import attendanceRoutes from './routes/attendance';
import reelsRoutes from './routes/reels';
import agencyRoutes from './routes/agency';

/**
 * The configured Express app — no `listen`, no DB connect at import time. Used by both the
 * local/Render server entry (`index.ts`) and the Cloud Functions entry (`functions.ts`).
 */
const app = express();

// CORS — allow the configured frontend origin plus the production upload domain.
// FRONTEND_URL should be set to the Vercel/Firebase Hosting origin in each environment.
const allowedOrigins = [config.frontendUrl, 'https://upload.photobookx.com'].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser requests
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition'], // Allow frontend to read Content-Disposition header
}));
app.use(express.json());

// Liveness check — deliberately BEFORE the DB-ensure middleware so it stays a pure ping
// even if Mongo is unreachable.
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Ensure Mongo is connected before any route handler runs. On Cloud Functions this connects
// once per warm instance and is a no-op thereafter; a cold-start Atlas failure returns 503
// rather than hanging or crashing the instance.
app.use((_req: Request, res: Response, next: NextFunction) => {
  connectMongo().then(() => next()).catch((err) => {
    console.error('❌ MongoDB connection error:', err);
    res.status(503).json({ success: false, error: 'Database unavailable' });
  });
});

// Routes
app.use('/api/admin/auth', adminAuthRoutes);
app.use('/api/admin/magic-links', magicLinksRoutes);
app.use('/api/admin/expenses', expensesRoutes);
app.use('/api/admin/sales', salesRoutes);
app.use('/api/admin/cogs', cogsRoutes);
app.use('/api/admin/fixed-monthly-expenses', fixedMonthlyExpensesRoutes);
app.use('/api/admin/bank-account', bankAccountRoutes);
app.use('/api/admin/delivery-dates', deliveryDatesRoutes);
app.use('/api/admin/pincodes', pincodesRoutes);
app.use('/api/admin/abandoned-checkouts', abandonedCheckoutsRoutes);
app.use('/api/admin/attendance', attendanceRoutes);
app.use('/api/admin/reels', reelsRoutes);
app.use('/api/admin/agency', agencyRoutes);
app.use('/api/upload', uploadRoutes);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export { app };
