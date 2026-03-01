import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import TaggingJobLog from '../models/TaggingJobLog';

const router = Router();

/**
 * GET /api/admin/tagging-logs
 * Fetch recent tagging job logs
 */
router.get('/', requireAdmin, async (req, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const outcome = req.query.outcome as string;
        const startDate = req.query.startDate as string;
        const endDate = req.query.endDate as string;

        const query: any = {};

        if (outcome && outcome !== 'all') {
            query.outcome = outcome;
        }

        console.log("Tagging Logs Query params:", { outcome, startDate, endDate }, "Constructed query:", query);

        if (startDate || endDate) {
            query.startedAt = {};
            if (startDate) {
                query.startedAt.$gte = new Date(startDate);
            }
            if (endDate) {
                // To include the entire end date, add 1 day or set time to 23:59:59
                // Alternatively, let the frontend pass ISO strings directly. Assuming frontend passes exact ISO.
                query.startedAt.$lte = new Date(endDate);
            }
        }

        const logs = await TaggingJobLog.find(query)
            .sort({ startedAt: -1 })
            .skip(offset)
            .limit(limit);

        const total = await TaggingJobLog.countDocuments(query);

        res.json({
            success: true,
            logs,
            total
        });
    } catch (error) {
        console.error('Error fetching tagging job logs:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch tagging job logs' });
    }
});

export default router;
