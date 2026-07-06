import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { ModelClient } from '../services/modelClient.js';
import { CompareService } from '../services/compare.js';
import type { CreateCompareRequest, FollowUpCompareRequest } from '../../types/compare.js';
import type { Language } from '../../types.js';
import { requireAuth } from '../middleware/auth.js';
import { trackUserEvent } from '../services/analytics.js';
import { prisma } from '../db.js';

const router = express.Router();
router.use(requireAuth);

let aiClient: GoogleGenAI | null = null;
let modelClient: ModelClient | null = null;
let compareService: CompareService | null = null;

function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'smartstockagent';
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
    aiClient = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location,
    });
  }
  return aiClient;
}

function getCompareService(): CompareService {
  if (!compareService) {
    if (!modelClient) modelClient = new ModelClient(getAIClient());
    compareService = new CompareService(modelClient);
  }
  return compareService;
}

const isLanguage = (value: unknown): value is Language => value === 'cn' || value === 'en';

async function assertReportsOwned(userId: string, reportIds: string[]) {
  const uniqueIds = [...new Set(reportIds.filter(Boolean))];
  for (const reportId of uniqueIds) {
    const job = await prisma.analysisJob.findFirst({
      where: { id: reportId, userId },
      select: { id: true },
    });
    if (!job) {
      throw new Error(`Report not found: ${reportId}`);
    }
  }
}

router.post('/', async (req, res) => {
  try {
    const userId = req.user!.id;
    const body = req.body as Partial<CreateCompareRequest & FollowUpCompareRequest>;
    const service = getCompareService();

    if (body.sessionId && body.parentRunId) {
      const followUpRequest: FollowUpCompareRequest = {
        sessionId: body.sessionId,
        parentRunId: body.parentRunId,
        refreshReports: Boolean(body.refreshReports),
      };
      const started = await service.startFollowUpComparison(userId, followUpRequest);
      void service.executeFollowUpRun(userId, started.runId, followUpRequest).then(async () => {
        const status = await service.getRunStatus(userId, started.runId);
        if (status.status === 'COMPLETED') {
          await trackUserEvent({
            userId,
            eventType: 'compare_complete',
            metadata: { sessionId: started.sessionId, runId: started.runId, followUp: true },
          });
        }
      });

      return res.status(202).json({
        success: true,
        sessionId: started.sessionId,
        runId: started.runId,
        status: started.status,
      });
    }

    const items = Array.isArray(body.items) ? body.items : [];
    const language = body.language;
    if (!isLanguage(language)) {
      return res.status(400).json({ error: 'language must be cn or en' });
    }
    if (items.length < 2) {
      return res.status(400).json({ error: 'At least 2 companies required' });
    }

    await assertReportsOwned(
      userId,
      items.map(item => String(item?.reportId || ''))
    );

    await trackUserEvent({
      userId,
      eventType: 'compare_start',
      metadata: { itemCount: items.length, language },
    });

    const createRequest: CreateCompareRequest = {
      items: items.map(item => ({
        reportId: String(item?.reportId || ''),
        companyId: String(item?.companyId || ''),
      })),
      language,
      label: typeof body.label === 'string' ? body.label : undefined,
    };

    const started = await service.startComparison(userId, createRequest);
    void service.executeComparisonRun(userId, started.runId, createRequest).then(async () => {
      const status = await service.getRunStatus(userId, started.runId);
      if (status.status === 'COMPLETED') {
        await trackUserEvent({
          userId,
          eventType: 'compare_complete',
          metadata: {
            sessionId: started.sessionId,
            runId: started.runId,
            itemCount: items.length,
          },
        });
      }
    });

    res.status(202).json({
      success: true,
      sessionId: started.sessionId,
      runId: started.runId,
      status: started.status,
    });
  } catch (error: any) {
    const message = error?.message || 'Compare failed';
    const status =
      /not found|mismatch|incomplete|requires 2/i.test(message) ? 422 : 500;
    console.error('[compare] POST failed:', error);
    res.status(status).json({
      error: message,
      details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const sessions = await getCompareService().listSessions(req.user!.id);
    res.json({ sessions });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || 'Failed to list sessions' });
  }
});

router.get('/sessions/:id', async (req, res) => {
  try {
    const session = await getCompareService().getSessionDetail(req.user!.id, req.params.id);
    res.json({ session });
  } catch (error: any) {
    const status = /not found/i.test(error?.message) ? 404 : 500;
    res.status(status).json({ error: error?.message || 'Failed to load session' });
  }
});

router.get('/runs/:id', async (req, res) => {
  try {
    const status = await getCompareService().getRunStatus(req.user!.id, req.params.id);
    res.json(status);
  } catch (error: any) {
    const httpStatus = /not found/i.test(error?.message) ? 404 : 500;
    res.status(httpStatus).json({ error: error?.message || 'Failed to load run' });
  }
});

export { router as compareRouter };
