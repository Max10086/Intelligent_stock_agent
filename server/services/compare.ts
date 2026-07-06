import type { Language } from '../../types.js';
import type {
  CompareRunResult,
  CompareRunStatusResponse,
  CompareRunStep,
  CompareStartResponse,
  ComparisonItem,
  ComparisonSessionDetail,
  ComparisonSessionSummary,
  CompanyCompareDigest,
  CreateCompareRequest,
  FollowUpCompareRequest,
} from '../../types/compare.js';
import { prisma, withPrismaRetry } from '../db.js';
import { ModelClient } from './modelClient.js';
import {
  buildCompanyCompareDigest,
  buildComparisonItemId,
} from '../../utils/compareDigest.js';
import {
  buildCrossCompanyCompareFollowUpPrompt,
  buildCrossCompanyComparePrompt,
} from '../../utils/crossCompanyComparePrompt.js';
import {
  buildCompareRunResult,
  parseCompareLlmResponse,
  summarizePriorRun,
} from '../../utils/compareParse.js';
import { COMPARE_METHODOLOGY_NOTE } from '../../utils/compareScoring.js';
import { fetchMarketHotTopicsForMarkets } from './marketHotTopicsService.js';
import {
  collectMarketsFromItems,
  loadCompanyForItem,
  refreshComparisonItems,
  resolveComparisonItems,
} from './compareReportLoader.js';

export const MAX_COMPARE_ITEMS = Math.max(
  2,
  Math.min(5, Number(process.env.MAX_COMPARE_ITEMS || '5'))
);

const EMPTY_SNAPSHOT = JSON.stringify({ markets: {} });
const EMPTY_RESULT = JSON.stringify({ rankings: [], portfolioSummary: '', methodologyNote: '' });

const outputLanguageFor = (lang: Language): string =>
  lang === 'cn' ? 'Simplified Chinese' : 'English';

const parseComparisonItems = (raw: string): ComparisonItem[] => {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ComparisonItem[]) : [];
  } catch {
    return [];
  }
};

export class CompareService {
  constructor(private modelClient: ModelClient) {}

  private async updateProgress(runId: string, progress: number, currentStep: CompareRunStep) {
    await withPrismaRetry(
      () =>
        prisma.comparisonRun.update({
          where: { id: runId },
          data: {
            progress: Math.min(100, Math.max(0, Math.round(progress))),
            currentStep,
          },
        }),
      'compare.updateProgress',
      2
    );
  }

  private async markRunFailed(runId: string, error: string) {
    await withPrismaRetry(
      () =>
        prisma.comparisonRun.update({
          where: { id: runId },
          data: {
            status: 'FAILED',
            progress: 0,
            currentStep: null,
            error,
          },
        }),
      'compare.markFailed',
      2
    );
  }

  private buildCompletedRun(row: {
    id: string;
    sessionId: string;
    parentRunId: string | null;
    createdAt: Date;
    items: string;
    marketHotTopics: string;
    result: string;
    digests: string | null;
    changeSummary: string | null;
  }): CompareRunResult {
    const items = parseComparisonItems(row.items);
    const marketHotTopics = JSON.parse(row.marketHotTopics);
    const resultCore = JSON.parse(row.result);
    const digests = row.digests ? (JSON.parse(row.digests) as CompanyCompareDigest[]) : undefined;

    return buildCompareRunResult({
      runId: row.id,
      sessionId: row.sessionId,
      parentRunId: row.parentRunId || undefined,
      createdAt: row.createdAt.toISOString(),
      items,
      marketHotTopics,
      rankings: resultCore.rankings || [],
      portfolioSummary: resultCore.portfolioSummary || '',
      methodologyNote: resultCore.methodologyNote || COMPARE_METHODOLOGY_NOTE,
      changeSummary: row.changeSummary || undefined,
      warnings: resultCore.warnings,
      digests,
    });
  }

