import React, { Suspense, useState } from 'react';
import type { Language } from '../../types.ts';
import type { ThirteenFTrackerState } from '../../hooks/useThirteenFTracker.ts';
import { getUIText } from '../../constants.ts';
import { formatUsdCompact } from '../../utils/thirteenFFormat.ts';
import {
  normalizeInstitutionCik,
  resolveInstitutionCik,
} from '../../utils/thirteenFInstitutionSearch.ts';
import { QuarterSelector } from './QuarterSelector.tsx';
import { PositionChangesPanel } from './PositionChangesPanel.tsx';
import { HoldingsTable } from './HoldingsTable.tsx';
import { ArrowPathIcon } from '../icons.tsx';

const SectorDonutChart = React.lazy(() =>
  import('./charts/SectorDonutChart.tsx').then(module => ({ default: module.SectorDonutChart }))
);
const StockTreemapChart = React.lazy(() =>
  import('./charts/StockTreemapChart.tsx').then(module => ({ default: module.StockTreemapChart }))
);

interface InstitutionDetailPanelProps {
  language: Language;
  tracker: ThirteenFTrackerState;
}

const InfoTooltipIcon: React.FC<{
  message: string;
  detail?: string | null;
  hoverClass?: string;
  ringClass?: string;
}> = ({
  message,
  detail,
  hoverClass = 'hover:text-gray-300',
  ringClass = 'focus-visible:ring-gray-500/40',
}) => (
  <span className="group relative inline-flex shrink-0">
    <button
      type="button"
      className={`rounded-full p-0.5 text-gray-500 transition-colors focus:outline-none focus-visible:ring-2 ${hoverClass} ${ringClass}`}
      aria-label={detail ? `${message} ${detail}` : message}
      title={detail ? `${message} ${detail}` : message}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
    </button>
    <span
      role="tooltip"
      className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-max max-w-sm -translate-x-1/2 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-xs leading-relaxed text-gray-300 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      <span>{message}</span>
      {detail ? <span className="mt-1 block text-gray-400">{detail}</span> : null}
    </span>
  </span>
);

