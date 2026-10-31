import React, { useRef } from 'react';
import type { Language } from '../../types.ts';
import type { ThirteenFWatchlistItem } from '../../types/thirteenF.ts';
import { useThirteenFTracker } from '../../hooks/useThirteenFTracker.ts';
import { getUIText } from '../../constants.ts';
import { InstitutionDetailPanel } from './InstitutionDetailPanel.tsx';
import { AggregateDashboardPanel } from './AggregateDashboardPanel.tsx';
import { PerformanceTrackingPanel } from './PerformanceTrackingPanel.tsx';
import { ImportantTrackingPanel } from './ImportantTrackingPanel.tsx';
import { InstitutionSearchDropdown } from './InstitutionSearchDropdown.tsx';
import {
  isWatchlistItemSelected,
  WatchlistInstitutionRow,
} from './WatchlistInstitutionRow.tsx';

interface ThirteenFTrackerPageProps {
  language: Language;
  enabled: boolean;
}

const renderInstitutionRow = (
  item: ThirteenFWatchlistItem,
  tracker: ReturnType<typeof useThirteenFTracker>,
  ui: ReturnType<typeof getUIText>
) => (
  <WatchlistInstitutionRow
    key={item.cik}
    name={item.name}
    selected={isWatchlistItemSelected(tracker.selectedCik, item.cik)}
    starred={tracker.isInstitutionStarred(item.cik)}
    starLabel={ui.thirteenFStarInstitution}
    unstarLabel={ui.thirteenFUnstarInstitution}
    removeLabel={`${ui.thirteenFRemoveInstitution}: ${item.name}`}
    onSelect={() => {
      tracker.selectCik(item.cik);
      tracker.setActivePanel('institution');
    }}
    onToggleStar={() => tracker.toggleStarInstitution(item.cik)}
    onRemove={() => tracker.removeInstitution(item.cik)}
  />
);

export const ThirteenFTrackerPage: React.FC<ThirteenFTrackerPageProps> = ({
  language,
  enabled,
}) => {
  const ui = getUIText(language);
  const tracker = useThirteenFTracker(language, enabled);
  const watchlistCiks = new Set(tracker.watchlist.map(item => item.cik));
  const searchInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="max-w-screen-2xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-100">{ui.thirteenFTitle}</h1>
        <p className="mt-1 text-base text-gray-400">{ui.thirteenFSubtitle}</p>
      </div>

      {tracker.error && (
        <div className="mb-4 rounded-lg border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-300">
          {tracker.error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex h-fit flex-col rounded-lg border border-gray-800 bg-gray-900/60 p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-1.5rem)] lg:self-start">
          <div className="shrink-0">
            <h2 className="text-sm font-medium text-gray-300 mb-2">{ui.thirteenFWatchlist}</h2>
            <input
              ref={searchInputRef}
              type="text"
              value={tracker.institutionSearchQuery}
              onChange={event => tracker.setInstitutionSearchQuery(event.target.value)}
              placeholder={ui.thirteenFSearchPlaceholder}
              className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
              aria-autocomplete="list"
              aria-controls="institution-search-results"
            />
            <p className="mt-2 text-xs text-gray-500">{ui.thirteenFSearchHint}</p>

            <InstitutionSearchDropdown
              query={tracker.institutionSearchQuery}
              results={tracker.institutionSearchResults}
              loading={tracker.institutionSearchLoading}
              watchlistCiks={watchlistCiks}
              inputRef={searchInputRef}
              labels={{
                loading: ui.thirteenFLoading,
                empty: ui.thirteenFSearchNoResults,
                inWatchlist: ui.thirteenFSearchInWatchlist,
                add: ui.thirteenFSearchAdd,
                formerly: ui.thirteenFInstitutionFormerly,
              }}
              onSelect={tracker.selectInstitution}
            />
          </div>

          <div className="mt-4 shrink-0 rounded-md border border-amber-900/40 bg-amber-950/20 px-2 py-2">
            <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-amber-400/90">
              {ui.thirteenFFeaturedInstitutions}
            </h3>
            {tracker.featuredInstitutions.length === 0 ? (
              <p className="px-1 py-2 text-xs text-gray-500">{ui.thirteenFFeaturedEmpty}</p>
            ) : (
              <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pr-1">
                {tracker.featuredInstitutions.map(item => renderInstitutionRow(item, tracker, ui))}
              </div>
            )}
          </div>

          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <h3 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-gray-500">
              {ui.thirteenFAllWatchlist}
            </h3>
            <div className="min-h-[10rem] max-h-[min(45vh,24rem)] space-y-0.5 overflow-y-auto pr-1 lg:min-h-0 lg:max-h-none lg:flex-1">
              {tracker.watchlist.length === 0 ? (
                <p className="px-1 py-2 text-sm text-gray-500">{ui.thirteenFEmpty}</p>
              ) : (
                tracker.watchlist.map(item => renderInstitutionRow(item, tracker, ui))
              )}
            </div>
          </div>
        </aside>

        <div>
          <div className="mb-4 flex flex-wrap gap-2">
            {(
              [
                ['institution', ui.thirteenFPanelInstitution],
                ['important', ui.thirteenFPanelImportant],
                ['aggregate', ui.thirteenFPanelAggregate],
                ['performance', ui.thirteenFPanelPerformance],
              ] as const
            ).map(([panel, label]) => (
              <button
                key={panel}
                type="button"
                onClick={() => tracker.setActivePanel(panel)}
                className={`rounded-md px-4 py-2 text-sm ${
                  tracker.activePanel === panel
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tracker.activePanel === 'institution' && (
            <InstitutionDetailPanel language={language} tracker={tracker} />
          )}
          {tracker.activePanel === 'important' && (
            <ImportantTrackingPanel language={language} tracker={tracker} />
          )}
          {tracker.activePanel === 'aggregate' && (
            <AggregateDashboardPanel language={language} tracker={tracker} />
          )}
          {tracker.activePanel === 'performance' && (
            <PerformanceTrackingPanel language={language} tracker={tracker} />
          )}
        </div>
      </div>
    </div>
  );
};
