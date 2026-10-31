import React from 'react';
import type { Language } from '../../types.ts';
import type { ThirteenFTrackerState } from '../../hooks/useThirteenFTracker.ts';
import { getUIText } from '../../constants.ts';
import {
  CHANGE_BADGE_CLASS,
  deltaTextClass,
  formatPct,
  formatUsdCompact,
} from '../../utils/thirteenFFormat.ts';

interface PerformanceTrackingPanelProps {
  language: Language;
  tracker: ThirteenFTrackerState;
}

const QuotePlaceholder: React.FC = () => (
  <span className="inline-block h-4 w-12 animate-pulse rounded bg-gray-700/80" aria-hidden="true" />
);

const formatPerformancePrice = (value: number): string => {
  if (value >= 10_000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toFixed(2)}`;
};

const TruncatedNameCell: React.FC<{ name: string }> = ({ name }) => (
  <span className="group/name relative block min-w-0">
    <span className="block truncate text-xs text-gray-400">{name}</span>
    <span
      role="tooltip"
      className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden max-w-xs rounded border border-gray-700 bg-gray-950 px-2 py-1 text-xs leading-snug text-gray-100 shadow-lg group-hover/name:block"
    >
      {name}
    </span>
  </span>
);

const formatPriceCell = (
  value: number | null | undefined,
  enriching: boolean
): React.ReactNode => {
  if (value != null) return formatPerformancePrice(value);
  if (enriching) return <QuotePlaceholder />;
  return '—';
};

const formatReturnCell = (
  value: number | null | undefined,
  enriching: boolean
): React.ReactNode => {
  if (value != null) {
    return (
      <span className={`font-medium ${deltaTextClass(value)}`}>{formatPct(value)}</span>
    );
  }
  if (enriching) return <QuotePlaceholder />;
  return '—';
};

export const PerformanceTrackingPanel: React.FC<PerformanceTrackingPanelProps> = ({
  language,
  tracker,
}) => {
  const ui = getUIText(language);
  const {
    institutionOptions,
    performanceCik,
    selectPerformanceCik,
    performance,
    performanceLoading,
    performanceEnriching,
    performanceQuoteProgress,
    performanceCacheFetchedAt,
    performanceSortMode,
    setPerformanceSortMode,
    refreshPerformance,
  } = tracker;

  const enriching = performanceEnriching;
  const showTable = Boolean(performance && performance.entries.length > 0);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">{ui.thirteenFPerformanceTitle}</h2>
            <p className="mt-1 text-sm text-gray-400">{ui.thirteenFPerformanceHint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPerformanceSortMode('by_position_delta')}
              className={`rounded-md px-3 py-1.5 text-sm ${
                performanceSortMode === 'by_position_delta'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300'
              }`}
            >
              {ui.thirteenFSortByDelta}
            </button>
            <button
              type="button"
              onClick={() => setPerformanceSortMode('by_return_pct')}
              disabled={enriching}
              className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-50 ${
                performanceSortMode === 'by_return_pct'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300'
              }`}
            >
              {ui.thirteenFSortByReturn}
            </button>
            <button
              type="button"
              disabled={!performanceCik || performanceLoading || enriching}
              onClick={() => void refreshPerformance()}
              className="rounded-md bg-indigo-700 px-4 py-2 text-sm hover:bg-indigo-600 disabled:opacity-50"
            >
              {performanceLoading || enriching ? ui.thirteenFLoading : ui.thirteenFRefreshPerformance}
            </button>
          </div>
          {performanceCacheFetchedAt ? (
            <p className="mt-2 text-xs text-gray-500">
              {ui.thirteenFCacheFetchedAt.replace(
                '{time}',
                new Date(performanceCacheFetchedAt).toLocaleString(
                  language === 'cn' ? 'zh-CN' : 'en-US'
                )
              )}
            </p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {institutionOptions.map(inst => {
            const selected = performanceCik === inst.cik;
            return (
              <button
                key={inst.cik}
                type="button"
                onClick={() => selectPerformanceCik(inst.cik)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  selected
                    ? 'border-indigo-500 bg-indigo-600/20 text-indigo-100'
                    : 'border-gray-700 bg-gray-800 text-gray-300 hover:text-white'
                }`}
              >
                {inst.shortName ?? inst.name}
              </button>
            );
          })}
        </div>
      </section>

      {!performanceCik ? (
        <p className="py-10 text-center text-sm text-gray-500">{ui.thirteenFAggregateEmpty}</p>
      ) : performanceLoading && !performance ? (
        <p className="py-10 text-center text-sm text-gray-400">{ui.thirteenFLoading}</p>
      ) : !showTable ? (
        <p className="py-10 text-center text-sm text-gray-500">{ui.thirteenFPerformanceEmpty}</p>
      ) : (
        <>
          {performanceQuoteProgress ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span>
                {ui.thirteenFPerformanceEnriching
                  .replace('{loaded}', String(performanceQuoteProgress.loaded))
                  .replace('{total}', String(performanceQuoteProgress.total))}
              </span>
              <span className="h-1.5 min-w-[8rem] flex-1 max-w-xs overflow-hidden rounded-full bg-gray-800">
                <span
                  className="block h-full rounded-full bg-indigo-500 transition-all duration-300"
                  style={{
                    width: `${Math.round(
                      (performanceQuoteProgress.loaded / performanceQuoteProgress.total) * 100
                    )}%`,
                  }}
                />
              </span>
            </div>
          ) : null}
          {performance?.scope ? (
            <p className="mb-3 text-xs text-gray-500">
              {ui.thirteenFPerformanceScope
                .replace('{tickers}', String(performance.scope.buySideTickers))
                .replace('{newCount}', String(performance.scope.newCount))
                .replace('{addCount}', String(performance.scope.addCount))}
            </p>
          ) : null}
          {performance?.excludedInstitutions && performance.excludedInstitutions.length > 0 ? (
            <p className="mb-3 text-xs text-amber-400/90">
              {ui.thirteenFPerformanceExcluded
                .replace('{quarter}', performance.quarter)
                .replace(
                  '{names}',
                  performance.excludedInstitutions.map(item => item.name).join(' · ')
                )}
            </p>
          ) : null}
          <div className="rounded-lg border border-gray-800 bg-gray-900/60">
            <table className="w-full table-fixed text-left text-xs">
              <colgroup>
                <col style={{ width: '8%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '5%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '7%' }} />
                <col style={{ width: '7.5%' }} />
                <col style={{ width: '7.5%' }} />
                <col style={{ width: '7.5%' }} />
                <col style={{ width: '11.5%' }} />
                <col style={{ width: '11.5%' }} />
              </colgroup>
              <thead className="border-b border-gray-800 text-[10px] uppercase leading-tight tracking-wide text-gray-500">
                <tr>
                  <th className="px-1.5 py-2">{ui.thirteenFColTicker}</th>
                  <th className="px-1.5 py-2">{ui.thirteenFColName}</th>
                  <th className="px-1.5 py-2">{ui.thirteenFColCategory}</th>
                  <th className="px-1.5 py-2">{ui.thirteenFColValueDelta}</th>
                  <th className="px-1.5 py-2">{ui.thirteenFColAnchorDate}</th>
                  <th className="px-1.5 py-2">{ui.thirteenFColAnchorPrice}</th>
                  <th className="px-1.5 py-2">{ui.thirteenFColReportPrice}</th>
                  <th className="px-1.5 py-2">{ui.thirteenFColCurrentPrice}</th>
                  <th className="px-1.5 py-2">{ui.thirteenFColReportReturn}</th>
                  <th className="whitespace-nowrap px-1.5 py-2">{ui.thirteenFColReturn}</th>
                </tr>
              </thead>
              <tbody>
                {performance?.entries.map(entry => (
                  <tr key={entry.ticker} className="border-t border-gray-800 text-gray-300">
                    <td className="whitespace-nowrap px-1.5 py-2 font-medium text-gray-100">
                      {entry.ticker}
                    </td>
                    <td className="px-1.5 py-2">
                      <TruncatedNameCell name={entry.name} />
                    </td>
                    <td className="px-1.5 py-2">
                      <span
                        className={`inline-flex whitespace-nowrap rounded-full border px-1.5 py-0.5 text-[10px] ${
                          CHANGE_BADGE_CLASS[entry.category === 'NEW' ? 'NEW' : 'ADD']
                        }`}
                      >
                        {entry.category === 'NEW' ? ui.thirteenFChangeNew : ui.thirteenFChangeAdd}
                      </span>
                    </td>
                    <td
                      className={`whitespace-nowrap px-1.5 py-2 tabular-nums ${deltaTextClass(
                        entry.totalMarketValueDeltaUsd
                      )}`}
                    >
                      {formatUsdCompact(entry.totalMarketValueDeltaUsd)}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 text-[11px] tabular-nums text-gray-400">
                      {entry.anchorDate}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 tabular-nums">
                      {entry.anchorPriceUsd != null ? (
                        <>
                          {formatPerformancePrice(entry.anchorPriceUsd)}
                          {entry.quoteStatus === 'estimated' ? (
                            <span
                              className="ml-0.5 text-amber-400/90"
                              title={ui.thirteenFColAnchorPriceEstimated}
                            >
                              *
                            </span>
                          ) : null}
                        </>
                      ) : (
                        formatPriceCell(entry.anchorPriceUsd, enriching)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 tabular-nums">
                      {formatPriceCell(entry.reportPriceUsd, enriching)}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 tabular-nums">
                      {formatPriceCell(entry.currentPriceUsd, enriching)}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 tabular-nums">
                      {formatReturnCell(entry.reportReturnPct, enriching)}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 tabular-nums">
                      {formatReturnCell(entry.returnPct, enriching)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