  private async runCompareLlm(
    digests: CompanyCompareDigest[],
    hotTopics: CompareRunResult['marketHotTopics'],
    language: Language,
    priorRun?: CompareRunResult
  ): Promise<{
    rankings: CompareRunResult['rankings'];
    portfolioSummary: string;
    changeSummary?: string;
    warnings?: string[];
  }> {
    const outputLanguage = outputLanguageFor(language);
    const itemIds = digests.map(d => d.itemId);

    const callOnce = async (strict: boolean) => {
      const prompt = priorRun
        ? buildCrossCompanyCompareFollowUpPrompt(
            digests,
            hotTopics,
            summarizePriorRun(priorRun),
            outputLanguage,
            strict
          )
        : buildCrossCompanyComparePrompt(digests, hotTopics, outputLanguage, strict);

      const response = await this.modelClient.generateContent({
        step: priorRun ? 'cross_company_compare_follow_up' : 'cross_company_compare',
        contents: { role: 'user', parts: [{ text: prompt }] },
        config: { responseMimeType: 'application/json' },
      });
      return response.text || '';
    };

    let parsed = parseCompareLlmResponse(await callOnce(false), itemIds);
    if (parsed.rankings.every(r => r.compositeScore === 0) || !parsed.portfolioSummary) {
      parsed = parseCompareLlmResponse(await callOnce(true), itemIds);
    }

    return parsed;
  }

  async startComparison(userId: string, request: CreateCompareRequest): Promise<CompareStartResponse> {
    if (request.items.length < 2 || request.items.length > MAX_COMPARE_ITEMS) {
      throw new Error(`Compare requires 2–${MAX_COMPARE_ITEMS} companies`);
    }

    const session = await prisma.comparisonSession.create({
      data: {
        userId,
        label: request.label?.trim() || null,
        language: request.language,
      },
    });

    const run = await prisma.comparisonRun.create({
      data: {
        sessionId: session.id,
        status: 'PROCESSING',
        progress: 0,
        currentStep: 'loading_reports',
        items: JSON.stringify(request.items),
        marketHotTopics: EMPTY_SNAPSHOT,
        result: EMPTY_RESULT,
      },
    });

    return { runId: run.id, sessionId: session.id, status: 'PROCESSING' };
  }

  async executeComparisonRun(userId: string, runId: string, request: CreateCompareRequest) {
    try {
      await this.updateProgress(runId, 5, 'loading_reports');
      const items = await resolveComparisonItems(request.items, request.language);

      await withPrismaRetry(
        () =>
          prisma.comparisonRun.update({
            where: { id: runId },
            data: { items: JSON.stringify(items) },
          }),
        'compare.saveItems',
        2
      );

      const digests: CompanyCompareDigest[] = [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        await this.updateProgress(
          runId,
          15 + ((index + 1) / items.length) * 25,
          index === 0 ? 'loading_reports' : 'building_digests'
        );
        const company = await loadCompanyForItem(item);
        digests.push(
          buildCompanyCompareDigest(company, {
            reportId: item.reportId,
            companyId: item.companyId,
            companyRole: item.companyRole,
            snapshotAt: item.snapshotAt,
          })
        );
      }

      await this.updateProgress(runId, 45, 'fetching_topics');
      const markets = collectMarketsFromItems(items);
      const hotTopics = await fetchMarketHotTopicsForMarkets(
        this.modelClient,
        markets,
        request.language
      );

      await this.updateProgress(runId, 60, 'ai_ranking');
      const llmResult = await this.runCompareLlm(digests, hotTopics, request.language);

      await this.updateProgress(runId, 92, 'saving');
      const run = await withPrismaRetry(
        () =>
          prisma.comparisonRun.update({
            where: { id: runId },
            data: {
              status: 'COMPLETED',
              progress: 100,
              currentStep: null,
              error: null,
              items: JSON.stringify(items),
              marketHotTopics: JSON.stringify(hotTopics),
              result: JSON.stringify({
                rankings: llmResult.rankings,
                portfolioSummary: llmResult.portfolioSummary,
                methodologyNote: COMPARE_METHODOLOGY_NOTE,
                warnings: llmResult.warnings,
              }),
              digests: JSON.stringify(digests),
              changeSummary: null,
            },
          }),
        'compare.completeRun',
        2
      );

      await prisma.comparisonSession.update({
        where: { id: run.sessionId },
        data: { updatedAt: new Date() },
      });
    } catch (error: any) {
      const message = error?.message || 'Compare failed';
      console.error(`[compare] executeComparisonRun ${runId} failed:`, error);
      await this.markRunFailed(runId, message);
    }
  }

