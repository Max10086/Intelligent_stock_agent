import React, { useMemo } from 'react';
import type { Language } from '../types.ts';
import type { CompareRunProgress, CompareRunStep, ComparisonItem } from '../types/compare.ts';
import type { EligibleCompareCompany } from '../utils/compareEligible.ts';
import { buildCompareBasketKey } from '../utils/compareEligible.ts';
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

const formatCompanyChip = (name: string, ticker: string): string => {
  const safeName = name.trim();
  const safeTicker = ticker.trim();
  if (safeName && safeTicker) return `${safeName} (${safeTicker})`;
  return safeName || safeTicker || '—';
};

export const CompareProgressPanel: React.FC<CompareProgressPanelProps> = ({
  language,
  progress,
  pendingCompanies = [],
  onOpenHistorySidebar,
}) => {
  const ui = getUIText(language);
  const currentIndex = COMPARE_STEPS.indexOf(progress.currentStep || 'loading_reports');

  const companies = useMemo(() => {
    const pendingByKey = new Map(
      pendingCompanies.map(item => [
        buildCompareBasketKey(item.reportId, item.companyId),
        { name: item.name?.trim() || '', ticker: item.ticker?.trim() || '' },
      ])
    );

    const sourceItems =
      progress.items?.length && progress.items.length > 0
        ? progress.items
        : pendingCompanies;

    return sourceItems
      .map(item => {
        const key = buildCompareBasketKey(item.reportId, item.companyId);
        const pending = pendingByKey.get(key);
        const name = (item.name || pending?.name || '').trim();
        const ticker = (item.ticker || pending?.ticker || '').trim();
        return { key, name, ticker };
      })
      .filter(item => item.name || item.ticker);
  }, [pendingCompanies, progress.items]);

  return (
    <div className="w-full min-w-0 max-w-full space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-100">{ui.compareProgressTitle}</h2>
        <p className="text-sm text-gray-400 mt-1">{ui.compareProgressSubtitle}</p>
      </div>

      <div className="rounded-lg border border-blue-500/30 bg-blue-950/20 p-4 space-y-4 w-full min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-blue-200 tabular-nums shrink-0">
            {ui.compareProgressPercent.replace('{percent}', String(progress.progress))}
          </span>
          <span className="text-xs font-mono text-gray-500 truncate max-w-[40%]">
            {progress.runId ? `${progress.runId.slice(0, 8)}…` : ''}
          </span>
        </div>
        <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden w-full">
          <div
            className="h-full bg-blue-500 rounded-full transition-[width] duration-500 ease-out"
            style={{ width: `${Math.min(100, progress.progress)}%` }}
          />
        </div>
        <p className="text-xs text-gray-400">{ui.compareProgressHint}</p>
      </div>

      {companies.length > 0 && (
        <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4 space-y-3 w-full min-w-0">
          <h3 className="text-sm font-semibold text-gray-300">{ui.compareProgressCompanies}</h3>
          <div className="flex flex-wrap gap-2">
            {companies.map(company => (
              <span
                key={company.key}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-gray-700 text-sm max-w-full truncate"
              >
                {formatCompanyChip(company.name, company.ticker)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-4 w-full min-w-0">
        <ol className="space-y-3">
          {COMPARE_STEPS.map((step, index) => {
            const done = currentIndex > index || progress.status === 'COMPLETED';
            const active = currentIndex === index && progress.status === 'PROCESSING';
            const failed = progress.status === 'FAILED' && currentIndex === index;
            const label = ui[stepLabelKey(step)];

            return (
              <li key={step} className="flex items-start gap-3 min-w-0">
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
                <div className="min-w-0">
                  <div
                    className={`text-sm break-words ${
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
        <p className="text-sm text-purple-300/90 break-words">
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
        <div className="rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-300 break-words">
          {ui.compareProgressFailed}: {progress.error}
        </div>
      )}
    </div>
  );
};
