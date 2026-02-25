import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { BankCategory, BankTransaction, BankNarrationRule } from '../models';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * GET /api/admin/bank-account/narration-rules
 * Get all narration nickname rules
 */
router.get('/narration-rules', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const rules = await BankNarrationRule.find().sort({ createdAt: -1 });
        res.json({
            success: true,
            rules: rules.map(r => ({
                id: r._id,
                keyword: r.keyword,
                nickname: r.nickname,
            })),
        });
    } catch (error) {
        console.error('Error fetching narration rules:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch rules' });
    }
});

/**
 * POST /api/admin/bank-account/narration-rules
 * Create a new narration nickname rule
 */
router.post('/narration-rules', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { keyword, nickname } = req.body;

        if (!keyword || !nickname) {
            res.status(400).json({ success: false, error: 'Keyword and nickname are required' });
            return;
        }

        const rule = new BankNarrationRule({
            keyword: keyword.trim(),
            nickname: nickname.trim(),
            createdBy: req.user!.userId,
        });

        await rule.save();

        res.status(201).json({
            success: true,
            rule: {
                id: rule._id,
                keyword: rule.keyword,
                nickname: rule.nickname,
            }
        });
    } catch (error: any) {
        console.error('Error creating narration rule:', error);
        if (error.code === 11000) {
            res.status(400).json({ success: false, error: 'Rule for this keyword already exists' });
        } else {
            res.status(500).json({ success: false, error: 'Failed to create rule' });
        }
    }
});

/**
 * DELETE /api/admin/bank-account/narration-rules/:id
 * Delete a narration nickname rule
 */
router.delete('/narration-rules/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        await BankNarrationRule.findByIdAndDelete(id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting narration rule:', error);
        res.status(500).json({ success: false, error: 'Failed to delete rule' });
    }
});

/**
 * GET /api/admin/bank-account/categories
 * Get all bank categories
 */
router.get('/categories', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const categories = await BankCategory.find().sort({ name: 1 });
        res.json({
            success: true,
            categories: categories.map(cat => ({
                name: cat.name,
                tags: cat.tags || [],
            })),
        });
    } catch (error) {
        console.error('Error fetching bank categories:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch categories' });
    }
});

/**
 * POST /api/admin/bank-account/categories
 * Create a new bank category
 */
router.post('/categories', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            res.status(400).json({ success: false, error: 'Category name is required' });
            return;
        }

        const category = new BankCategory({
            name: name.trim(),
            createdBy: req.user!.userId,
        });

        await category.save();

        res.status(201).json({
            success: true,
            category: category.name,
        });
    } catch (error: any) {
        console.error('Error creating bank category:', error);
        if (error.code === 11000) {
            res.status(400).json({ success: false, error: 'Category already exists' });
        } else {
            res.status(500).json({ success: false, error: 'Failed to create category' });
        }
    }
});

/**
 * GET /api/admin/bank-account/transactions
 * Get processed bank transactions
 */
router.get('/transactions', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const transactions = await BankTransaction.find().sort({ date: -1, createdAt: -1 });
        res.json({
            success: true,
            transactions: transactions.map(tx => ({
                id: tx._id,
                date: tx.date,
                narration: tx.narration,
                reference: tx.reference,
                withdrawal: tx.withdrawal,
                deposit: tx.deposit,
                balance: tx.balance,
                category: tx.category,
                tags: tx.tags || [],
            })),
        });
    } catch (error) {
        console.error('Error fetching bank transactions:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
    }
});

/**
 * POST /api/admin/bank-account/transactions/bulk
 * Categorize and save multiple transactions
 */
router.post('/transactions/bulk', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { transactions } = req.body;

        if (!Array.isArray(transactions) || transactions.length === 0) {
            res.status(400).json({ success: false, error: 'Transactions array is required' });
            return;
        }

        const txDocs = transactions.map((tx: any) => ({
            date: tx.date,
            narration: tx.narration,
            reference: tx.reference,
            withdrawal: tx.withdrawal,
            deposit: tx.deposit,
            balance: tx.balance,
            category: tx.category,
            createdBy: req.user!.userId,
        }));

        const savedTxs = await BankTransaction.insertMany(txDocs);

        res.status(201).json({
            success: true,
            transactions: savedTxs.map(tx => ({
                id: tx._id,
                date: tx.date,
                narration: tx.narration,
                reference: tx.reference,
                withdrawal: tx.withdrawal,
                deposit: tx.deposit,
                balance: tx.balance,
                category: tx.category,
                tags: tx.tags || [],
            })),
        });
    } catch (error) {
        console.error('Error saving bank transactions:', error);
        res.status(500).json({ success: false, error: 'Failed to save transactions' });
    }
});

/**
 * DELETE /api/admin/bank-account/transactions/:id
 * Delete a processed transaction
 */
router.delete('/transactions/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const tx = await BankTransaction.findByIdAndDelete(id);

        if (!tx) {
            res.status(404).json({ success: false, error: 'Transaction not found' });
            return;
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting bank transaction:', error);
        res.status(500).json({ success: false, error: 'Failed to delete transaction' });
    }
});

