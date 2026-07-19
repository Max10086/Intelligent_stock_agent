import React, { useMemo } from 'react';
import type { Language } from '../types.ts';
import type { GainerBadge, MarketGainerEntryDto } from '../types/marketGainers.ts';
import { getUIText } from '../constants.ts';
import { useMarketGainers } from '../hooks/useMarketGainers.ts';

interface GainerLeaderboardPageProps {
  language: Language;
  onAnalyzeStarted?: (batchJobId: string) => void;
}

const badgeClass = (badge: GainerBadge): string => {
  if (badge === 'trending') return 'border-red-700/60 bg-red-950/40 text-red-300';
  if (badge === 'hot') return 'border-orange-700/60 bg-orange-950/40 text-orange-300';
  if (badge === 'recurring') return 'border-amber-700/60 bg-amber-950/40 text-amber-300';
  return 'border-gray-700 bg-gray-900 text-gray-500';
};

const badgeLabel = (badge: GainerBadge, language: Language): string | null => {
  const ui = getUIText(language);
  if (badge === 'trending') return ui.gainerBadgeTrending;
  if (badge === 'hot') return ui.gainerBadgeHot;
  if (badge === 'recurring') return ui.gainerBadgeRecurring;
  return null;
};

const formatPct = (value: number): string => {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
};

