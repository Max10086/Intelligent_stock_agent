import express from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getAdminMetrics, listAdminFeedback, listAdminUsers } from '../services/adminMetrics.js';

const router = express.Router();

router.get('/metrics', requireAdmin, async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const metrics = await getAdminMetrics({ from, to });
    res.json(metrics);
  } catch (error: unknown) {
    console.error('[admin] metrics failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load admin metrics',
    });
  }
});

router.get('/users', requireAdmin, async (req, res) => {
  try {
    const skip = Number(req.query.skip) || 0;
    const limit = Number(req.query.limit) || 50;
    const result = await listAdminUsers({ skip, limit });
    res.json(result);
  } catch (error: unknown) {
    console.error('[admin] users list failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load users',
    });
  }
});

router.get('/feedback', requireAdmin, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const feedback = await listAdminFeedback({ limit });
    res.json({
      items: feedback.map(item => ({
        id: item.id,
        userId: item.userId,
        userEmail: item.user.email,
        userIsPaid: item.user.isPaid,
        category: item.category,
        message: item.message,
        rating: item.rating,
        context: item.context ? JSON.parse(item.context) : null,
        createdAt: item.createdAt.toISOString(),
      })),
    });
  } catch (error: unknown) {
    console.error('[admin] feedback list failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load feedback',
    });
  }
});

export { router as adminRouter };
