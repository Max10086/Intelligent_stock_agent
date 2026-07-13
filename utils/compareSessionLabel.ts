import type { Language } from '../types.ts';
import type { ComparisonSessionSummary } from '../types/compare.ts';

export const formatCompareSessionDate = (
  session: ComparisonSessionSummary,
  language: Language
): string => {
  const compareDate = session.latestRun?.createdAt ?? session.updatedAt;
  return new Date(compareDate).toLocaleDateString(language === 'cn' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const formatCompareSessionLabel = (
  session: ComparisonSessionSummary,
  language: Language
): string => {
  const tops = session.latestRun?.topCompanies ?? [];

  if (tops.length === 0) {
    const count = session.latestRun?.itemCount;
    if (count) {
      return language === 'cn' ? `${count} 家公司对比` : `Compare ${count} companies`;
    }
    return language === 'cn' ? '对比记录' : 'Comparison';
  }

  return tops
    .map(company => `${company.name}${company.ticker ? ` (${company.ticker})` : ''}`)
    .join(' · ');
};