const EntryTable: React.FC<{
  language: Language;
  entries: MarketGainerEntryDto[];
  selected: Set<string>;
  onToggle: (ticker: string) => void;
}> = ({ language, entries, selected, onToggle }) => {
  const ui = getUIText(language);

  if (entries.length === 0) {
    return <p className="text-base text-gray-500 py-8 text-center">{ui.gainerEmpty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-base">
        <thead className="text-sm uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-4 py-3">{ui.gainerColSelect}</th>
            <th className="px-4 py-3">{ui.gainerColRank}</th>
            <th className="px-4 py-3">{ui.gainerColCompany}</th>
            <th className="px-4 py-3">{ui.gainerColTicker}</th>
            <th className="px-4 py-3">{ui.gainerColChange}</th>
            <th className="px-4 py-3">{ui.gainerColFrequency}</th>
            <th className="px-4 py-3">{ui.gainerColBlurb}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(entry => {
            const label = badgeLabel(entry.badge, language);
            return (
              <tr key={`${entry.ticker}-${entry.id}`} className="border-t border-gray-800 text-gray-300">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(entry.ticker)}
                    onChange={() => onToggle(entry.ticker)}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-800"
                  />
                </td>
                <td className="px-4 py-3 text-gray-400">{entry.displayRank}</td>
                <td className="px-4 py-3 font-medium text-gray-100">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{entry.name}</span>
                    {label && (
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs ${badgeClass(entry.badge)}`}>
                        {label}
                      </span>
                    )}
                    {entry.autoAnalyzeEligible && (
                      <span className="rounded-full border border-blue-700/60 bg-blue-950/40 px-2.5 py-0.5 text-xs text-blue-300">
                        {ui.gainerAutoEligible}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 font-medium">{entry.ticker}</td>
                <td className="px-4 py-3 text-lg font-semibold text-emerald-300">{formatPct(entry.changePct)}</td>
                <td className="px-4 py-3 text-sm">
                  {entry.dailyAppearances14d}d / {entry.weeklyAppearances14d}w
                  <span className="ml-1 text-gray-500">({entry.appearanceScore})</span>
                </td>
                <td className="px-4 py-3 max-w-md text-gray-300 leading-relaxed">{entry.blurb}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const GainerLeaderboardPage: React.FC<GainerLeaderboardPageProps> = ({
  language,
  onAnalyzeStarted,
}) => {
  const ui = getUIText(language);
  const gainers = useMarketGainers(language, true);
  const entries = gainers.data?.snapshot?.entries ?? [];
  const highAttention = gainers.data?.highAttention ?? [];

  const primaryTabLabel = useMemo(
    () => (gainers.market === 'CN' ? ui.gainerThreeDay : ui.gainerDaily),
    [gainers.market, ui.gainerDaily, ui.gainerThreeDay]
  );

  const handleAnalyze = async (tickers: string[]) => {
    const result = await gainers.analyzeTickers(tickers);
    if (result?.batchJobId) {
      onAnalyzeStarted?.(result.batchJobId);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-6 space-y-6">
      <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-100">{ui.gainerTitle}</h1>
            <p className="mt-1 text-base text-gray-400">{ui.gainerSubtitle}</p>
            {gainers.data?.snapshot && (
              <p className="mt-2 text-sm text-gray-500">
                {ui.gainerSessionDate}:{' '}
                <span className="text-gray-300 font-medium">
                  {gainers.data.snapshot.tradingDateStart
                    ? `${gainers.data.snapshot.tradingDateStart} → ${gainers.data.snapshot.tradingDateEnd}`
                    : gainers.data.snapshot.tradingDateEnd}
                </span>
                {' · '}
                {ui.gainerLastUpdated}: {new Date(gainers.data.snapshot.fetchedAt).toLocaleString()}
                {' · '}
                {gainers.data.snapshot.modelProvider === 'yahoo'
                  ? 'Yahoo top gainers'
                  : gainers.data.snapshot.modelName}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={gainers.fetching}
              onClick={() => void gainers.fetchGainers()}
              className="rounded-md bg-blue-600 px-4 py-2.5 text-base hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              title={ui.gainerFetchHint}
            >
              {gainers.fetching ? ui.gainerFetching : ui.gainerFetch}
            </button>
            <button
              type="button"
              disabled={gainers.fetching}
              onClick={() => void gainers.fetchGainers({ fetchAll: true })}
              className="rounded-md bg-indigo-700 px-4 py-2.5 text-base hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
              title={ui.gainerFetchHint}
            >
              {ui.gainerFetchAll}
            </button>
            <button
              type="button"
              disabled={gainers.loading || gainers.fetching}
              onClick={() => void gainers.load()}
              className="rounded-md bg-gray-700 px-4 py-2.5 text-base hover:bg-gray-600 disabled:opacity-50"
            >
              {ui.gainerRefresh}
            </button>
          </div>
        </div>
        {gainers.fetchMessage && (
          <p className="mt-3 text-base text-emerald-300">{gainers.fetchMessage}</p>
        )}
        <label className="mt-3 flex items-center gap-2 text-base text-gray-400">
          <input
            type="checkbox"
            checked={gainers.validateQuotes}
            onChange={event => gainers.setValidateQuotes(event.target.checked)}
            className="rounded border-gray-600 bg-gray-800"
          />
          <span>{ui.gainerValidateQuotes}</span>
        </label>
        <p className="mt-2 text-sm text-gray-500">{ui.gainerFetchHint}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {(['US', 'CN'] as const).map(option => (
            <button
              key={option}
              type="button"
              onClick={() => gainers.setMarket(option)}
              className={`rounded-md px-4 py-2 text-base ${
                gainers.market === option
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:text-white'
              }`}
            >
              {option === 'US' ? ui.gainerMarketUs : ui.gainerMarketCn}
            </button>
          ))}
          <button
            type="button"
            disabled
            className="rounded-md px-4 py-2 text-base bg-gray-900 text-gray-600 cursor-not-allowed"
            title={ui.gainerMarketHkSoon}
          >
            {ui.gainerMarketHk}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => gainers.setPeriodTab('primary')}
            className={`rounded-md px-4 py-2 text-base ${
              gainers.periodTab === 'primary'
                ? 'bg-emerald-700 text-white'
                : 'bg-gray-800 text-gray-300 hover:text-white'
            }`}
          >
            {primaryTabLabel}
          </button>
          <button
            type="button"
            onClick={() => gainers.setPeriodTab('weekly')}
            className={`rounded-md px-4 py-2 text-base ${
              gainers.periodTab === 'weekly'
                ? 'bg-emerald-700 text-white'
                : 'bg-gray-800 text-gray-300 hover:text-white'
            }`}
          >
            {ui.gainerWeekly}
          </button>
        </div>

        <div className="mt-5 border-t border-gray-800 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-medium text-gray-200">{ui.gainerHistoryTitle}</h2>
            {gainers.selectedTradingDateEnd && (
              <span className="rounded-full border border-amber-700/50 bg-amber-950/30 px-3 py-1 text-sm text-amber-200">
                {ui.gainerViewingHistorical}
              </span>
            )}
          </div>

          {gainers.history.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">{ui.gainerHistoryEmpty}</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="text-sm text-gray-400" htmlFor="gainer-history-select">
                  {ui.gainerSessionDate}
                </label>
                <select
                  id="gainer-history-select"
                  value={gainers.selectedTradingDateEnd ?? ''}
                  onChange={event => {
                    const value = event.target.value;
                    gainers.setSelectedTradingDateEnd(value || null);
                  }}
                  className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-base text-gray-100"
                >
                  <option value="">{ui.gainerLatestSnapshot}</option>
                  {gainers.history.map(item => (
                    <option key={item.id} value={item.tradingDateEnd}>
                      {item.tradingDateStart
                        ? `${item.tradingDateStart} → ${item.tradingDateEnd}`
                        : item.tradingDateEnd}
                      {` (${ui.gainerHistoryEntries.replace('{count}', String(item.entryCount))})`}
                    </option>
                  ))}
                </select>
                {gainers.selectedTradingDateEnd && (
                  <button
                    type="button"
                    onClick={() => gainers.loadLatest()}
                    className="rounded-md bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
                  >
                    {ui.gainerLatestSnapshot}
                  </button>
                )}
              </div>

              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => gainers.loadLatest()}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
                    !gainers.selectedTradingDateEnd
                      ? 'border-blue-500 bg-blue-600/20 text-blue-100'
                      : 'border-gray-700 bg-gray-800 text-gray-300 hover:text-white'
                  }`}
                >
                  {ui.gainerLatestSnapshot}
                </button>
                {gainers.history.map(item => {
                  const label = item.tradingDateStart
                    ? `${item.tradingDateStart} → ${item.tradingDateEnd}`
                    : item.tradingDateEnd;
                  const isActive = gainers.selectedTradingDateEnd === item.tradingDateEnd;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => gainers.setSelectedTradingDateEnd(item.tradingDateEnd)}
                      className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${
                        isActive
                          ? 'border-blue-500 bg-blue-600/20 text-blue-100'
                          : 'border-gray-700 bg-gray-800 text-gray-300 hover:text-white'
                      }`}
                      title={new Date(item.fetchedAt).toLocaleString()}
                    >
                      {label}
                      <span className="ml-1 text-gray-500">({item.entryCount})</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {gainers.error && (
        <div className="rounded-lg border border-red-700/50 bg-red-950/30 px-4 py-3 text-base text-red-200">
          {gainers.error}
        </div>
      )}

      {highAttention.length > 0 && (
        <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 p-4">
          <h2 className="text-base font-medium text-amber-200 mb-3">{ui.gainerHighAttention}</h2>
          <div className="flex flex-wrap gap-2">
            {highAttention.map(entry => (
              <button
                key={`hot-${entry.ticker}`}
                type="button"
                onClick={() => gainers.toggleSelected(entry.ticker)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  gainers.selected.has(entry.ticker)
                    ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                    : 'border-amber-700/50 bg-gray-900/60 text-amber-200'
                }`}
              >
                {entry.name} ({entry.ticker}) · {entry.appearanceScore}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => gainers.selectAll(entries)}
            className="rounded-md bg-gray-700 px-4 py-2.5 text-base hover:bg-gray-600"
          >
            {ui.gainerSelectAll}
          </button>
          <button
            type="button"
            disabled={gainers.submitting || gainers.selected.size === 0}
            onClick={() => void handleAnalyze(Array.from(gainers.selected))}
            className="rounded-md bg-blue-600 px-4 py-2.5 text-base hover:bg-blue-500 disabled:opacity-50"
          >
            {gainers.submitting
              ? ui.gainerAnalyzing
              : ui.gainerAnalyzeSelected.replace('{count}', String(gainers.selected.size))}
          </button>
          <button
            type="button"
            disabled={gainers.submitting || entries.length === 0}
            onClick={() => void handleAnalyze(entries.map(entry => entry.ticker))}
            className="rounded-md bg-emerald-700 px-4 py-2.5 text-base hover:bg-emerald-600 disabled:opacity-50"
          >
            {ui.gainerAnalyzeAll}
          </button>
        </div>

        {gainers.loading && !gainers.data ? (
          <p className="text-base text-gray-400 py-8 text-center">{ui.gainerLoading}</p>
        ) : (
          <EntryTable
            language={language}
            entries={entries}
            selected={gainers.selected}
            onToggle={gainers.toggleSelected}
          />
        )}
      </div>

      <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
        <h2 className="text-base font-medium text-gray-200 mb-3">{ui.gainerAutoSettingsTitle}</h2>
        <p className="text-sm text-gray-500 mb-4">{ui.gainerAutoSettingsHint}</p>
        <label className="flex items-center gap-2 text-base text-gray-300">
          <input
            type="checkbox"
            checked={gainers.preferences?.autoAnalyzeEnabled ?? false}
            disabled={gainers.savingPrefs}
            onChange={event =>
              void gainers.savePreferences({ autoAnalyzeEnabled: event.target.checked })
            }
            className="rounded border-gray-600 bg-gray-800"
          />
          {ui.gainerAutoAnalyzeEnabled}
        </label>
        <p className="mt-3 text-sm text-gray-500">{ui.gainerAutoAnalyzeRule}</p>
      </div>
    </div>
  );
};
