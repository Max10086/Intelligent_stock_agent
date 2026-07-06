import express from 'express';
import type { RecordReturnTrackingRequest } from '../../types/returnTracking.js';
import { returnTrackingService } from '../services/returnTracking.js';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../db.js';

const router = express.Router();
router.use(requireAuth);

const isSourceType = (value: unknown): value is RecordReturnTrackingRequest['sourceType'] =>
  value === 'compare_run' || value === 'analysis_report';

async function assertSourceOwned(
  userId: string,
  sourceType: RecordReturnTrackingRequest['sourceType'],
  sourceId: string
) {
  if (sourceType === 'analysis_report') {
    const job = await prisma.analysisJob.findFirst({
      where: { id: sourceId, userId },
      select: { id: true },
    });
    if (!job) throw new Error('Report not found');
    return;
  }

  const run = await prisma.comparisonRun.findUnique({
    where: { id: sourceId },
    select: { sessionId: true },
  });
  if (!run) throw new Error('Comparison run not found');
  const session = await prisma.comparisonSession.findFirst({
    where: { id: run.sessionId, userId },
    select: { id: true },
  });
  if (!session) throw new Error('Comparison run not found');
}

router.post('/record', async (req, res) => {
  try {
    const userId = req.user!.id;
    const body = req.body as Partial<RecordReturnTrackingRequest>;
    if (!isSourceType(body.sourceType)) {
      return res.status(400).json({ error: 'sourceType must be compare_run or analysis_report' });
    }
    if (typeof body.sourceId !== 'string' || !body.sourceId.trim()) {
      return res.status(400).json({ error: 'sourceId is required' });
    }
    if (typeof body.observedDate !== 'string' || !body.observedDate.trim()) {
      return res.status(400).json({ error: 'observedDate is required' });
    }

    await assertSourceOwned(userId, body.sourceType, body.sourceId.trim());

    const companies = Array.isArray(body.companies)
      ? body.companies
          .map(item => ({
            companyKey: String(item?.companyKey || '').trim(),
            ticker: String(item?.ticker || '').trim(),
            exchange: String(item?.exchange || '').trim(),
            name: typeof item?.name === 'string' ? item.name : undefined,
            anchorPrice: String(item?.anchorPrice || '').trim(),
            anchorDate: String(item?.anchorDate || '').trim(),
          }))
          .filter(
            item =>
              item.companyKey &&
              item.ticker &&
              item.exchange &&
              item.anchorPrice &&
              item.anchorDate
          )
      : [];

    const result = await returnTrackingService.recordOpen(userId, {
      sourceType: body.sourceType,
      sourceId: body.sourceId.trim(),
      observedDate: body.observedDate.trim(),
      companies,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[returnTracking] record failed:', error);
    const status = /not found/i.test(error?.message) ? 404 : 500;
    res.status(status).json({
      error: error?.message || 'Failed to record return tracking',
    });
  }
});

export { router as returnTrackingRouter };