  async startFollowUpComparison(
    userId: string,
    request: FollowUpCompareRequest
  ): Promise<CompareStartResponse> {
    const parentRow = await withPrismaRetry(
      () => prisma.comparisonRun.findUnique({ where: { id: request.parentRunId } }),
      'compare.getParentRun',
      2
    );
    if (!parentRow) throw new Error('Comparison run not found');
    if (parentRow.sessionId !== request.sessionId) {
      throw new Error('parentRunId does not belong to sessionId');
    }
    if (parentRow.status !== 'COMPLETED') {
      throw new Error('Parent comparison is still processing');
    }

    await this.assertSessionOwner(userId, request.sessionId);

    const run = await prisma.comparisonRun.create({
      data: {
        sessionId: request.sessionId,
        parentRunId: request.parentRunId,
        status: 'PROCESSING',
        progress: 0,
        currentStep: 'loading_reports',
        items: parentRow.items,
        marketHotTopics: EMPTY_SNAPSHOT,
        result: EMPTY_RESULT,
      },
    });

    return { runId: run.id, sessionId: request.sessionId, status: 'PROCESSING' };
  }

  async executeFollowUpRun(userId: string, runId: string, request: FollowUpCompareRequest) {
    try {
      const parentRun = await this.getRunById(userId, request.parentRunId);
      await this.assertSessionOwner(userId, request.sessionId);

      let items = parentRun.items;
      if (request.refreshReports) {
        await this.updateProgress(runId, 8, 'loading_reports');
        items = await refreshComparisonItems(items, items[0]?.reportLanguage || 'cn');
      }

      if (items.length < 2 || items.length > MAX_COMPARE_ITEMS) {
        throw new Error(`Compare requires 2–${MAX_COMPARE_ITEMS} companies`);
      }

      await withPrismaRetry(
        () =>
          prisma.comparisonRun.update({
            where: { id: runId },
            data: { items: JSON.stringify(items) },
          }),
        'compare.saveFollowUpItems',
        2
      );

      const digests: CompanyCompareDigest[] = [];
      for (let index = 0; index < items.length; index++) {
        const item = items[index];
        await this.updateProgress(
          runId,
          15 + ((index + 1) / items.length) * 25,
          index === 0 ? 'loading_reports' : 'building_digests'
        );
        const company = await loadCompanyForItem(item);
        digests.push(
          buildCompanyCompareDigest(company, {
            reportId: item.reportId,
            companyId: item.companyId,
            companyRole: item.companyRole,
            snapshotAt: item.snapshotAt,
          })
        );
      }

      const language = items[0]?.reportLanguage || 'cn';
      await this.updateProgress(runId, 45, 'fetching_topics');
      const markets = collectMarketsFromItems(items);
      const hotTopics = await fetchMarketHotTopicsForMarkets(this.modelClient, markets, language);

      await this.updateProgress(runId, 60, 'ai_ranking');
      const llmResult = await this.runCompareLlm(digests, hotTopics, language, parentRun);

      await this.updateProgress(runId, 92, 'saving');
      const run = await withPrismaRetry(
        () =>
          prisma.comparisonRun.update({
            where: { id: runId },
            data: {
              status: 'COMPLETED',
              progress: 100,
              currentStep: null,
              error: null,
              items: JSON.stringify(items),
              marketHotTopics: JSON.stringify(hotTopics),
              result: JSON.stringify({
                rankings: llmResult.rankings,
                portfolioSummary: llmResult.portfolioSummary,
                methodologyNote: COMPARE_METHODOLOGY_NOTE,
                warnings: llmResult.warnings,
              }),
              digests: JSON.stringify(digests),
              changeSummary: llmResult.changeSummary || null,
            },
          }),
        'compare.completeFollowUp',
        2
      );

      await prisma.comparisonSession.update({
        where: { id: run.sessionId },
        data: { updatedAt: new Date() },
      });
    } catch (error: any) {
      const message = error?.message || 'Follow-up compare failed';
      console.error(`[compare] executeFollowUpRun ${runId} failed:`, error);
      await this.markRunFailed(runId, message);
    }
  }

  private async assertSessionOwner(userId: string, sessionId: string) {
    const session = await withPrismaRetry(
      () =>
        prisma.comparisonSession.findFirst({
          where: { id: sessionId, userId },
          select: { id: true },
        }),
      'compare.assertOwner',
      2
    );
    if (!session) throw new Error('Comparison session not found');
  }