export const InstitutionDetailPanel: React.FC<InstitutionDetailPanelProps> = ({
  language,
  tracker,
}) => {
  const ui = getUIText(language);
  const [chartMode, setChartMode] = useState<'sector' | 'stock'>('sector');
  const {
    holdings,
    changes,
    filteredChanges,
    changeFilter,
    setChangeFilter,
    highlightTicker,
    setHighlightTicker,
    holdingsSort,
    setHoldingsSort,
    selectedCik,
    selectedQuarter,
    setSelectedQuarter,
    loading,
    refreshing,
    refreshInstitution,
  } = tracker;

  const resolvedSelectedCik = resolveInstitutionCik(selectedCik);
  const activeQuarter = selectedQuarter ?? holdings?.summary.quarter ?? null;
  const dataMatchesSelection = Boolean(
    holdings &&
      changes &&
      normalizeInstitutionCik(holdings.summary.cik) === normalizeInstitutionCik(resolvedSelectedCik) &&
      normalizeInstitutionCik(changes.cik) === normalizeInstitutionCik(resolvedSelectedCik) &&
      (!activeQuarter || holdings.summary.quarter === activeQuarter) &&
      (!activeQuarter || changes.quarter === activeQuarter)
  );

  const sectorEnriching = tracker.sectorEnrichment?.status === 'running';
  const holdingsSource = holdings?.summary.holdingsSource;
  const formerName = holdings?.summary.formerNames?.[0];
  const renameNotice =
    formerName && holdings?.summary.institutionName
      ? ui.thirteenFInstitutionRenamed
          .replace('{current}', holdings.summary.institutionName)
          .replace('{former}', formerName)
          .replace('{cik}', holdings.summary.cik)
      : null;
  const noticeRedirectMessage =
    holdingsSource?.type === '13F-NT-redirect'
      ? ui.thirteenFHrNoticeRedirect
          .replace('{source}', holdingsSource.sourceInstitutionName)
          .replace('{cik}', holdingsSource.sourceCik)
      : null;

  const handleSortChange = (field: typeof holdingsSort.field) => {
    setHoldingsSort(prev =>
      prev.field === field
        ? { field, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { field, dir: 'desc' }
    );
  };

  if (loading || !dataMatchesSelection) {
    return <p className="text-base text-gray-400 py-12 text-center">{ui.thirteenFLoading}</p>;
  }

  if (!holdings || !changes) {
    return <p className="text-base text-gray-500 py-12 text-center">{ui.thirteenFEmpty}</p>;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-100">
              <span>{holdings.summary.institutionName}</span>
              {renameNotice ? (
                <InfoTooltipIcon
                  message={renameNotice}
                  hoverClass="hover:text-amber-300/90"
                  ringClass="focus-visible:ring-amber-500/40"
                />
              ) : null}
              {noticeRedirectMessage ? (
                <InfoTooltipIcon
                  message={noticeRedirectMessage}
                  detail={holdingsSource?.additionalInformation}
                  hoverClass="hover:text-sky-300/90"
                  ringClass="focus-visible:ring-sky-500/40"
                />
              ) : null}
            </h2>
            {holdings.summary.description && (
              <p className="mt-2 max-w-3xl text-sm text-gray-400">{holdings.summary.description}</p>
            )}
            <p className="mt-3 text-sm text-gray-500">
              {ui.thirteenFTotalAum}:{' '}
              <span className="text-gray-200 font-medium">
                {formatUsdCompact(holdings.summary.totalMarketValueUsd)}
              </span>
              {' · '}
              {holdings.summary.holdingCount} {ui.thirteenFPositions}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <QuarterSelector
                language={language}
                quarters={holdings.availableQuarters}
                value={selectedQuarter}
                onChange={setSelectedQuarter}
              />
              <button
                type="button"
                onClick={() => refreshInstitution()}
                disabled={loading || refreshing}
                title={ui.thirteenFRefreshFromSec}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 transition-colors hover:border-gray-600 hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowPathIcon
                  className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />
                {ui.thirteenFRefreshFromSec}
              </button>
            </div>
            {holdings.cacheFetchedAt ? (
              <p className="text-xs text-gray-500">
                {ui.thirteenFCacheFetchedAt.replace(
                  '{time}',
                  new Date(holdings.cacheFetchedAt).toLocaleString(
                    language === 'zh' ? 'zh-CN' : 'en-US'
                  )
                )}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-base font-medium text-gray-100">{ui.thirteenFSectorDistribution}</h3>
            {sectorEnriching && (
              <p className="mt-1 text-xs text-amber-400/90">{ui.thirteenFSectorEnriching}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setChartMode('sector')}
              className={`rounded-md px-3 py-1.5 text-sm ${
                chartMode === 'sector'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:text-white'
              }`}
            >
              {ui.thirteenFBySector}
            </button>
            <button
              type="button"
              onClick={() => setChartMode('stock')}
              className={`rounded-md px-3 py-1.5 text-sm ${
                chartMode === 'stock'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:text-white'
              }`}
            >
              {ui.thirteenFByStock}
            </button>
          </div>
        </div>
        <Suspense fallback={<p className="text-sm text-gray-500 py-10 text-center">{ui.thirteenFLoadingChart}</p>}>
          {chartMode === 'sector' ? (
            <SectorDonutChart slices={holdings.distribution.bySector} title="Sector" />
          ) : (
            <StockTreemapChart slices={holdings.distribution.byStock} />
          )}
        </Suspense>
      </section>

      <PositionChangesPanel
        language={language}
        changes={filteredChanges}
        counts={changes.counts}
        totalCounts={changes.totalCounts}
        changesLimitPerCategory={changes.changesLimitPerCategory}
        filter={changeFilter}
        onFilterChange={setChangeFilter}
        highlightTicker={highlightTicker}
        onSelectTicker={setHighlightTicker}
      />

      <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <h3 className="text-base font-medium text-gray-100 mb-4">{ui.thirteenFHoldingsTitle}</h3>
        <HoldingsTable
          language={language}
          holdings={holdings.holdings}
          totalMarketValueUsd={holdings.summary.totalMarketValueUsd}
          sort={holdingsSort}
          onSortChange={handleSortChange}
          highlightTicker={highlightTicker}
        />
      </section>
    </div>
  );
};
