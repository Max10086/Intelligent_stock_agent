import type {
  AnalysisState,
  CompanyAnalysis,
  FollowUpBaseline,
  Language,
} from '../types.ts';
import { extractFollowUpBaseline } from './followUpHelpers.ts';

export type ComparisonBaselineMode = 'previous' | 'initial';

export interface TickerTimelineEntry {
  reportId: string;
  report: AnalysisState;
  ticker: string;
  company: CompanyAnalysis;
  sequenceLabel: string;
  sequenceIndex: number;
  isFollowUp: boolean;
}

export interface TickerHistoryGroup {
  ticker: string;
  name: string;
  exchange: string;
  entries: TickerTimelineEntry[];
}

export const getCompaniesFromState = (state: AnalysisState): CompanyAnalysis[] =>
  [state.focusCompany, ...(state.candidateCompanies || [])].filter(
    Boolean
  ) as CompanyAnalysis[];

export const findCompanyByTicker = (
  state: AnalysisState,
  ticker: string
): CompanyAnalysis | null => {
  const upper = ticker.toUpperCase();
  return (
    getCompaniesFromState(state).find(
      company => company.profile.ticker.toUpperCase() === upper
    ) || null
  );
};

const buildHistoryIndex = (history: AnalysisState[]): Map<string, AnalysisState> =>
  new Map(history.map(item => [item.id, item]));

export const getTimelineSequenceLabel = (
  entry: TickerTimelineEntry,
  lang: Language
): string => buildSequenceLabel(entry, lang);

export const buildSequenceLabel = (
  entry: TickerTimelineEntry,
  lang: Language
): string => {
  if (!entry.isFollowUp && entry.sequenceIndex === 0) {
    return lang === 'cn' ? '首次分析' : 'Initial';
  }
  if (entry.isFollowUp) {
    return lang === 'cn'
      ? `跟进 ${entry.sequenceIndex}`
      : `Follow-up ${entry.sequenceIndex}`;
  }
  return lang === 'cn'
    ? `新一轮 ${entry.sequenceIndex}`
    : `New cycle ${entry.sequenceIndex}`;
};

export const buildTickerHistoryGroups = (
  history: AnalysisState[],
  lang: Language
): TickerHistoryGroup[] => {
  const dedupedHistory = dedupeHistoryBySession(history);
  const byTicker = new Map<
    string,
    { name: string; exchange: string; raw: TickerTimelineEntry[] }
  >();

  for (const report of dedupedHistory) {
    for (const company of getCompaniesFromState(report)) {
      const ticker = company.profile.ticker.toUpperCase();
      if (!byTicker.has(ticker)) {
        byTicker.set(ticker, {
          name: company.profile.name,
          exchange: company.profile.exchange,
          raw: [],
        });
      }
      const bucket = byTicker.get(ticker)!;
      if (!bucket.name && company.profile.name) {
        bucket.name = company.profile.name;
      }
      bucket.raw.push({
        reportId: report.id,
        report,
        ticker,
        company,
        sequenceLabel: '',
        sequenceIndex: 0,
        isFollowUp: report.analysisType === 'follow_up',
      });
    }
  }

  const groups: TickerHistoryGroup[] = [];

  for (const [ticker, bucket] of byTicker.entries()) {
    const deduped = new Map<string, TickerTimelineEntry>();
    for (const entry of bucket.raw) {
      if (!deduped.has(entry.reportId)) {
        deduped.set(entry.reportId, entry);
      }
    }

    const sorted = [...deduped.values()].sort(
      (a, b) =>
        new Date(a.report.timestamp).getTime() - new Date(b.report.timestamp).getTime()
    );

    let followUpCounter = 0;
    let initialCounter = 0;
    sorted.forEach(entry => {
      if (!entry.isFollowUp) {
        initialCounter += 1;
        entry.sequenceIndex = initialCounter === 1 ? 0 : initialCounter - 1;
      } else {
        followUpCounter += 1;
        entry.sequenceIndex = followUpCounter;
      }
      entry.sequenceLabel = buildSequenceLabel(entry, lang);
    });

    groups.push({
      ticker,
      name: bucket.name || ticker,
      exchange: bucket.exchange,
      entries: sorted,
    });
  }

  groups.sort((a, b) => {
    const aLatest = a.entries[a.entries.length - 1]?.report.timestamp || '';
    const bLatest = b.entries[b.entries.length - 1]?.report.timestamp || '';
    return new Date(bLatest).getTime() - new Date(aLatest).getTime();
  });

  return groups;
};

