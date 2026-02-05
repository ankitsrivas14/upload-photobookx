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

    // Validate fields structure (support both old and new structure)
    for (const field of fields) {
      if (!field.id || !field.name) {
        return res.status(400).json({ error: 'Invalid field structure: missing id or name' });
      }
      
      // Check if either old structure or new structure is present
      const hasOldStructure = typeof field.smallValue === 'number' && typeof field.largeValue === 'number';
      const hasNewStructure = 
        typeof field.smallPrepaidValue === 'number' && 
        typeof field.smallCODValue === 'number' && 
        typeof field.largePrepaidValue === 'number' && 
        typeof field.largeCODValue === 'number';
      
      if (!hasOldStructure && !hasNewStructure) {
        return res.status(400).json({ 
          error: 'Invalid field structure: must have either old structure (smallValue/largeValue) or new structure (smallPrepaidValue/smallCODValue/largePrepaidValue/largeCODValue)' 
        });
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
