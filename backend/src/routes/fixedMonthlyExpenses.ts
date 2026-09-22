import { Router } from 'express';
import { requireAdmin } from './adminAuth';
import { fixedMonthlyExpenseStore } from '../db/featureStores';

const router = Router();

// GET /api/admin/fixed-monthly-expenses?month=2026-05  (or all if no month)
router.get('/', requireAdmin, async (req, res) => {
  try {
    const all = req.query.month
      ? await fixedMonthlyExpenseStore.where('month', '==', req.query.month as string)
      : await fixedMonthlyExpenseStore.all();
    const entries = all.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
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
    const entry = await fixedMonthlyExpenseStore.create({ month, label, amount: Number(amount), createdAt: new Date() });
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

    const existing = await fixedMonthlyExpenseStore.getById(String(req.params.id));
    if (!existing) return res.status(404).json({ error: 'Entry not found' });
    const updated = await fixedMonthlyExpenseStore.updateById(String(req.params.id), update);
    res.json({ success: true, entry: updated });
  } catch (error) {
    console.error('Error updating fixed monthly expense:', error);
    res.status(500).json({ error: 'Failed to update fixed monthly expense' });
  }
});

// DELETE /api/admin/fixed-monthly-expenses/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await fixedMonthlyExpenseStore.deleteById(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting fixed monthly expense:', error);
    res.status(500).json({ error: 'Failed to delete fixed monthly expense' });
  }
});

export default router;