/**
 * PATCH /api/admin/bank-account/categories/:oldName
 * Rename a bank category
 */
router.patch('/categories/:oldName', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { oldName } = req.params;
        const { newName } = req.body;

        if (!newName || !newName.trim()) {
            res.status(400).json({ success: false, error: 'New category name is required' });
            return;
        }

        const trimmedNewName = newName.trim();

        // 1. Update the category itself
        const category = await BankCategory.findOne({ name: oldName });
        if (!category) {
            res.status(404).json({ success: false, error: 'Category not found' });
            return;
        }

        category.name = trimmedNewName;
        await category.save();

        // 2. Update all transactions using this category
        await BankTransaction.updateMany(
            { category: oldName },
            { $set: { category: trimmedNewName } }
        );

        res.json({
            success: true,
            category: trimmedNewName,
        });
    } catch (error: any) {
        console.error('Error updating bank category:', error);
        if (error.code === 11000) {
            res.status(400).json({ success: false, error: 'Category name already exists' });
        } else {
            res.status(500).json({ success: false, error: 'Failed to update category' });
        }
    }
});

/**
 * DELETE /api/admin/bank-account/categories/:name
 * Delete a bank category
 */
router.delete('/categories/:name', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name } = req.params;

        // 1. Find the category
        const category = await BankCategory.findOne({ name });
        if (!category) {
            res.status(404).json({ success: false, error: 'Category not found' });
            return;
        }

        // 2. Check for transactions using this category
        const transactionCount = await BankTransaction.countDocuments({ category: name });

        if (transactionCount > 0) {
            const deletedCategoryName = `deleted_${name}`;

            // Ensure the "deleted_" version exists as a category record
            let deletedCat = await BankCategory.findOne({ name: deletedCategoryName });
            if (!deletedCat) {
                deletedCat = new BankCategory({
                    name: deletedCategoryName,
                    createdBy: req.user!.userId,
                });
                await deletedCat.save();
            }

            // Move transactions to the "deleted_" category
            await BankTransaction.updateMany(
                { category: name },
                { $set: { category: deletedCategoryName } }
            );
        }

        // 3. Delete the original category
        await BankCategory.deleteOne({ name });

        res.json({
            success: true,
            message: transactionCount > 0 ? `Moved ${transactionCount} transactions to 'deleted_${name}'` : 'Category deleted'
        });
    } catch (error) {
        console.error('Error deleting bank category:', error);
        res.status(500).json({ success: false, error: 'Failed to delete category' });
    }
});

/**
 * PATCH /api/admin/bank-account/categories/:name/tags
 * Update tags for a category
 */
router.patch('/categories/:name/tags', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name } = req.params;
        const { tags } = req.body;

        if (!Array.isArray(tags)) {
            res.status(400).json({ success: false, error: 'Tags must be an array' });
            return;
        }

        const category = await BankCategory.findOneAndUpdate(
            { name },
            { $set: { tags: tags.map(t => t.trim()) } },
            { new: true }
        );

        if (!category) {
            res.status(404).json({ success: false, error: 'Category not found' });
            return;
        }

        res.json({ success: true, tags: category.tags });
    } catch (error) {
        console.error('Error updating category tags:', error);
        res.status(500).json({ success: false, error: 'Failed to update tags' });
    }
});

/**
 * PATCH /api/admin/bank-account/transactions/bulk/tags
 * Bulk update tags for transactions
 */
router.patch('/transactions/bulk/tags', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { ids, tags } = req.body;

        if (!Array.isArray(ids) || !Array.isArray(tags)) {
            res.status(400).json({ success: false, error: 'IDs and Tags must be arrays' });
            return;
        }

        await BankTransaction.updateMany(
            { _id: { $in: ids } },
            { $set: { tags: tags.map(t => t.trim()) } }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Error bulk updating transaction tags:', error);
        res.status(500).json({ success: false, error: 'Failed to update tags' });
    }
});

/**
 * PATCH /api/admin/bank-account/transactions/:id
 * Update transaction category and clear tags
 */
router.patch('/transactions/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { category } = req.body;

        if (!category) {
            res.status(400).json({ success: false, error: 'Category is required' });
            return;
        }

        const tx = await BankTransaction.findByIdAndUpdate(
            id,
            {
                $set: {
                    category,
                    tags: [] // Clear tags when category changes
                }
            },
            { new: true }
        );

        if (!tx) {
            res.status(404).json({ success: false, error: 'Transaction not found' });
            return;
        }

        res.json({
            success: true,
            transaction: {
                id: tx._id,
                date: tx.date,
                narration: tx.narration,
                reference: tx.reference,
                withdrawal: tx.withdrawal,
                deposit: tx.deposit,
                balance: tx.balance,
                category: tx.category,
                tags: tx.tags,
            }
        });
    } catch (error) {
        console.error('Error updating bank transaction:', error);
        res.status(500).json({ success: false, error: 'Failed to update transaction' });
    }
});

export default router;
