import type { AnalysisState } from '../types.ts';
import type { ComparisonSessionSummary } from '../types/compare.ts';
import type { TickerHistoryGroup } from './analysisTimeline.ts';

export const normalizeHistorySearchQuery = (raw: string): string => raw.trim().toLowerCase();

const includesQuery = (value: string | null | undefined, query: string): boolean =>
  Boolean(value && value.toLowerCase().includes(query));

export const reportMatchesSearch = (report: AnalysisState, rawQuery: string): boolean => {
  const query = normalizeHistorySearchQuery(rawQuery);
  if (!query) return true;

  if (includesQuery(report.query, query)) return true;

  for (const company of [report.focusCompany, ...(report.candidateCompanies || [])]) {
    if (!company) continue;
    const { name, ticker } = company.profile;
    if (includesQuery(name, query) || includesQuery(ticker, query)) return true;
  }

  return false;
};

export const compareSessionMatchesSearch = (
  session: ComparisonSessionSummary,
  rawQuery: string
): boolean => {
  const query = normalizeHistorySearchQuery(rawQuery);
  if (!query) return true;

  if (includesQuery(session.label, query)) return true;

  const latest = session.latestRun;
  if (!latest) return false;

  if (includesQuery(latest.topTicker, query) || includesQuery(latest.topName, query)) {
    return true;
  }

  for (const company of latest.topCompanies || []) {
    if (includesQuery(company.name, query) || includesQuery(company.ticker, query)) {
      return true;
    }
  }

  return false;
};

export const filterTickerHistoryGroups = (
  groups: TickerHistoryGroup[],
  rawQuery: string
): TickerHistoryGroup[] => {
  const query = normalizeHistorySearchQuery(rawQuery);
  if (!query) return groups;

  return groups
    .map(group => {
      const groupMatches =
        includesQuery(group.name, query) || includesQuery(group.ticker, query);

      const entries = group.entries.filter(
        entry =>
          groupMatches ||
          includesQuery(entry.ticker, query) ||
          includesQuery(entry.company.profile.name, query) ||
          includesQuery(entry.company.profile.ticker, query) ||
          reportMatchesSearch(entry.report, query)
      );

      if (entries.length === 0) return null;
      return { ...group, entries };
    })
    .filter((group): group is TickerHistoryGroup => group !== null);
};
