import express, { Response } from 'express';
import { requireAdmin } from './adminAuth';
import { AuthenticatedRequest } from '../types';
import { createHash } from 'crypto';
import { abandonedCheckoutStore, whatsAppTemplateStore } from '../db/featureStores';

const router = express.Router();

// Newest paste first; within one paste (same createdAt), the order the rows were pasted in.
// `seq` records that order (rows copied from Mongo carry their old id, which sorts the same way).
const byPasteThenRow = (a: any, b: any) =>
  new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime() ||
  String(a.seq ?? '').localeCompare(String(b.seq ?? ''));

router.get('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Return all abandoned checkouts sorted by date (newest first)
    const checkouts = (await abandonedCheckoutStore.all()).sort(byPasteThenRow);
    res.json({ success: true, checkouts });
  } catch (error) {
    console.error('Error fetching abandoned checkouts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch abandoned checkouts' });
  }
});

router.get('/template', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const template = await whatsAppTemplateStore.getById('abandoned_checkout');
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

    await whatsAppTemplateStore.setById('abandoned_checkout', {
      name: 'abandoned_checkout',
      message,
      updatedAt: new Date(),
    });

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
      // One doc per (phone, date): its id is derived from both, so pasting the same leads
      // again inserts nothing new. Every row of a paste shares its createdAt.
      const pastedAt = new Date();
      for (const [index, record] of records.entries()) {
        const id = createHash('sha1').update(`${record.phone}\u0000${record.dateStr}`).digest('hex');
        const created = await abandonedCheckoutStore.createIfAbsent(id, {
          phone: record.phone,
          dateStr: record.dateStr,
          name: record.name,
          status: 'pending',
          createdAt: pastedAt,
          seq: `${pastedAt.getTime()}-${String(index).padStart(5, '0')}`,
        });
        if (created) inserted++;
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

    const updated = (await abandonedCheckoutStore.getById(String(id)))
      ? await abandonedCheckoutStore.updateById(String(id), { status })
      : null;

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
