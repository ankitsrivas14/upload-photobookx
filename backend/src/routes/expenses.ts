import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { ExpenseSource, MetaAdsExpense } from '../models';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * GET /api/admin/expenses/sources
 * Get all expense sources
 */
router.get('/sources', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const sources = await ExpenseSource.find({ category: 'meta-ads' }).sort({ name: 1 });

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

    const source = new ExpenseSource({
      name: name.trim(),
      category: 'meta-ads',
    });

    await source.save();

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

    const [expenses, total] = await Promise.all([
      MetaAdsExpense.find()
        .populate('sourceId', 'name')
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      MetaAdsExpense.countDocuments(),
    ]);

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
    const source = await ExpenseSource.findById(sourceId);
    if (!source) {
      res.status(400).json({ success: false, error: 'Invalid source' });
      return;
    }

    const expense = new MetaAdsExpense({
      amount: parseFloat(amount),
      date: new Date(date),
      sourceId,
      sourceName: source.name,
      notes: notes?.trim() || undefined,
      isTaxExempt: isTaxExempt === true,
      createdBy: req.user!.userId,
    });

    await expense.save();

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
    const expenseId = req.params.expenseId;

    const expense = await MetaAdsExpense.findByIdAndDelete(expenseId);

    if (!expense) {
      res.status(404).json({ success: false, error: 'Expense not found' });
      return;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting Meta Ads expense:', error);
    res.status(500).json({ success: false, error: 'Failed to delete expense' });
  }
});

export default router;
