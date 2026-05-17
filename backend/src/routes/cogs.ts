import { Router } from 'express';
import { COGSConfiguration } from '../models';
import { requireAdmin } from './adminAuth';
import { backfillDailyPnl } from '../services/dailyPnlService';

const router = Router();

function validateFields(fields: any[]): string | null {
  if (!Array.isArray(fields)) return 'Fields must be an array';
  for (const field of fields) {
    if (!field.id || !field.name) return 'Invalid field: missing id or name';
    const hasOld = typeof field.smallValue === 'number' && typeof field.largeValue === 'number';
    const hasNew =
      typeof field.smallPrepaidValue === 'number' &&
      typeof field.smallCODValue === 'number' &&
      typeof field.largePrepaidValue === 'number' &&
      typeof field.largeCODValue === 'number';
    if (!hasOld && !hasNew) return 'Invalid field: missing value structure';
  }
  return null;
}

// Get the currently active version (effectiveFrom <= now, most recent wins)
router.get('/configuration', requireAdmin, async (req, res) => {
  try {
    let config = await COGSConfiguration.findOne({ effectiveFrom: { $lte: new Date() } })
      .sort({ effectiveFrom: -1 })
      .lean();

    if (!config) {
      // Bootstrap an empty version
      const doc = new COGSConfiguration({ fields: [], effectiveFrom: new Date('2000-01-01') });
      await doc.save();
      config = doc.toObject();
    }

    res.json({ fields: (config as any).fields });
  } catch (error) {
    console.error('Error fetching COGS configuration:', error);
    res.status(500).json({ error: 'Failed to fetch COGS configuration' });
  }
});

// Get all versions sorted newest-first
router.get('/configuration/versions', requireAdmin, async (req, res) => {
  try {
    const versions = await COGSConfiguration.find()
      .sort({ effectiveFrom: -1 })
      .lean();
    res.json({ success: true, versions });
  } catch (error) {
    console.error('Error fetching COGS versions:', error);
    res.status(500).json({ error: 'Failed to fetch COGS versions' });
  }
});

// Create a new version — effectiveFrom is required
router.post('/configuration', requireAdmin, async (req, res) => {
  try {
    const { fields, effectiveFrom } = req.body;

    if (!effectiveFrom) {
      return res.status(400).json({ error: 'effectiveFrom date is required' });
    }

    const validationError = validateFields(fields);
    if (validationError) return res.status(400).json({ error: validationError });

    const config = new COGSConfiguration({
      fields,
      effectiveFrom: new Date(effectiveFrom),
    });
    await config.save();

    res.json({ success: true, message: 'COGS version created', version: config });

    // Recompute P&L for all dates on/after effectiveFrom
    backfillDailyPnl().catch(console.error);
  } catch (error) {
    console.error('Error creating COGS version:', error);
    res.status(500).json({ error: 'Failed to create COGS version' });
  }
});

// Update an existing version (fields and/or effectiveFrom)
router.put('/configuration/:id', requireAdmin, async (req, res) => {
  try {
    const { fields, effectiveFrom } = req.body;
    const update: Record<string, any> = { updatedAt: new Date() };

    if (fields !== undefined) {
      const validationError = validateFields(fields);
      if (validationError) return res.status(400).json({ error: validationError });
      update.fields = fields;
    }

    if (effectiveFrom !== undefined) {
      update.effectiveFrom = new Date(effectiveFrom);
    }

    const updated = await COGSConfiguration.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: 'Version not found' });

    res.json({ success: true, version: updated });

    backfillDailyPnl().catch(console.error);
  } catch (error) {
    console.error('Error updating COGS version:', error);
    res.status(500).json({ error: 'Failed to update COGS version' });
  }
});

// Delete a version (only allowed if there is more than one version)
router.delete('/configuration/:id', requireAdmin, async (req, res) => {
  try {
    const count = await COGSConfiguration.countDocuments();
    if (count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only version' });
    }
    await COGSConfiguration.findByIdAndDelete(req.params.id);
    res.json({ success: true });
    backfillDailyPnl().catch(console.error);
  } catch (error) {
    console.error('Error deleting COGS version:', error);
    res.status(500).json({ error: 'Failed to delete COGS version' });
  }
});

export default router;
