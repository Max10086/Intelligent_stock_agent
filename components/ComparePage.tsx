import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { AnalysisState, Language } from '../types.ts';
import type { CompareRunResult } from '../types/compare.ts';
import { getUIText } from '../constants.ts';
import type { CompanyCompareController } from '../hooks/useCompanyCompare.ts';
import { useReturnTracking } from '../hooks/useReturnTracking.ts';
import { listEligibleCompareCompanies, type EligibleCompareCompany } from '../utils/compareEligible.ts';
import { COMPARE_WEIGHTS } from '../utils/compareScoring.ts';
import { formatDisplayPrice } from '../utils/priceFormat.ts';
import { ReturnTrackingPanel } from './ReturnTrackingPanel.tsx';
import { CompareProgressPanel } from './CompareProgressPanel.tsx';

interface ComparePageProps {
  language: Language;
  history: AnalysisState[];
  onLoadReport: (reportId: string) => void;
  compare: CompanyCompareController;
  onCompareSaved?: () => void;
  onOpenHistorySidebar?: () => void;
}

const dimensionLabels = (lang: Language) =>
  lang === 'cn'
    ? {
        conviction: 'D1 胜率/把握',
        upside: 'D2 盈利空间',
        downsideProtection: 'D3 错判保护',
        marketThemeFit: 'D4 热点相关度',
        composite: '综合分',
      }
    : {
        conviction: 'D1 Conviction',
        upside: 'D2 Upside',
        downsideProtection: 'D3 Downside protection',
        marketThemeFit: 'D4 Theme fit',
        composite: 'Composite',
      };

const ScoreBar: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="space-y-1">
    <div className="flex justify-between text-xs text-gray-400">
      <span>{label}</span>
      <span>{value}</span>
    </div>
    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  </div>
);

