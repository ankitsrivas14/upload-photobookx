import { Router } from 'express';
import { COGSConfiguration } from '../models';
import { requireAdmin } from './adminAuth';

const router = Router();

// Get COGS Configuration
router.get('/configuration', requireAdmin, async (req, res) => {
  try {
    // Get the single configuration document (there should only be one)
    let config = await COGSConfiguration.findOne();

    // If no configuration exists, create an empty one
    if (!config) {
      config = new COGSConfiguration({ fields: [] });
      await config.save();
    }

    res.json({
      fields: config.fields,
    });
  } catch (error) {
    console.error('Error fetching COGS configuration:', error);
    res.status(500).json({ error: 'Failed to fetch COGS configuration' });
  }
});

// Save COGS Configuration
router.post('/configuration', requireAdmin, async (req, res) => {
  try {
    const { fields } = req.body;

    if (!Array.isArray(fields)) {
      return res.status(400).json({ error: 'Fields must be an array' });
    }

    // Validate fields structure
    for (const field of fields) {
      if (!field.id || !field.name || typeof field.smallValue !== 'number' || typeof field.largeValue !== 'number') {
        return res.status(400).json({ error: 'Invalid field structure' });
      }
    }

    // Delete existing configuration and create new one
    await COGSConfiguration.deleteMany({});
    const config = new COGSConfiguration({ fields });
    await config.save();

    res.json({
      success: true,
      message: 'COGS configuration saved successfully',
    });
  } catch (error) {
    console.error('Error saving COGS configuration:', error);
    res.status(500).json({ error: 'Failed to save COGS configuration' });
  }
});

export default router;