  async getRunStatus(userId: string, runId: string): Promise<CompareRunStatusResponse> {
    const run = await withPrismaRetry(
      () => prisma.comparisonRun.findUnique({ where: { id: runId } }),
      'compare.getRunStatus',
      2
    );
    if (!run) throw new Error('Comparison run not found');

    await this.assertSessionOwner(userId, run.sessionId);

    const items = parseComparisonItems(run.items);
    const response: CompareRunStatusResponse = {
      runId: run.id,
      sessionId: run.sessionId,
      status: run.status as CompareRunStatusResponse['status'],
      progress: run.progress,
      currentStep: (run.currentStep as CompareRunStep | null) || undefined,
      error: run.error || undefined,
      items: items.length ? items : undefined,
    };

    if (run.status === 'COMPLETED') {
      response.run = this.buildCompletedRun(run);
    }

    return response;
  }

  async getRunById(userId: string, runId: string): Promise<CompareRunResult> {
    const status = await this.getRunStatus(userId, runId);
    if (status.status === 'PROCESSING') {
      throw new Error('Comparison is still processing');
    }
    if (status.status === 'FAILED') {
      throw new Error(status.error || 'Comparison failed');
    }
    if (!status.run) {
      throw new Error('Comparison result unavailable');
    }
    return status.run;
  }

  async listSessions(userId: string): Promise<ComparisonSessionSummary[]> {
    const sessions = await withPrismaRetry(
      () =>
        prisma.comparisonSession.findMany({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          include: {
            runs: {
              where: { status: 'COMPLETED' },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            _count: { select: { runs: true } },
          },
        }),
      'compare.listSessions',
      2
    );

    return sessions.map(session => {
      const latest = session.runs[0];
      let latestRun: ComparisonSessionSummary['latestRun'];
      if (latest) {
        const items = parseComparisonItems(latest.items);
        const resultCore = JSON.parse(latest.result);
        const rankings = Array.isArray(resultCore.rankings) ? resultCore.rankings : [];
        const topCompanies = rankings.slice(0, 3).map((entry: CompareRunResult['rankings'][0]) => {
          const matched = items.find(
            i => buildComparisonItemId(i.reportId, i.companyId) === entry.itemId
          );
          return {
            rank: entry.rank,
            ticker: matched?.ticker || '',
            name: matched?.name || entry.itemId,
          };
        });
        const top = rankings[0];
        const topItem = top
          ? items.find(i => buildComparisonItemId(i.reportId, i.companyId) === top.itemId)
          : undefined;
        latestRun = {
          runId: latest.id,
          createdAt: latest.createdAt.toISOString(),
          itemCount: items.length,
          topTicker: topItem?.ticker,
          topName: topItem?.name,
          topCompanies,
        };
      }

      return {
        id: session.id,
        label: session.label,
        language: session.language as Language,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        runCount: session._count.runs,
        latestRun,
      };
    });
  }

  async getSessionDetail(userId: string, sessionId: string): Promise<ComparisonSessionDetail> {
    await this.assertSessionOwner(userId, sessionId);
    const session = await withPrismaRetry(
      () =>
        prisma.comparisonSession.findUnique({
          where: { id: sessionId },
          include: { runs: { orderBy: { createdAt: 'desc' } } },
        }),
      'compare.getSession',
      2
    );
    if (!session) throw new Error('Comparison session not found');

    const runs = session.runs.map(run => {
      const items = parseComparisonItems(run.items);
      const resultCore = run.status === 'COMPLETED' ? JSON.parse(run.result) : { rankings: [] };
      const top = resultCore.rankings?.[0] as CompareRunResult['rankings'][0] | undefined;
      return {
        id: run.id,
        parentRunId: run.parentRunId,
        createdAt: run.createdAt.toISOString(),
        itemCount: items.length,
        topRank: top,
        changeSummary: run.changeSummary,
        status: run.status as CompareRunStatusResponse['status'],
        progress: run.progress,
      };
    });

    const summary = (await this.listSessions(userId)).find(s => s.id === sessionId);

    return {
      id: session.id,
      label: session.label,
      language: session.language as Language,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      runCount: session.runs.length,
      latestRun: summary?.latestRun,
      runs,
    };
  }
}