export const getTickerTimelineForReport = (
  history: AnalysisState[],
  reportId: string,
  ticker: string,
  lang: Language
): TickerTimelineEntry[] => {
  const groups = buildTickerHistoryGroups(history, lang);
  const upper = ticker.toUpperCase();
  const group = groups.find(item => item.ticker === upper);
  if (!group) return [];
  return group.entries;
};

export const resolveRootReportForTicker = (
  report: AnalysisState,
  ticker: string,
  historyById: Map<string, AnalysisState>
): AnalysisState => {
  let current: AnalysisState | undefined = report;
  const upper = ticker.toUpperCase();

  while (current?.followUpMeta?.parentAnalysisId) {
    const parent = historyById.get(current.followUpMeta.parentAnalysisId);
    if (!parent) break;
    if (!findCompanyByTicker(parent, upper)) break;
    current = parent;
  }

  return current || report;
};

export const resolvePreviousReportForTicker = (
  report: AnalysisState,
  ticker: string,
  historyById: Map<string, AnalysisState>
): AnalysisState | null => {
  const parentId = report.followUpMeta?.parentAnalysisId;
  if (!parentId) return null;
  const parent = historyById.get(parentId);
  if (!parent || !findCompanyByTicker(parent, ticker.toUpperCase())) return null;
  return parent;
};

export const getComparisonBaseline = (
  report: AnalysisState,
  ticker: string,
  mode: ComparisonBaselineMode,
  history: AnalysisState[]
): FollowUpBaseline | null => {
  const historyById = buildHistoryIndex(history);
  const upper = ticker.toUpperCase();
  const currentCompany = findCompanyByTicker(report, upper);
  if (!currentCompany) return null;

  if (mode === 'previous') {
    if (currentCompany.priorBaseline) {
      return currentCompany.priorBaseline;
    }
    const previousReport = resolvePreviousReportForTicker(report, upper, historyById);
    if (!previousReport) return null;
    const previousCompany = findCompanyByTicker(previousReport, upper);
    if (!previousCompany) return null;
    return extractFollowUpBaseline(previousCompany, previousReport.timestamp);
  }

  const rootReport = resolveRootReportForTicker(report, upper, historyById);
  const rootCompany = findCompanyByTicker(rootReport, upper);
  if (!rootCompany) return null;

  if (rootReport.id === report.id) {
    return null;
  }

  return extractFollowUpBaseline(rootCompany, rootReport.timestamp);
};

export const canShowComparisonToggle = (
  report: AnalysisState,
  ticker: string,
  history: AnalysisState[]
): boolean => {
  if (report.analysisType !== 'follow_up') return false;
  const initialBaseline = getComparisonBaseline(report, ticker, 'initial', history);
  const previousBaseline = getComparisonBaseline(report, ticker, 'previous', history);
  return Boolean(initialBaseline && previousBaseline && initialBaseline.analysisDate !== previousBaseline.analysisDate);
};

export const truncateConclusion = (text: string | undefined, max = 48): string => {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
};

/** Collapse duplicate saves of the same analysis session (keeps newest by timestamp). */
export const dedupeHistoryBySession = (history: AnalysisState[]): AnalysisState[] => {
  const bySession = new Map<string, AnalysisState>();

  for (const item of history) {
    const key = item.clientSessionId || item.id;
    const existing = bySession.get(key);
    if (!existing || new Date(item.timestamp).getTime() >= new Date(existing.timestamp).getTime()) {
      bySession.set(key, item);
    }
  }

  return [...bySession.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
};
