import { Router } from 'express';
import { FixedMonthlyExpense } from '../models/FixedMonthlyExpense';
import { requireAdmin } from './adminAuth';

const router = Router();

// GET /api/admin/fixed-monthly-expenses?month=2026-05  (or all if no month)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const filter = req.query.month ? { month: req.query.month as string } : {};
    const entries = await FixedMonthlyExpense.find(filter).sort({ createdAt: 1 }).lean();
    res.json({ success: true, entries });
  } catch (error) {
    console.error('Error fetching fixed monthly expenses:', error);
    res.status(500).json({ error: 'Failed to fetch fixed monthly expenses' });
  }
});

// POST /api/admin/fixed-monthly-expenses
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { month, label, amount } = req.body;
    if (!month || !label || amount === undefined) {
      return res.status(400).json({ error: 'month, label and amount are required' });
    }
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month must be in YYYY-MM format' });
    }
    const entry = new FixedMonthlyExpense({ month, label, amount: Number(amount) });
    await entry.save();
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Error creating fixed monthly expense:', error);
    res.status(500).json({ error: 'Failed to create fixed monthly expense' });
  }
});

// PUT /api/admin/fixed-monthly-expenses/:id
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const { month, label, amount } = req.body;
    const update: Record<string, any> = { updatedAt: new Date() };
    if (month !== undefined) {
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: 'month must be in YYYY-MM format' });
      }
      update.month = month;
    }
    if (label !== undefined) update.label = label;
    if (amount !== undefined) update.amount = Number(amount);

    const updated = await FixedMonthlyExpense.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Entry not found' });
    res.json({ success: true, entry: updated });
  } catch (error) {
    console.error('Error updating fixed monthly expense:', error);
    res.status(500).json({ error: 'Failed to update fixed monthly expense' });
  }
});

// DELETE /api/admin/fixed-monthly-expenses/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await FixedMonthlyExpense.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting fixed monthly expense:', error);
    res.status(500).json({ error: 'Failed to delete fixed monthly expense' });
  }
});

export default router;
