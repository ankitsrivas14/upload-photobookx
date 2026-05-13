import express, { Response } from 'express';
import { requireAdmin } from './adminAuth';
import { AuthenticatedRequest } from '../types';
import { AbandonedCheckout, WhatsAppTemplate } from '../models';

const router = express.Router();

router.get('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Return all abandoned checkouts sorted by date (newest first)
    const checkouts = await AbandonedCheckout.find({}).sort({ createdAt: -1 });
    res.json({ success: true, checkouts });
  } catch (error) {
    console.error('Error fetching abandoned checkouts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch abandoned checkouts' });
  }
});

router.get('/template', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const template = await WhatsAppTemplate.findOne({ name: 'abandoned_checkout' });
    res.json({ success: true, message: template ? template.message : '' });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch template' });
  }
});

router.post('/template', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { message } = req.body;
    if (typeof message !== 'string') {
      res.status(400).json({ success: false, error: 'Message is required' });
      return;
    }

    await WhatsAppTemplate.updateOne(
      { name: 'abandoned_checkout' },
      { $set: { message, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ success: true, message: 'Template saved successfully' });
  } catch (error) {
    console.error('Error saving template:', error);
    res.status(500).json({ success: false, error: 'Failed to save template' });
  }
});

router.post('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { textData } = req.body;
    if (!textData || typeof textData !== 'string') {
      res.status(400).json({ success: false, error: 'No text data provided' });
      return;
    }

    const lines = textData.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const records = [];
    let currentRecord: any = null;
    
    // e.g. 13 May 2026 at 19:02
    const dateRegex = /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+at\s+\d{2}:\d{2}$/;
    const phoneRegex = /^(?:\+91|91)?[6-9]\d{9}$|^\+91\d{10}$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (dateRegex.test(line)) {
        if (currentRecord && currentRecord.phone && currentRecord.name) {
          records.push(currentRecord);
        }
        currentRecord = { dateStr: line };
      } else if (currentRecord) {
        // Find phone number
        const cleanPhone = line.replace(/\s+/g, '');
        if (!currentRecord.phone && phoneRegex.test(cleanPhone)) {
          currentRecord.phone = line;
          
          // The next non-empty line should be the name, unless it's a known keyword
          if (i + 1 < lines.length) {
            const nextLine = lines[i+1];
            if (!nextLine.includes('Payment Page') && !nextLine.includes('Payment Method') && !nextLine.includes('Information Page') && !nextLine.includes('Shipping') && nextLine !== 'Yes' && nextLine !== 'No') {
              currentRecord.name = nextLine;
            }
          }
        }
      }
    }
    
    if (currentRecord && currentRecord.phone && currentRecord.name) {
      records.push(currentRecord);
    }

    let inserted = 0;
    let skipped = 0;

    if (records.length > 0) {
      try {
        const operations = records.map(record => ({
          insertOne: {
            document: {
              phone: record.phone,
              dateStr: record.dateStr,
              name: record.name
            }
          }
        }));

        const result = await AbandonedCheckout.bulkWrite(operations, { ordered: false });
        inserted = result.insertedCount;
      } catch (err: any) {
        // Bulk write error will be thrown if some documents have duplicate keys
        if (err.code === 11000 || err.name === 'BulkWriteError') {
          inserted = err.result?.nInserted || 0;
        } else {
          throw err;
        }
      }
      skipped = records.length - inserted;
    }

    res.json({ 
      success: true, 
      message: `Processed ${records.length} records. Inserted ${inserted} new leads. Skipped ${skipped} duplicates.`, 
      inserted,
      skipped,
      records 
    });
  } catch (error) {
    console.error('Error processing abandoned checkouts:', error);
    res.status(500).json({ success: false, error: 'Failed to process data' });
  }
});

router.put('/:id/status', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'message_sent', 'not_required'].includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid status' });
      return;
    }

    const updated = await AbandonedCheckout.findByIdAndUpdate(
      id,
      { $set: { status } },
      { new: true }
    );

    if (!updated) {
      res.status(404).json({ success: false, error: 'Record not found' });
      return;
    }

    res.json({ success: true, checkout: updated });
  } catch (error) {
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, error: 'Failed to update status' });
  }
});

export default router;
