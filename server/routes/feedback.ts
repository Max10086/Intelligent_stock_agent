import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma, withPrismaRetry } from '../db.js';

const router = express.Router();

const FEEDBACK_CATEGORIES = new Set(['bug', 'feature', 'quality', 'pricing', 'other']);

router.post('/', requireAuth, async (req, res) => {
  try {
    const category = String(req.body?.category || 'other').trim().toLowerCase();
    const message = String(req.body?.message || '').trim();
    const ratingRaw = req.body?.rating;
    const context =
      req.body?.context && typeof req.body.context === 'object' ? req.body.context : undefined;

    if (!FEEDBACK_CATEGORIES.has(category)) {
      return res.status(400).json({ error: 'Invalid feedback category' });
    }
    if (!message || message.length < 3) {
      return res.status(400).json({ error: 'Message must be at least 3 characters' });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: 'Message is too long' });
    }

    let rating: number | null = null;
    if (ratingRaw !== undefined && ratingRaw !== null && ratingRaw !== '') {
      const parsed = Number(ratingRaw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
        return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
      }
      rating = parsed;
    }

    const feedback = await withPrismaRetry(
      () =>
        prisma.userFeedback.create({
          data: {
            userId: req.user!.id,
            category,
            message,
            rating,
            context: context ? JSON.stringify(context) : null,
          },
        }),
      'feedback.create',
      2
    );

    res.json({
      ok: true,
      id: feedback.id,
      createdAt: feedback.createdAt.toISOString(),
    });
  } catch (error: unknown) {
    console.error('[feedback] create failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to submit feedback',
    });
  }
});

export { router as feedbackRouter };
