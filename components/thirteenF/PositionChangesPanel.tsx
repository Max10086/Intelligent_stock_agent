import React from 'react';
import type { Language } from '../../types.ts';
import type {
  ThirteenFPositionChange,
  ThirteenFPositionChangeCategory,
} from '../../types/thirteenF.ts';
import { getUIText } from '../../constants.ts';
import {
  CHANGE_BADGE_CLASS,
  deltaTextClass,
  formatChangesTruncatedHint,
  formatPct,
  formatSharesDelta,
  formatUsdCompact,
  isChangeCountsTruncated,
  sumChangeCounts,
} from '../../utils/thirteenFFormat.ts';

interface PositionChangesPanelProps {
  language: Language;
  changes: ThirteenFPositionChange[];
  counts: Record<ThirteenFPositionChangeCategory, number>;
  totalCounts?: Record<ThirteenFPositionChangeCategory, number>;
  changesLimitPerCategory?: number;
  filter: ThirteenFPositionChangeCategory | 'ALL';
  onFilterChange: (filter: ThirteenFPositionChangeCategory | 'ALL') => void;
  onSelectTicker?: (ticker: string) => void;
  highlightTicker?: string | null;
}

const categoryLabel = (
  category: ThirteenFPositionChangeCategory | 'ALL',
  language: Language
): string => {
  const ui = getUIText(language);
  if (category === 'ALL') return ui.thirteenFChangeAll;
  if (category === 'NEW') return ui.thirteenFChangeNew;
  if (category === 'ADD') return ui.thirteenFChangeAdd;
  if (category === 'REDUCE') return ui.thirteenFChangeReduce;
  return ui.thirteenFChangeClear;
};

export const PositionChangesPanel: React.FC<PositionChangesPanelProps> = ({
  language,
  changes,
  counts,
  totalCounts,
  changesLimitPerCategory,
  filter,
  onFilterChange,
  onSelectTicker,
  highlightTicker,
}) => {
  const ui = getUIText(language);
  const truncated = isChangeCountsTruncated(counts, totalCounts);
  const tabs: Array<ThirteenFPositionChangeCategory | 'ALL'> = [
    'ALL',
    'ADD',
    'REDUCE',
    'NEW',
    'CLEAR',
  ];

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-medium text-gray-100">{ui.thirteenFChangesTitle}</h3>
        <div className="flex flex-wrap gap-2">
          {tabs.map(tab => {
            const count =
              tab === 'ALL'
                ? sumChangeCounts(counts)
                : counts[tab as ThirteenFPositionChangeCategory] ?? 0;
            const active = filter === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => onFilterChange(tab)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  active
                    ? CHANGE_BADGE_CLASS[tab === 'ALL' ? 'ADD' : tab]
                    : 'border-gray-700 bg-gray-800 text-gray-300 hover:text-white'
                }`}
              >
                {categoryLabel(tab, language)} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {truncated && totalCounts && changesLimitPerCategory ? (
        <p className="mt-3 text-xs text-gray-500 leading-relaxed">
          {formatChangesTruncatedHint(
            ui.thirteenFChangesTruncatedHint,
            changesLimitPerCategory,
            totalCounts
          )}
        </p>
      ) : null}

      <p className="mt-3 text-xs text-gray-500">{ui.thirteenFChangesPriceEffectHint}</p>

      {changes.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500 py-6 text-center">{ui.thirteenFChangesEmpty}</p>
      ) : (
        <div className="mt-4 max-h-72 overflow-y-auto space-y-2 pr-1">
          {changes.map(change => (
            <button
              key={change.id}
              type="button"
              onClick={() => onSelectTicker?.(change.ticker)}
              className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                highlightTicker === change.ticker
                  ? 'border-blue-500/60 bg-blue-950/30'
                  : 'border-gray-800 bg-gray-950/40 hover:border-gray-700'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      CHANGE_BADGE_CLASS[change.category]
                    }`}
                  >
                    {categoryLabel(change.category, language)}
                  </span>
                  <span className="font-medium text-gray-100">{change.ticker}</span>
                  <span className="text-sm text-gray-400 truncate">{change.name}</span>
                </div>
                <div className="flex items-center gap-3 text-sm shrink-0">
                  <span className={deltaTextClass(change.sharesDelta)}>
                    {formatSharesDelta(change.sharesDelta)}
                  </span>
                  <span className={deltaTextClass(change.marketValueDeltaUsd)}>
                    {formatUsdCompact(change.marketValueDeltaUsd)}
                  </span>
                  {change.weightDeltaPct !== null && (
                    <span className={deltaTextClass(change.weightDeltaPct)}>
                      {formatPct(change.weightDeltaPct)}
                    </span>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-gray-500">{change.sector}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
