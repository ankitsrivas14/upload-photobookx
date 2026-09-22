import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { MetaAdPerformance } from '../models';
import type { AuthenticatedRequest } from '../types';
import { recomputeForDate } from '../services/roasService';
import { expenseSourceStore, metaAdsExpenseStore, dailyAdSpendStore } from '../db/featureStores';

const router = Router();

/**
 * GET /api/admin/expenses/sources
 * Get all expense sources
 */
router.get('/sources', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const sources = (await expenseSourceStore.where('category', '==', 'meta-ads'))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    res.json({
      success: true,
      sources: sources.map(source => ({
        id: source._id,
        name: source.name,
        category: source.category,
        createdAt: source.createdAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching expense sources:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch expense sources' });
  }
});

/**
 * POST /api/admin/expenses/sources
 * Create a new expense source
 */
router.post('/sources', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      res.status(400).json({ success: false, error: 'Source name is required' });
      return;
    }

    const existing = await expenseSourceStore.where('name', '==', name.trim());
    if (existing.some((s) => s.category === 'meta-ads')) {
      res.status(400).json({ success: false, error: 'Source name already exists' });
      return;
    }
    const source = await expenseSourceStore.create({
      name: name.trim(),
      category: 'meta-ads',
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      source: {
        id: source._id,
        name: source.name,
        category: source.category,
        createdAt: source.createdAt,
      },
    });
  } catch (error: any) {
    console.error('Error creating expense source:', error);
    if (error.code === 11000) {
      res.status(400).json({ success: false, error: 'Source name already exists' });
    } else {
      res.status(500).json({ success: false, error: 'Failed to create expense source' });
    }
  }
});

/**
 * GET /api/admin/expenses/meta-ads
 * Get all Meta Ads expenses
 */
