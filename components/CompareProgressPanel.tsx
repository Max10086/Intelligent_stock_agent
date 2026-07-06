import React, { useMemo } from 'react';
import type { Language } from '../types.ts';
import type { CompareRunProgress, CompareRunStep, ComparisonItem } from '../types/compare.ts';
import type { EligibleCompareCompany } from '../utils/compareEligible.ts';
import { getUIText } from '../constants.ts';

const COMPARE_STEPS: CompareRunStep[] = [
  'loading_reports',
  'building_digests',
  'fetching_topics',
  'ai_ranking',
  'saving',
];

const stepLabelKey = (step: CompareRunStep) => {
  switch (step) {
    case 'loading_reports':
      return 'compareStepLoadingReports' as const;
    case 'building_digests':
      return 'compareStepBuildingDigests' as const;
    case 'fetching_topics':
      return 'compareStepFetchingTopics' as const;
    case 'ai_ranking':
      return 'compareStepAiRanking' as const;
    case 'saving':
      return 'compareStepSaving' as const;
  }
};

interface CompareProgressPanelProps {
  language: Language;
  progress: CompareRunProgress;
  pendingCompanies?: Array<EligibleCompareCompany | ComparisonItem>;
  onOpenHistorySidebar?: () => void;
}

const resolveCompanyLabel = (item: ComparisonItem | EligibleCompareCompany): { name: string; ticker: string } => ({
  name: item.name,
  ticker: item.ticker,
});

export const CompareProgressPanel: React.FC<CompareProgressPanelProps> = ({
  language,
  progress,
  pendingCompanies = [],
  onOpenHistorySidebar,
}) => {
  const ui = getUIText(language);
  const currentIndex = COMPARE_STEPS.indexOf(progress.currentStep || 'loading_reports');

  const companies = useMemo(() => {
    if (progress.items?.length) {
      return progress.items.map(item => resolveCompanyLabel(item));
    }
    return pendingCompanies.map(item => resolveCompanyLabel(item));
  }, [pendingCompanies, progress.items]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">{ui.compareProgressTitle}</h2>
        <p className="text-sm text-gray-400 mt-1">{ui.compareProgressSubtitle}</p>
      </div>

      <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-blue-200">
            {ui.compareProgressPercent.replace('{percent}', String(progress.progress))}
          </span>
          <span className="text-xs font-mono text-gray-500">{progress.runId.slice(0, 8)}…</span>
        </div>
        <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.min(100, progress.progress)}%` }}
          />
        </div>
        <p className="text-xs text-gray-400">{ui.compareProgressHint}</p>
      </div>

      {companies.length > 0 && (
        <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-gray-300">{ui.compareProgressCompanies}</h3>
          <div className="flex flex-wrap gap-2">
            {companies.map(company => (
              <span
                key={`${company.ticker}::${company.name}`}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-gray-700 text-sm"
              >
                {company.name} ({company.ticker})
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4">
        <ol className="space-y-3">
          {COMPARE_STEPS.map((step, index) => {
            const done = currentIndex > index || progress.status === 'COMPLETED';
            const active = currentIndex === index && progress.status === 'PROCESSING';
            const failed = progress.status === 'FAILED' && currentIndex === index;
            const label = ui[stepLabelKey(step)];

            return (
              <li key={step} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${
                    failed
                      ? 'bg-red-500/20 text-red-300'
                      : done
                        ? 'bg-green-500/20 text-green-300'
                        : active
                          ? 'bg-blue-500/30 text-blue-200 animate-pulse'
                          : 'bg-gray-700 text-gray-500'
                  }`}
                >
                  {failed ? '!' : done ? '✓' : active ? '…' : index + 1}
                </span>
                <div>
                  <div
                    className={`text-sm ${
                      active ? 'text-gray-100 font-medium' : done ? 'text-gray-300' : 'text-gray-500'
                    }`}
                  >
                    {label}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {onOpenHistorySidebar && (
        <p className="text-sm text-purple-300/90">
          {ui.compareHistoryInSidebar}{' '}
          <button
            type="button"
            onClick={onOpenHistorySidebar}
            className="underline hover:text-purple-200"
          >
            {ui.historyComparisonsTab} →
          </button>
        </p>
      )}

      {progress.status === 'FAILED' && progress.error && (
        <div className="rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-300">
          {ui.compareProgressFailed}: {progress.error}
        </div>
      )}
    </div>
  );
};
