import type { AnalysisState, CompanyAnalysis, Language } from '../../types.js';
import type {
  ComparisonItem,
  ComparisonItemInput,
  CompanyRole,
  EquityMarket,
} from '../../types/compare.js';
import { prisma, withPrismaRetry } from '../db.js';
import { isCompanyEligibleForCompare } from '../../utils/compareEligible.js';
import { getEquityMarket } from '../../utils/companyDiscovery.js';
import {
  buildComparisonItemId,
  listComparableCompaniesFromReport,
} from '../../utils/compareDigest.js';

function parseReportResult(job: {
  id: string;
  ticker: string;
  query: string;
  language: string;
  completedAt: Date | null;
  result: string;
}): AnalysisState | null {
  try {
    const result: AnalysisState = JSON.parse(job.result);
    return {
      ...result,
      id: job.id,
      clientSessionId: typeof result.id === 'string' ? result.id : job.id,
      timestamp: job.completedAt?.toISOString() || new Date().toISOString(),
      status:
        result.status === 'partial' || result.status === 'analyzing' || result.status === 'error'
          ? result.status
          : 'complete',
      language: (job.language as Language) || result.language || 'en',
      query: job.query || job.ticker,
    };
  } catch {
    return null;
  }
}

export async function loadReportById(reportId: string): Promise<AnalysisState | null> {
  const job = await withPrismaRetry(
    () =>
      prisma.analysisJob.findUnique({
        where: { id: reportId },
        select: {
          id: true,
          ticker: true,
          query: true,
          language: true,
          completedAt: true,
          result: true,
          status: true,
        },
      }),
    'compare.loadReport',
    2
  );

  if (!job || job.status !== 'COMPLETED' || !job.result) return null;
  return parseReportResult({
    id: job.id,
    ticker: job.ticker,
    query: job.query,
    language: job.language,
    completedAt: job.completedAt,
    result: job.result,
  });
}

export function findCompanyInReport(
  report: AnalysisState,
  companyId: string
): { company: CompanyAnalysis; role: CompanyRole } | null {
  if (report.focusCompany?.id === companyId) {
    return { company: report.focusCompany, role: 'focus' };
  }
  const candidate = (report.candidateCompanies || []).find(c => c.id === companyId);
  if (candidate) return { company: candidate, role: 'candidate' };
  return null;
}

export async function resolveComparisonItems(
  inputs: ComparisonItemInput[],
  expectedLanguage: Language
): Promise<ComparisonItem[]> {
  const items: ComparisonItem[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const key = buildComparisonItemId(input.reportId, input.companyId);
    if (seen.has(key)) continue;
    seen.add(key);

    const report = await loadReportById(input.reportId);
    if (!report) {
      throw new Error(`Report not found: ${input.reportId}`);
    }

    const reportLanguage = report.language;
    if (reportLanguage !== expectedLanguage) {
      throw new Error(
        `Language mismatch: report ${input.reportId} is ${reportLanguage}, expected ${expectedLanguage}`
      );
    }

    const match = findCompanyInReport(report, input.companyId);
    if (!match) {
      throw new Error(`Company ${input.companyId} not found in report ${input.reportId}`);
    }

    if (!isCompanyEligibleForCompare(match.company)) {
      throw new Error(
        `Company ${match.company.profile.name} (${match.company.profile.ticker}) analysis is incomplete`
      );
    }

    items.push({
      reportId: input.reportId,
      companyId: input.companyId,
      companyRole: match.role,
      ticker: match.company.profile.ticker,
      name: match.company.profile.name,
      exchange: match.company.profile.exchange,
      snapshotAt: report.timestamp,
      reportLanguage,
    });
  }

  return items;
}

export function collectMarketsFromItems(items: ComparisonItem[]): EquityMarket[] {
  const markets = new Set<EquityMarket>();
  for (const item of items) {
    const market = getEquityMarket({ ticker: item.ticker, exchange: item.exchange });
    if (market) markets.add(market);
  }
  return [...markets];
}

export async function loadCompanyForItem(item: ComparisonItem): Promise<CompanyAnalysis> {
  const report = await loadReportById(item.reportId);
  if (!report) throw new Error(`Report not found: ${item.reportId}`);
  const match = findCompanyInReport(report, item.companyId);
  if (!match) throw new Error(`Company not found: ${item.companyId}`);
  return match.company;
}

/** Latest completed report for ticker+language containing a complete company analysis. */
export async function findLatestCompleteReportForTicker(
  ticker: string,
  language: Language
): Promise<{ reportId: string; companyId: string; role: CompanyRole } | null> {
  const upper = ticker.toUpperCase();
  const jobs = await withPrismaRetry(
    () =>
      prisma.analysisJob.findMany({
        where: { status: 'COMPLETED', language, result: { not: null } },
        orderBy: { completedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          ticker: true,
          query: true,
          language: true,
          completedAt: true,
          result: true,
        },
      }),
    'compare.findLatestTicker',
    2
  );

  for (const job of jobs) {
    if (!job.result) continue;
    const report = parseReportResult({
      id: job.id,
      ticker: job.ticker,
      query: job.query,
      language: job.language,
      completedAt: job.completedAt,
      result: job.result,
    });
    if (!report) continue;

    for (const { company, role } of listComparableCompaniesFromReport(
      report.focusCompany,
      report.candidateCompanies || []
    )) {
      if (company.profile.ticker.toUpperCase() !== upper) continue;
      if (!isCompanyEligibleForCompare(company)) continue;
      return { reportId: report.id, companyId: company.id, role };
    }
  }

  return null;
}

export async function refreshComparisonItems(
  items: ComparisonItem[],
  language: Language
): Promise<ComparisonItem[]> {
  const refreshed: ComparisonItemInput[] = [];
  for (const item of items) {
    const latest = await findLatestCompleteReportForTicker(item.ticker, language);
    if (latest) {
      refreshed.push({ reportId: latest.reportId, companyId: latest.companyId });
    } else {
      refreshed.push({ reportId: item.reportId, companyId: item.companyId });
    }
  }
  return resolveComparisonItems(refreshed, language);
}