const CompareResultsPanel: React.FC<{
  run: CompareRunResult;
  language: Language;
  onFollowUp?: (refreshReports: boolean) => void;
  isRunning?: boolean;
  onOpenHistorySidebar?: () => void;
}> = ({ run, language, onFollowUp, isRunning, onOpenHistorySidebar }) => {
  const ui = getUIText(language);
  const labels = dimensionLabels(language);
  const { openAndTrack, getCompanyResult, isRefreshing } = useReturnTracking();
  const itemById = useMemo(
    () => new Map(run.items.map(item => [`${item.reportId}::${item.companyId}`, item])),
    [run.items]
  );
  const digestsById = useMemo(
    () => new Map((run.digests || []).map(digest => [digest.itemId, digest])),
    [run.digests]
  );

  useEffect(() => {
    const companies = run.rankings
      .map(entry => {
        const item = itemById.get(entry.itemId);
        const digest = digestsById.get(entry.itemId);
        const anchorPrice = digest?.profileSnapshot?.price || '';
        if (!anchorPrice) return null;
        return {
          companyKey: entry.itemId,
          ticker: item?.ticker || digest?.ticker || '',
          exchange: item?.exchange || digest?.exchange || '',
          name: item?.name || digest?.name,
          anchorPrice,
          anchorDate: run.createdAt,
        };
      })
      .filter((company): company is NonNullable<typeof company> => Boolean(company));

    if (!companies.length) return;

    void openAndTrack({
      sourceType: 'compare_run',
      sourceId: run.runId,
      companies,
    }).catch(error => {
      console.warn('Failed to record compare return tracking:', error);
    });
  }, [run.runId, run.createdAt, run.rankings, digestsById, itemById, openAndTrack]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-100">{ui.compareResultsTitle}</h2>
          <p className="text-sm text-gray-400 mt-1">
            {ui.compareRunAt}: {new Date(run.createdAt).toLocaleString()}
          </p>
        </div>
        {onFollowUp && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onFollowUp(false)}
              className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md"
            >
              {ui.compareFollowUp}
            </button>
            <button
              type="button"
              disabled={isRunning}
              onClick={() => onFollowUp(true)}
              className="px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-md"
            >
              {ui.compareFollowUpRefreshReports}
            </button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-green-500/30 bg-green-950/20 px-4 py-3 text-sm">
        <div className="font-medium text-green-300">{ui.compareSavedToDb}</div>
        <p className="text-gray-400 mt-1">
          {ui.compareSavedHint}
          {onOpenHistorySidebar && (
            <>
              {' '}
              <button
                type="button"
                onClick={onOpenHistorySidebar}
                className="text-purple-300 underline hover:text-purple-200"
              >
                {ui.historyComparisonsTab} →
              </button>
            </>
          )}
        </p>
        <div className="mt-2 font-mono text-xs text-gray-500 space-y-1">
          <div>{ui.compareSessionId}: {run.sessionId}</div>
          <div>{ui.compareRunId}: {run.runId}</div>
        </div>
      </div>

      {run.changeSummary && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-4">
          <h3 className="text-sm font-semibold text-amber-200 mb-2">{ui.compareChangeSummary}</h3>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{run.changeSummary}</p>
        </div>
      )}

      <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">{ui.compareHotTopics}</h3>
        <p className="text-xs text-gray-500 mb-3">
          {ui.compareHotTopicsAt}: {new Date(run.marketHotTopics.fetchedAt).toLocaleString()}
        </p>
        <div className="space-y-3">
          {Object.entries(run.marketHotTopics.markets).map(([market, data]) => (
            <div key={market}>
              <div className="text-xs font-medium text-blue-300 mb-1">{market}</div>
              <div className="flex flex-wrap gap-2">
                {(data?.themes || []).slice(0, 8).map(theme => (
                  <span
                    key={theme.name}
                    className="text-xs px-2 py-1 rounded-full bg-gray-700 text-gray-200"
                    title={theme.brief}
                  >
                    {theme.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        {run.rankings.map(entry => {
          const item = itemById.get(entry.itemId);
          const digest = digestsById.get(entry.itemId);
          const tracking = getCompanyResult(entry.itemId);
          const exchange = item?.exchange || digest?.exchange;
          const fallbackPrice = digest?.profileSnapshot?.price;
          const displayPrice = tracking?.currentPrice || fallbackPrice;
          const displayReturnPct = tracking?.returnPct;
          return (
            <div
              key={entry.itemId}
              className="rounded-lg border border-gray-700 bg-gray-800/80 p-4 space-y-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold text-blue-400">#{entry.rank}</span>
                <span className="text-lg font-semibold">{item?.name || entry.itemId}</span>
                {item && (
                  <span className="text-sm text-gray-400">
                    {item.ticker} · {item.companyRole} · {new Date(item.snapshotAt).toLocaleDateString()}
                  </span>
                )}
                <span className="ml-auto text-sm font-mono text-green-400">
                  {labels.composite}: {entry.compositeScore}
                </span>
              </div>

              {(tracking || fallbackPrice) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md bg-gray-900/50 px-3 py-2">
                    <p className="text-gray-500">{ui.returnTrackingCurrentPrice}</p>
                    <p className="text-base font-semibold text-white mt-1">
                      {formatDisplayPrice(displayPrice, exchange)}
                      {isRefreshing && !tracking?.currentPrice && (
                        <span className="ml-1 text-[10px] text-gray-500 font-normal">
                          {language === 'cn' ? '更新中…' : 'updating…'}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-md bg-gray-900/50 px-3 py-2">
                    <p className="text-gray-500">{ui.returnTrackingReturn}</p>
                    <p
                      className={`text-base font-semibold mt-1 ${
                        displayReturnPct !== null &&
                        displayReturnPct !== undefined &&
                        displayReturnPct >= 0
                          ? 'text-green-400'
                          : displayReturnPct !== null &&
                              displayReturnPct !== undefined
                            ? 'text-red-400'
                            : 'text-gray-300'
                      }`}
                    >
                      {displayReturnPct !== null && displayReturnPct !== undefined
                        ? `${displayReturnPct >= 0 ? '+' : ''}${displayReturnPct.toFixed(1)}%`
                        : isRefreshing
                          ? (language === 'cn' ? '更新中…' : 'updating…')
                          : '—'}
                    </p>
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <ScoreBar label={labels.conviction} value={entry.dimensions.conviction} />
                <ScoreBar label={labels.upside} value={entry.dimensions.upside} />
                <ScoreBar label={labels.downsideProtection} value={entry.dimensions.downsideProtection} />
                <ScoreBar label={labels.marketThemeFit} value={entry.dimensions.marketThemeFit} />
              </div>

              {entry.matchedThemes.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">{ui.compareMatchedThemes}</div>
                  <ul className="text-sm text-gray-300 space-y-1">
                    {entry.matchedThemes.map(theme => (
                      <li key={theme.theme}>
                        <span className="text-blue-300">{theme.theme}</span>
                        <span className="text-gray-500"> ({theme.relevance})</span> — {theme.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {entry.rationale && <p className="text-sm text-gray-300">{entry.rationale}</p>}

              {(tracking || fallbackPrice) && (
                <ReturnTrackingPanel
                  language={language}
                  ticker={item?.ticker || digest?.ticker || entry.itemId}
                  exchange={exchange}
                  anchorPrice={tracking?.anchorPrice || fallbackPrice || ''}
                  anchorDate={tracking?.anchorDate || run.createdAt}
                  currentPrice={displayPrice}
                  returnPct={displayReturnPct}
                  timeline={tracking?.timeline}
                  isLoading={isRefreshing && !tracking}
                />
              )}
            </div>
          );
        })}
      </div>

      {run.portfolioSummary && (
        <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-2">{ui.comparePortfolioSummary}</h3>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{run.portfolioSummary}</p>
        </div>
      )}

      <p className="text-xs text-gray-500">
        {run.methodologyNote ||
          `Weights: ${COMPARE_WEIGHTS.conviction}/${COMPARE_WEIGHTS.upside}/${COMPARE_WEIGHTS.downsideProtection}/${COMPARE_WEIGHTS.marketThemeFit}`}
      </p>
    </div>
  );
};

export const ComparePage: React.FC<ComparePageProps> = ({
  language,
  history,
  onLoadReport,
  compare,
  onCompareSaved,
  onOpenHistorySidebar,
}) => {
  const ui = getUIText(language);
  const {
    basket,
    activeRun,
    isRunning,
    compareProgress,
    error,
    maxCompareItems,
    addToBasket,
    removeFromBasket,
    clearBasket,
    runCompare,
    followUpCompare,
    setActiveRun,
    setError,
    fetchReport,
    cancelComparePolling,
  } = compare;

  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);
  const [expandedCompanies, setExpandedCompanies] = useState<ReturnType<typeof listEligibleCompareCompanies>>([]);
  const [loadingReportId, setLoadingReportId] = useState<string | null>(null);

  const basketKeys = useMemo(
    () => new Set(basket.map(c => `${c.reportId}::${c.companyId}`)),
    [basket]
  );

  const expandReport = useCallback(
    async (reportId: string) => {
      if (expandedReportId === reportId) {
        setExpandedReportId(null);
        setExpandedCompanies([]);
        return;
      }

      // Always load the full report: slim history rows truncate bullets/Q&A and
      // must not be used alone for compare eligibility.
      setLoadingReportId(reportId);
      try {
        const report = await fetchReport(reportId);
        const companies = listEligibleCompareCompanies(report);
        setExpandedReportId(reportId);
        setExpandedCompanies(companies);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load report');
      } finally {
        setLoadingReportId(null);
      }
    },
    [expandedReportId, setError, fetchReport]
  );

  const handleRunCompare = async () => {
    try {
      await runCompare(language);
      onCompareSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compare failed');
    }
  };

  const handleFollowUp = async (refreshReports: boolean) => {
    if (!activeRun) return;
    try {
      await followUpCompare(activeRun.sessionId, activeRun.runId, refreshReports);
      onCompareSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Follow-up failed');
    }
  };

  if (compareProgress || isRunning) {
    return (
      <div className="w-full min-w-0 max-w-5xl mx-auto space-y-4 overflow-x-hidden">
        {!activeRun && (
          <button
            type="button"
            disabled={isRunning}
            onClick={() => {
              if (isRunning) return;
              cancelComparePolling();
            }}
            className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-40"
          >
            ← {ui.compareBackToBasket}
          </button>
        )}
        {activeRun && !isRunning && compareProgress?.status === 'FAILED' && (
          <button
            type="button"
            onClick={() => {
              cancelComparePolling();
            }}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            ← {ui.compareResultsTitle}
          </button>
        )}
        {compareProgress && (
          <CompareProgressPanel
            language={language}
            progress={compareProgress}
            pendingCompanies={basket.length > 0 ? basket : activeRun?.items}
            onOpenHistorySidebar={onOpenHistorySidebar}
          />
        )}
        {error && (
          <div className="rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>
    );
  }

  if (activeRun) {
    return (
      <div className="w-full min-w-0 max-w-5xl mx-auto space-y-4 overflow-x-hidden">
        <button
          type="button"
          onClick={() => setActiveRun(null)}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          ← {ui.compareBackToBasket}
        </button>
        <CompareResultsPanel
          run={activeRun}
          language={language}
          onFollowUp={handleFollowUp}
          isRunning={isRunning}
          onOpenHistorySidebar={onOpenHistorySidebar}
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-100">{ui.compareTitle}</h1>
        <p className="text-sm text-gray-400 mt-1">{ui.compareSubtitle}</p>
        <p className="text-sm text-purple-300/90 mt-2">
          {ui.compareHistoryInSidebar}
          {onOpenHistorySidebar && (
            <>
              {' '}
              <button
                type="button"
                onClick={onOpenHistorySidebar}
                className="underline hover:text-purple-200"
              >
                {ui.historyComparisonsTab} →
              </button>
            </>
          )}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <>
          {basket.length > 0 && (
            <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-4 space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-semibold text-gray-300">{ui.compareSelected}</h2>
                <button type="button" onClick={clearBasket} className="text-xs text-gray-400 hover:text-gray-200">
                  {ui.compareClearBasket}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {basket.map(item => (
                  <span
                    key={`${item.reportId}::${item.companyId}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-700 text-sm"
                  >
                    {item.name} {item.ticker ? `(${item.ticker})` : ''}
                    <button
                      type="button"
                      className="text-gray-400 hover:text-white"
                      onClick={() => removeFromBasket(item.reportId, item.companyId)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                disabled={basket.length < 2 || isRunning}
                onClick={() => void handleRunCompare()}
                className="w-full sm:w-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-sm font-medium"
              >
                {isRunning ? ui.compareRunning : ui.compareStart}
              </button>
            </div>
          )}

          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-300">{ui.comparePickFromHistory}</h2>
            {history.length === 0 && (
              <p className="text-sm text-gray-500">{ui.compareNoHistory}</p>
            )}
            {history.map(report => {
              const focus = report.focusCompany;
              const date = new Date(report.timestamp).toLocaleDateString();
              const isExpanded = expandedReportId === report.id;
              return (
                <div key={report.id} className="rounded-lg border border-gray-700 bg-gray-800/40">
                  <button
                    type="button"
                    onClick={() => void expandReport(report.id)}
                    className="w-full text-left px-4 py-3 flex justify-between items-center hover:bg-gray-800/80"
                  >
                    <span>
                      <span className="font-medium">{focus?.profile.name || report.query}</span>
                      <span className="text-gray-500 text-sm ml-2">{date}</span>
                    </span>
                    <span className="text-xs text-gray-500">
                      {loadingReportId === report.id ? '...' : isExpanded ? '▲' : '▼'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-3 space-y-2 border-t border-gray-700/60">
                      {expandedCompanies.length === 0 && (
                        <p className="text-sm text-gray-500 py-2">{ui.compareNoEligible}</p>
                      )}
                      {expandedCompanies.map(company => {
                        const key = `${company.reportId}::${company.companyId}`;
                        const selected = basketKeys.has(key);
                        return (
                          <label
                            key={key}
                            className="flex items-center gap-3 py-2 px-2 rounded hover:bg-gray-800/60 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={!selected && basket.length >= maxCompareItems}
                              onChange={() => {
                                if (selected) removeFromBasket(company.reportId, company.companyId);
                                else addToBasket(company);
                              }}
                            />
                            <span className="text-sm">
                              {company.name} {company.ticker ? `(${company.ticker})` : ''}
                              <span className="text-gray-500 ml-2">
                                {company.role} · {company.reportLanguage.toUpperCase()}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => onLoadReport(report.id)}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        {ui.compareOpenReport}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      </>
    </div>
  );
};
