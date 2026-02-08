import { Router, Response } from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import OrderDeliveryDate from '../models/OrderDeliveryDate';
import { requireAdmin } from './adminAuth';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// Configure multer for CSV upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

/**
 * POST /api/admin/delivery-dates/upload
 * Upload CSV file with delivery dates
 */
router.post('/upload', requireAdmin, upload.single('csv'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No CSV file uploaded' });
    }

    const results: Array<{ orderNumber: string; deliveredAt: Date }> = [];
    const errors: Array<string> = [];

    // Parse CSV from buffer
    const stream = Readable.from(req.file.buffer.toString());
    
    stream
      .pipe(csv())
      .on('data', (row) => {
        try {
          const orderNumber = row['Order ID']?.trim();
          const deliveredDateStr = row['Order Delivered Date']?.trim();

          // Skip if no order number or delivered date
          if (!orderNumber || !deliveredDateStr || deliveredDateStr === 'N/A' || deliveredDateStr === '') {
            return;
          }

          // Parse the date
          const deliveredAt = new Date(deliveredDateStr);
          
          // Validate date
          if (isNaN(deliveredAt.getTime())) {
            errors.push(`Invalid date for order ${orderNumber}: ${deliveredDateStr}`);
            return;
          }

          results.push({ orderNumber, deliveredAt });
        } catch (error) {
          errors.push(`Error parsing row: ${error}`);
        }
      })
      .on('end', async () => {
        try {
          // Bulk upsert delivery dates
          const bulkOps = results.map(({ orderNumber, deliveredAt }) => ({
            updateOne: {
              filter: { orderNumber },
              update: {
                $set: {
                  orderNumber,
                  deliveredAt,
                  source: 'csv' as 'csv' | 'shopify',
                  updatedAt: new Date(),
                },
              },
              upsert: true,
            },
          }));

          if (bulkOps.length > 0) {
            await OrderDeliveryDate.bulkWrite(bulkOps as any);
          }

          res.json({
            success: true,
            message: `Successfully processed ${results.length} delivery dates`,
            stats: {
              processed: results.length,
              errors: errors.length,
            },
            errors: errors.length > 0 ? errors.slice(0, 10) : undefined, // Return first 10 errors
          });
        } catch (dbError) {
          console.error('Database error:', dbError);
          res.status(500).json({
            success: false,
            error: 'Failed to save delivery dates to database',
          });
        }
      })
      .on('error', (error) => {
        console.error('CSV parsing error:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to parse CSV file',
        });
      });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload CSV',
    });
  }
});

/**
 * GET /api/admin/delivery-dates/stats
 * Get statistics about stored delivery dates
 */
router.get('/stats', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const total = await OrderDeliveryDate.countDocuments();
    const csvCount = await OrderDeliveryDate.countDocuments({ source: 'csv' });
    const shopifyCount = await OrderDeliveryDate.countDocuments({ source: 'shopify' });

    res.json({
      success: true,
      stats: {
        total,
        fromCSV: csvCount,
        fromShopify: shopifyCount,
      },
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get delivery date stats',
    });
  }
});

export default router;
