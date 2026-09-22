import { Router } from 'express';
import { requireAdmin } from './adminAuth';
import { backfillDailyPnl } from '../services/dailyPnlService';
import { cogsStore } from '../db/featureStores';

const router = Router();

const asTime = (d: any) => new Date(d).getTime();
/** All versions newest-first (by effectiveFrom). */
async function allVersionsDesc(): Promise<any[]> {
  const versions = await cogsStore.all();
  return versions.sort((a, b) => asTime(b.effectiveFrom) - asTime(a.effectiveFrom));
}

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
    const now = Date.now();
    let config = (await allVersionsDesc()).find((v) => asTime(v.effectiveFrom) <= now) ?? null;

    if (!config) {
      // Bootstrap an empty version
      config = await cogsStore.create({ fields: [], effectiveFrom: new Date('2000-01-01') });
    }

    res.json({ fields: (config as any).fields, totalOverrides: (config as any).totalOverrides ?? {} });
  } catch (error) {
    console.error('Error fetching COGS configuration:', error);
    res.status(500).json({ error: 'Failed to fetch COGS configuration' });
  }
});

// Get all versions sorted newest-first
router.get('/configuration/versions', requireAdmin, async (req, res) => {
  try {
    const versions = await allVersionsDesc();
    res.json({ success: true, versions });
  } catch (error) {
    console.error('Error fetching COGS versions:', error);
    res.status(500).json({ error: 'Failed to fetch COGS versions' });
  }
});

// Create a new version — effectiveFrom is required
router.post('/configuration', requireAdmin, async (req, res) => {
  try {
    const { fields, effectiveFrom, totalOverrides } = req.body;

    if (!effectiveFrom) {
      return res.status(400).json({ error: 'effectiveFrom date is required' });
    }

    const validationError = validateFields(fields);
    if (validationError) return res.status(400).json({ error: validationError });

    const config = await cogsStore.create({
      fields,
      effectiveFrom: new Date(effectiveFrom),
      totalOverrides: totalOverrides ?? {},
      updatedAt: new Date(),
    });

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
    const { fields, effectiveFrom, totalOverrides } = req.body;
    const update: Record<string, any> = { updatedAt: new Date() };

    if (fields !== undefined) {
      const validationError = validateFields(fields);
      if (validationError) return res.status(400).json({ error: validationError });
      update.fields = fields;
    }

    if (effectiveFrom !== undefined) {
      update.effectiveFrom = new Date(effectiveFrom);
    }

    if (totalOverrides !== undefined) {
      update.totalOverrides = totalOverrides;
    }

    const existing = await cogsStore.getById(String(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Version not found' });
    const updated = await cogsStore.updateById(String(req.params.id), update);

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
    const count = await cogsStore.count();
    if (count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the only version' });
    }
    await cogsStore.deleteById(String(req.params.id));
    res.json({ success: true });
    backfillDailyPnl().catch(console.error);
  } catch (error) {
    console.error('Error deleting COGS version:', error);
    res.status(500).json({ error: 'Failed to delete COGS version' });
  }
});

export default router;
