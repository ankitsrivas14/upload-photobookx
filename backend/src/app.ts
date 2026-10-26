import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import config from './config';
import adminAuthRoutes, { requireAdmin } from './routes/adminAuth';
import type { AuthenticatedRequest } from './types';
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
import claudeAnalysisRoutes from './routes/claudeAnalysis';
import metaRoutes from './routes/meta';
import stockRoutes from './routes/stock';
import shippingRoutes from './routes/shipping';

/**
 * The configured Express app — no `listen`, no DB connect at import time. Used by both the
 * local/Render server entry (`index.ts`) and the Cloud Functions entry (`functions.ts`).
 */
const app = express();

// CORS — allow the production upload domain plus whatever FRONTEND_URL holds.
// FRONTEND_URL may be a single origin or a comma-separated list (so multiple
// deploy targets — Vercel prod, previews, a custom admin domain — can be allowed
// without a code change). Trailing slashes are ignored on both sides.
const normalizeOrigin = (o: string) => o.trim().replace(/\/+$/, '');
const allowedOrigins = [
  ...String(config.frontendUrl || '').split(','),
  // Both hostnames are useful during local development: the browser may resolve
  // `localhost` to IPv6 while the Vite process is bound on IPv4.
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://upload.photobookx.com',
]
  .map(normalizeOrigin)
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser requests
    if (allowedOrigins.includes(normalizeOrigin(origin))) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition'], // Allow frontend to read Content-Disposition header
  // Let browsers reuse a preflight for 2 hours (Chrome's cap) instead of ~5 seconds, so most
  // API calls no longer pay an extra OPTIONS round trip.
  maxAge: 7200,
}));
app.use(express.json());
// Gzip JSON responses; large order lists shrink by roughly 85-90%.
app.use(compression());

// Liveness check — a pure ping that touches no database.
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Deny by default: every /api/admin route needs an admin token unless it is listed here, so a
// handler that forgets `requireAdmin` is still protected. Runs before every route, so
// unauthenticated requests never touch the database.
const PUBLIC_ADMIN_PATHS = new Set(['/auth/login', '/auth/register']);
app.use('/api/admin', (req: Request, res: Response, next: NextFunction) => {
  if (PUBLIC_ADMIN_PATHS.has(req.path)) return next();
  requireAdmin(req as AuthenticatedRequest, res, next);
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
app.use('/api/admin/claude-analysis', claudeAnalysisRoutes);
app.use('/api/admin/meta', metaRoutes);
app.use('/api/admin/stock', stockRoutes);
app.use('/api/admin/shipping', shippingRoutes);
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
