import express from 'express';
import type { AnalyticsEventType } from '../../types/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { trackUserEvent } from '../services/analytics.js';

const router = express.Router();

const ALLOWED_EVENTS = new Set<string>([
  'page_view',
  'analysis_start',
  'analysis_complete',
  'candidate_analysis_start',
  'follow_up_start',
  'compare_start',
  'compare_complete',
  'history_open',
  'report_open',
  'usage_limit_hit',
  'search_submit',
  'paywall_shown',
  'paywall_dismissed',
  'report_feedback',
]);

router.post('/event', requireAuth, async (req, res) => {
  try {
    const eventType = String(req.body?.eventType || '').trim();
    if (!eventType || !ALLOWED_EVENTS.has(eventType)) {
      return res.status(400).json({ error: 'Invalid eventType' });
    }

    const path = typeof req.body?.path === 'string' ? req.body.path : undefined;
    const metadata =
      req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : undefined;

    await trackUserEvent({
      userId: req.user!.id,
      eventType: eventType as AnalyticsEventType,
      path,
      metadata,
    });

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to track event' });
  }
});

export { router as analyticsRouter };