router.get('/meta-ads', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pageParam = req.query.page;
    const limitParam = req.query.limit;
    const page = parseInt(typeof pageParam === 'string' ? pageParam : '1', 10) || 1;
    const limit = parseInt(typeof limitParam === 'string' ? limitParam : '50', 10) || 50;

    const skip = (page - 1) * limit;

    const allExpenses = (await metaAdsExpenseStore.all()).sort((a, b) => {
      const d = new Date(b.date).getTime() - new Date(a.date).getTime();
      return d !== 0 ? d : new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });
    const total = allExpenses.length;
    const expenses = allExpenses.slice(skip, skip + limit);

    res.json({
      success: true,
      expenses: expenses.map(expense => ({
        id: expense._id,
        amount: expense.amount,
        date: expense.date,
        sourceId: expense.sourceId,
        sourceName: expense.sourceName,
        notes: expense.notes,
        isTaxExempt: expense.isTaxExempt,
        createdAt: expense.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching Meta Ads expenses:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch expenses' });
  }
});

/**
 * POST /api/admin/expenses/meta-ads
 * Create a new Meta Ads expense entry
 */
router.post('/meta-ads', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, date, sourceId, notes, isTaxExempt } = req.body;

    if (!amount || amount <= 0) {
      res.status(400).json({ success: false, error: 'Valid amount is required' });
      return;
    }

    if (!date) {
      res.status(400).json({ success: false, error: 'Date is required' });
      return;
    }

    if (!sourceId) {
      res.status(400).json({ success: false, error: 'Source is required' });
      return;
    }

    // Verify source exists
    const source = await expenseSourceStore.getById(sourceId);
    if (!source) {
      res.status(400).json({ success: false, error: 'Invalid source' });
      return;
    }

    const expense = await metaAdsExpenseStore.create({
      amount: parseFloat(amount),
      date: new Date(date),
      sourceId,
      sourceName: source.name,
      notes: notes?.trim() || undefined,
      isTaxExempt: isTaxExempt === true,
      createdBy: req.user!.userId,
      createdAt: new Date(),
    });

    res.status(201).json({
      success: true,
      expense: {
        id: expense._id,
        amount: expense.amount,
        date: expense.date,
        sourceId: expense.sourceId,
        sourceName: expense.sourceName,
        notes: expense.notes,
        isTaxExempt: expense.isTaxExempt,
        createdAt: expense.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating Meta Ads expense:', error);
    res.status(500).json({ success: false, error: 'Failed to create expense' });
  }
});

/**
 * DELETE /api/admin/expenses/meta-ads/:expenseId
 * Delete a Meta Ads expense entry
 */
router.delete('/meta-ads/:expenseId', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const expenseId = String(req.params.expenseId);

    const expense = await metaAdsExpenseStore.getById(expenseId);
    if (!expense) {
      res.status(404).json({ success: false, error: 'Expense not found' });
      return;
    }
    await metaAdsExpenseStore.deleteById(expenseId);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting Meta Ads expense:', error);
    res.status(500).json({ success: false, error: 'Failed to delete expense' });
  }
});

/**
 * GET /api/admin/expenses/daily-ad-spend
 * Get all daily ad spend entries
 */
router.get('/daily-ad-spend', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const entries = (await dailyAdSpendStore.all()).sort((a, b) => {
      const d = new Date(b.date).getTime() - new Date(a.date).getTime();
      return d !== 0 ? d : new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    // Older CSV uploads were saved in MetaAdPerformance before the dedicated
    // dailyAmountSpent field existed. Reconstruct their CSV total by date so
    // the new column is immediately useful without overwriting manual amounts.
    const dateKeys = entries.map(entry => new Date(entry.date).toISOString().slice(0, 10));
    const csvSpendByDate = new Map<string, number>();
    if (dateKeys.length > 0) {
      const levelTotals = await MetaAdPerformance.aggregate([
        { $match: { date: { $in: dateKeys } } },
        { $group: { _id: { date: '$date', level: '$level' }, total: { $sum: '$spend' } } },
      ]);

      for (const row of levelTotals) {
        const dateKey = String(row._id.date);
        const total = Number(row.total) || 0;
        // Campaign/ad-set/ad exports can all describe the same daily spend.
        // Use the largest level total rather than adding report levels together.
        csvSpendByDate.set(dateKey, Math.max(csvSpendByDate.get(dateKey) || 0, total));
      }
    }

    res.json({
      success: true,
      entries: entries.map(entry => ({
        id: entry._id,
        date: entry.date,
        amount: entry.amount,
        dailyAmountSpent: entry.dailyAmountSpent ?? (
          csvSpendByDate.get(new Date(entry.date).toISOString().slice(0, 10)) ?? null
        ),
        notes: entry.notes,
        createdAt: entry.createdAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching daily ad spend:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch daily ad spend' });
  }
});

/**
 * PUT /api/admin/expenses/daily-ad-spend
 * Create or replace the daily spend entry for a date.
 * Used by the ads CSV importer so re-uploading a report is idempotent.
 */
router.put('/daily-ad-spend', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date, amount, notes } = req.body;
    const parsedAmount = Number(amount);

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      res.status(400).json({ success: false, error: 'A valid date is required (YYYY-MM-DD)' });
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      res.status(400).json({ success: false, error: 'Valid amount is required' });
      return;
    }

    // Parse date-only values as UTC midnight so the stored calendar date does not
    // shift when it is later formatted in the app's timezone.
    const [year, month, day] = String(date).split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) {
      res.status(400).json({ success: false, error: 'Invalid date' });
      return;
    }

    // Upsert by date: find an existing entry for this date, else create one.
    const sameDate = (await dailyAdSpendStore.where('date', '==', parsedDate));
    const patch: any = { dailyAmountSpent: parsedAmount };
    if (notes !== undefined) patch.notes = String(notes).trim();
    let entry: any;
    if (sameDate.length > 0) {
      entry = await dailyAdSpendStore.updateById(sameDate[0]._id, patch);
    } else {
      entry = await dailyAdSpendStore.create({ date: parsedDate, amount: 0, createdAt: new Date(), ...patch });
    }

    const dateKey = parsedDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    recomputeForDate(dateKey).catch((err) => console.error('ROAS recompute error:', err));

    res.json({
      success: true,
      entry: {
        id: entry._id,
        date: entry.date,
        amount: entry.amount,
        dailyAmountSpent: entry.dailyAmountSpent,
        notes: entry.notes,
        createdAt: entry.createdAt,
      },
    });
  } catch (error) {
    console.error('Error upserting daily ad spend:', error);
    res.status(500).json({ success: false, error: 'Failed to save daily ad spend entry' });
  }
});

/**
 * POST /api/admin/expenses/daily-ad-spend
 * Create a new daily ad spend entry
 */
router.post('/daily-ad-spend', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { date, amount, notes } = req.body;

    if (!date) {
      res.status(400).json({ success: false, error: 'Date is required' });
      return;
    }

    if (!amount || amount <= 0) {
      res.status(400).json({ success: false, error: 'Valid amount is required' });
      return;
    }

    const entry = await dailyAdSpendStore.create({
      date: new Date(date),
      amount: parseFloat(amount),
      notes: notes?.trim() || '',
      createdAt: new Date(),
    });

    // Recompute ROAS for this date asynchronously (don't block the response)
    const dateKey = new Date(entry.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    recomputeForDate(dateKey).catch((err) => console.error('ROAS recompute error:', err));

    res.status(201).json({
      success: true,
      entry: {
        id: entry._id,
        date: entry.date,
        amount: entry.amount,
        notes: entry.notes,
        createdAt: entry.createdAt,
      },
    });
  } catch (error) {
    console.error('Error creating daily ad spend:', error);
    res.status(500).json({ success: false, error: 'Failed to create daily ad spend entry' });
  }
});

/**
 * DELETE /api/admin/expenses/daily-ad-spend/:entryId
 * Delete a daily ad spend entry
 */
router.delete('/daily-ad-spend/:entryId', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entryId = String(req.params.entryId);

    const entry = await dailyAdSpendStore.getById(entryId);
    if (!entry) {
      res.status(404).json({ success: false, error: 'Entry not found' });
      return;
    }
    await dailyAdSpendStore.deleteById(entryId);

    // Recompute ROAS for the affected date asynchronously
    const dateKey = new Date((entry as any).date).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    recomputeForDate(dateKey).catch((err) => console.error('ROAS recompute error:', err));

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting daily ad spend:', error);
    res.status(500).json({ success: false, error: 'Failed to delete entry' });
  }
});

export default router;
