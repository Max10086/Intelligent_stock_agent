import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  assertCanAnalyzeCompanies,
  getUsageSummary,
  recordCompanyAnalysisUsage,
  UsageLimitError,
} from '../services/usageLimit.js';
import { trackUserEvent } from '../services/analytics.js';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const usage = await getUsageSummary(req.user!.id);
    res.json(usage);
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to load usage' });
  }
});

router.post('/check', requireAuth, async (req, res) => {
  try {
    const requestedCompanies = Math.max(
      0,
      Math.min(10, Number(req.body?.requestedCompanies) || 1)
    );
    const usage = await assertCanAnalyzeCompanies(req.user!.id, requestedCompanies);
    res.json({ allowed: true, usage });
  } catch (error) {
    if (error instanceof UsageLimitError) {
      void trackUserEvent({
        userId: req.user!.id,
        eventType: 'usage_limit_hit',
        path: '/api/usage/check',
        metadata: {
          requestedCompanies: Math.max(0, Math.min(10, Number(req.body?.requestedCompanies) || 1)),
          tier: error.summary.tier,
        },
      });
      return res.status(429).json({
        allowed: false,
        error: error.message,
        usage: error.summary,
      });
    }
    res.status(500).json({ error: 'Failed to check usage' });
  }
});

router.post('/record', requireAuth, async (req, res) => {
  try {
    const reportId = String(req.body?.reportId || '').trim();
    const companyId = String(req.body?.companyId || '').trim();
    const ticker = String(req.body?.ticker || '').trim();
    if (!reportId || !companyId || !ticker) {
      return res.status(400).json({ error: 'reportId, companyId, and ticker are required' });
    }

    const result = await recordCompanyAnalysisUsage({
      userId: req.user!.id,
      reportId,
      companyId,
      ticker,
    });
    const usage = await getUsageSummary(req.user!.id);
    res.json({ ...result, usage });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to record usage' });
  }
});

export { router as usageRouter };
