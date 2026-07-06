import type { Language } from '../types.ts';
import type { ComparisonSessionSummary } from '../types/compare.ts';

export const formatCompareSessionLabel = (
  session: ComparisonSessionSummary,
  language: Language
): string => {
  const tops = session.latestRun?.topCompanies ?? [];
  const compareDate = session.latestRun?.createdAt ?? session.updatedAt;
  const dateStr = new Date(compareDate).toLocaleDateString(
    language === 'cn' ? 'zh-CN' : 'en-US',
    { year: 'numeric', month: 'numeric', day: 'numeric' }
  );

  if (tops.length === 0) {
    return dateStr;
  }

  const companies = tops
    .map(company => `${company.name}${company.ticker ? ` (${company.ticker})` : ''}`)
    .join(' · ');

  return `${companies} — ${dateStr}`;
};
