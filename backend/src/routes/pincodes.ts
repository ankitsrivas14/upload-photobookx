import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import BlockedPinCode from '../models/BlockedPinCode';
import CodAddedCity from '../models/CodAddedCity';
import type { AuthenticatedRequest } from '../types';

const router = Router();

// GET /api/admin/pincodes/blocked
router.get('/blocked', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const pinCodes = await BlockedPinCode.find().sort({ createdAt: -1 });
        res.json({ success: true, pinCodes });
    } catch (error) {
        console.error('Error fetching blocked pin codes:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch blocked pin codes' });
    }
});

// POST /api/admin/pincodes/blocked
router.post('/blocked', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { pinCodes, notes } = req.body;

        if (!pinCodes || !Array.isArray(pinCodes) || pinCodes.length === 0) {
            return res.status(400).json({ success: false, error: 'At least one pin code is required' });
        }

        // Ensure uniform string handling and deduplication
        const uniquePinCodes = Array.from(
            new Set(pinCodes.map(p => typeof p === 'string' ? p.trim() : '').filter(p => !!p))
        );

        const newPinCodes = [];
        for (const pinCode of uniquePinCodes) {
            const newPinCode = await BlockedPinCode.findOneAndUpdate(
                { pinCode },
                { notes, createdAt: new Date() },
                { upsert: true, new: true }
            );
            newPinCodes.push(newPinCode);
        }

        res.status(201).json({ success: true, pinCodes: newPinCodes });
    } catch (error) {
        console.error('Error adding blocked pin code:', error);
        res.status(500).json({ success: false, error: 'Failed to add pin code' });
    }
});

// DELETE /api/admin/pincodes/blocked/:pinCode
router.delete('/blocked/:pinCode', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { pinCode } = req.params;
        await BlockedPinCode.findOneAndDelete({ pinCode });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting blocked pin code:', error);
        res.status(500).json({ success: false, error: 'Failed to delete pin code' });
    }
});

// GET /api/admin/pincodes/cod-added-cities
router.get('/cod-added-cities', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const cities = await CodAddedCity.find({}, { city: 1 }).lean();
        res.json({ success: true, cities: cities.map(c => c.city) });
    } catch {
        res.status(500).json({ success: false, error: 'Failed to fetch added cities' });
    }
});

// POST /api/admin/pincodes/cod-added-cities
router.post('/cod-added-cities', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    const { city } = req.body;
    if (!city) return res.status(400).json({ success: false, error: 'city is required' });
    try {
        await CodAddedCity.findOneAndUpdate({ city }, { addedAt: new Date() }, { upsert: true });
        res.json({ success: true });
    } catch {
        res.status(500).json({ success: false, error: 'Failed to mark city' });
    }
});

// DELETE /api/admin/pincodes/cod-added-cities/:city
router.delete('/cod-added-cities/:city', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        await CodAddedCity.findOneAndDelete({ city: decodeURIComponent(String(req.params.city)) });
        res.json({ success: true });
    } catch {
        res.status(500).json({ success: false, error: 'Failed to unmark city' });
    }
});

export default router;
