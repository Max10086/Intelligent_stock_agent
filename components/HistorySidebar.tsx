
import React, { useEffect, useMemo, useState } from 'react';
import { AnalysisState, Language } from '../types.ts';
import type { ComparisonSessionSummary } from '../types/compare.ts';
import { getUIText } from '../constants.ts';
import { getFollowUpEligibleCompanies } from '../utils/followUpHelpers.ts';
import {
  buildTickerHistoryGroups,
  truncateConclusion,
} from '../utils/analysisTimeline.ts';
import { formatCompareSessionLabel } from '../utils/compareSessionLabel.ts';
import { TrashIcon } from './icons.tsx';

interface HistorySidebarProps {
  isOpen: boolean;
  onClose: () => void;
  history: AnalysisState[];
  isLoading?: boolean;
  isLoadingMore?: boolean;
  historyLoadedCount?: number;
  historyTotalCount?: number | null;
  historyHasMore?: boolean;
  historyError?: string | null;
  onRefreshHistory?: () => void;
  onLoad: (id: string) => void;
  onFollowUpAll: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  currentLanguage: Language;
  activeReportId?: string;
  loadingReportId?: string | null;
  compareSessions?: ComparisonSessionSummary[];
  isLoadingCompareSessions?: boolean;
  compareSessionsError?: string | null;
  activeCompareRunId?: string;
  onRefreshCompareSessions?: () => void;
  onOpenCompareRun: (runId: string) => void;
  onOpenNewCompare: () => void;
  openToComparisons?: boolean;
  onOpenToComparisonsHandled?: () => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  isOpen,
  onClose,
  history,
  isLoading = false,
  isLoadingMore = false,
  historyLoadedCount = 0,
  historyTotalCount = null,
  historyHasMore = false,
  historyError = null,
  onRefreshHistory,
  onLoad,
  onFollowUpAll,
  onDelete,
  onClearAll,
  currentLanguage,
  activeReportId,
  loadingReportId = null,
  compareSessions = [],
  isLoadingCompareSessions = false,
  compareSessionsError = null,
  activeCompareRunId,
  onRefreshCompareSessions,
  onOpenCompareRun,
  onOpenNewCompare,
  openToComparisons = false,
  onOpenToComparisonsHandled,
}) => {
  const uiText = getUIText(currentLanguage);
  const [sidebarTab, setSidebarTab] = useState<'reports' | 'comparisons'>('reports');
  const [viewMode, setViewMode] = useState<'grouped' | 'flat'>('flat');
  const [expandedTickers, setExpandedTickers] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (isOpen && openToComparisons) {
      setSidebarTab('comparisons');
      onOpenToComparisonsHandled?.();
    }
  }, [isOpen, openToComparisons, onOpenToComparisonsHandled]);

  const tickerGroups = useMemo(
    () => buildTickerHistoryGroups(history, currentLanguage),
    [history, currentLanguage]
  );

  const reportCountLabel = useMemo(() => {
    const loaded = historyLoadedCount || history.length;
    const total = historyTotalCount ?? loaded;
    return uiText.historyReportCount
      .replace('{loaded}', String(loaded))
      .replace('{total}', String(total));
  }, [history.length, historyLoadedCount, historyTotalCount, uiText.historyReportCount]);

  useEffect(() => {
    if (viewMode !== 'grouped' || tickerGroups.length === 0) return;
    setExpandedTickers(prev => {
      const next = { ...prev };
      for (const group of tickerGroups) {
        if (next[group.ticker] === undefined) {
          next[group.ticker] = true;
        }
      }
      return next;
    });
  }, [viewMode, tickerGroups]);

  const isExpanded = (ticker: string) => expandedTickers[ticker] ?? false;

  const toggleTicker = (ticker: string) => {
    setExpandedTickers(prev => ({ ...prev, [ticker]: !isExpanded(ticker) }));
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to delete all history? This cannot be undone.')) {
      onClearAll();
    }
  };

  const renderTimelineEntry = (entry: ReturnType<typeof buildTickerHistoryGroups>[0]['entries'][0]) => {
    const { report, reportId, sequenceLabel, company } = entry;
    const canFollowUp = getFollowUpEligibleCompanies(report).length > 0;
    const isActive = activeReportId === reportId;
    const isLoading = loadingReportId === reportId;
    const conclusion = truncateConclusion(company.finalConclusion?.overall_conclusion, 42);

    return (
      <div
        key={`${entry.ticker}-${reportId}`}
        className={`relative pl-5 pb-3 last:pb-0 ${
          isActive ? 'bg-blue-950/20 -mx-2 px-2 rounded-md' : ''
        }`}
      >
        <div className="absolute left-1 top-1.5 h-2 w-2 rounded-full bg-gray-500 ring-2 ring-gray-800" />

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[11px] font-bold ${
                  entry.isFollowUp ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {sequenceLabel}
              </span>
              {isActive && (
                <span className="text-[10px] text-blue-300">{uiText.currentReportMarker}</span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {new Date(report.timestamp).toLocaleString()}
            </p>
            {conclusion && (
              <p className="text-[11px] text-gray-400 mt-1 line-clamp-2">{conclusion}</p>
            )}
          </div>
          <button
            onClick={() => onDelete(reportId)}
            className="p-1 rounded-full text-gray-600 hover:bg-red-500/20 hover:text-red-400 shrink-0"
            aria-label={uiText.deleteReport}
          >
            <TrashIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => onLoad(reportId)}
            disabled={Boolean(loadingReportId)}
            className="flex-1 text-center text-[11px] font-bold py-1 bg-blue-600/80 text-white rounded hover:bg-blue-600 disabled:opacity-60 disabled:cursor-wait"
          >
            {isLoading ? (currentLanguage === 'cn' ? '加载中…' : 'Loading…') : uiText.viewThisReport}
          </button>
          {canFollowUp && (
            <button
              onClick={() => onFollowUpAll(reportId)}
              className="flex-1 text-center text-[11px] font-bold py-1 bg-amber-700/80 text-white rounded hover:bg-amber-600"
            >
              {uiText.followUpAll}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderFlatItem = (item: AnalysisState) => {
    const canFollowUp = getFollowUpEligibleCompanies(item).length > 0;
    const isActive = activeReportId === item.id;
    const isLoading = loadingReportId === item.id;
    const focusName = item.focusCompany?.profile.name || item.query;

    return (
      <div
        key={item.id}
        className={`p-3 border-b border-gray-700/50 hover:bg-gray-700/50 group ${
          isActive ? 'bg-blue-950/20' : ''
        }`}
      >
        <div className="flex justify-between items-start">
          <div>
            <p className="font-semibold text-blue-400 text-sm truncate max-w-[180px]">{item.query}</p>
            <p className="text-xs text-gray-400">{focusName}</p>
            <p className="text-xs text-gray-500">{new Date(item.timestamp).toLocaleString()}</p>
            {item.analysisType === 'follow_up' && (
              <p className="text-[10px] text-amber-400 mt-0.5">{uiText.followUpAnalysis}</p>
            )}
          </div>
          <button
            onClick={() => onDelete(item.id)}
            className="p-1 rounded-full text-gray-500 hover:bg-red-500/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={uiText.deleteReport}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => onLoad(item.id)}
            disabled={Boolean(loadingReportId)}
            className="flex-1 text-center text-xs font-bold py-1.5 bg-blue-600/80 text-white rounded-md hover:bg-blue-600 disabled:opacity-60 disabled:cursor-wait"
          >
            {isLoading ? (currentLanguage === 'cn' ? '加载中…' : 'Loading…') : uiText.loadReport}
          </button>
          {canFollowUp && (
            <button
              onClick={() => onFollowUpAll(item.id)}
              className="flex-1 text-center text-xs font-bold py-1.5 bg-amber-700/80 text-white rounded-md hover:bg-amber-600"
            >
              {uiText.followUpAll}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderCompareSession = (session: ComparisonSessionSummary) => {
    const latest = session.latestRun;
    const isActive = Boolean(latest && activeCompareRunId === latest.runId);
    const runCountLabel = uiText.compareSessionRunCount.replace(
      '{count}',
      String(session.runCount)
    );
    const sessionLabel = formatCompareSessionLabel(session, currentLanguage);

    return (
      <div
        key={session.id}
        className={`p-3 border-b border-gray-700/50 hover:bg-gray-700/40 ${
          isActive ? 'bg-purple-950/25 border-l-2 border-l-purple-400' : ''
        }`}
      >
        <div className="min-w-0">
          <p className="font-semibold text-purple-200 text-sm leading-snug">{sessionLabel}</p>
          <p className="text-xs text-gray-500 mt-1">
            {runCountLabel} · {session.language.toUpperCase()}
          </p>
        </div>
        {latest && (
          <button
            type="button"
            onClick={() => onOpenCompareRun(latest.runId)}
            className="mt-2 w-full text-center text-xs font-bold py-1.5 bg-purple-600/80 text-white rounded-md hover:bg-purple-600"
          >
            {uiText.compareOpenResult}
          </button>
        )}
      </div>
    );
  };

  const renderReportsContent = () => {
    if (isLoading && history.length === 0) {
      return (
        <div className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mb-2" />
            <p className="text-gray-400 text-sm">
              {currentLanguage === 'cn' ? '加载历史中...' : 'Loading history...'}
            </p>
          </div>
        </div>
      );
    }

    if (history.length === 0) {
      if (historyError) {
        return (
          <div className="flex-grow flex flex-col items-center justify-center text-center p-4 gap-3">
            <p className="text-red-400 text-sm font-medium">{uiText.historyLoadError}</p>
            <p className="text-gray-500 text-xs">{historyError}</p>
            <p className="text-gray-500 text-xs">{uiText.historyEmptyAfterError}</p>
            {onRefreshHistory && (
              <button
                onClick={onRefreshHistory}
                className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white"
              >
                {uiText.historyRetry}
              </button>
            )}
          </div>
        );
      }
      return (
        <div className="flex-grow flex items-center justify-center text-center p-4">
          <p className="text-gray-500">{uiText.emptyHistory}</p>
        </div>
      );
    }

    return (
      <>
        {(isLoading || isLoadingMore) && history.length > 0 && (
          <div className="px-4 py-2 text-xs text-blue-300/90 border-b border-gray-700/60 flex items-center gap-2">
            <div className="inline-block animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-blue-400 shrink-0" />
            {currentLanguage === 'cn' ? '正在同步最新历史…' : 'Syncing latest history…'}
          </div>
        )}
        <div className="flex-grow overflow-y-auto">
          {viewMode === 'grouped' ? (
            tickerGroups.map(group => (
              <div key={group.ticker} className="border-b border-gray-700/60">
                <button
                  type="button"
                  onClick={() => toggleTicker(group.ticker)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/30 text-left"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-white text-sm truncate">{group.name}</p>
                    <p className="text-xs text-gray-400">
                      {group.ticker} · {group.exchange} · {group.entries.length}{' '}
                      {uiText.timelineReports}
                    </p>
                  </div>
                  <span className="text-gray-500 text-sm shrink-0 ml-2">
                    {isExpanded(group.ticker) ? '▾' : '▸'}
                  </span>
                </button>
                {isExpanded(group.ticker) && (
                  <div className="px-4 pb-3 border-l border-gray-700/40 ml-5 mr-2">
                    {[...group.entries].reverse().map(entry => renderTimelineEntry(entry))}
                  </div>
                )}
              </div>
            ))
          ) : (
            history.map(item => renderFlatItem(item))
          )}
          {(isLoadingMore || historyHasMore) && history.length > 0 && (
            <div className="px-4 py-3 text-center border-t border-gray-700/50">
              <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400 mb-1" />
              <p className="text-gray-400 text-xs">{uiText.historyLoadingMore}</p>
            </div>
          )}
        </div>
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={handleClearAll}
            className="w-full py-2 text-sm font-medium text-red-400 bg-red-900/50 rounded-md hover:bg-red-900"
          >
            {uiText.clearHistory}
          </button>
        </div>
      </>
    );
  };

  const renderComparisonsContent = () => {
    if (isLoadingCompareSessions && compareSessions.length === 0 && !compareSessionsError) {
      return (
        <div className="flex-grow flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mb-2" />
            <p className="text-gray-400 text-sm">{uiText.compareLoadingSessions}</p>
          </div>
        </div>
      );
    }

    if (compareSessionsError) {
      return (
        <div className="flex-grow flex flex-col items-center justify-center text-center p-4 gap-3">
          <p className="text-red-400 text-sm">{compareSessionsError}</p>
          {onRefreshCompareSessions && (
            <button
              type="button"
              onClick={onRefreshCompareSessions}
              className="px-4 py-2 text-sm font-medium rounded-md bg-purple-600 hover:bg-purple-500 text-white"
            >
              {uiText.historyRetry}
            </button>
          )}
        </div>
      );
    }

    if (compareSessions.length === 0) {
      return (
        <div className="flex-grow flex flex-col items-center justify-center text-center p-4 gap-4">
          <p className="text-gray-500 text-sm">{uiText.compareNoSessions}</p>
          <p className="text-gray-600 text-xs">{uiText.compareSidebarHint}</p>
          <button
            type="button"
            onClick={onOpenNewCompare}
            className="px-4 py-2 text-sm font-medium rounded-md bg-purple-600 hover:bg-purple-500 text-white"
          >
            {uiText.compareNewCompare}
          </button>
        </div>
      );
    }

    return (
      <>
        <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-700/60">
          {uiText.compareSidebarHint}
        </p>
        <div className="flex-grow overflow-y-auto">
          {compareSessions.map(session => renderCompareSession(session))}
        </div>
        <div className="p-4 border-t border-gray-700 space-y-2">
          <button
            type="button"
            onClick={onOpenNewCompare}
            className="w-full py-2 text-sm font-medium text-white bg-purple-600 rounded-md hover:bg-purple-500"
          >
            {uiText.compareNewCompare}
          </button>
          {onRefreshCompareSessions && (
            <button
              type="button"
              onClick={onRefreshCompareSessions}
              className="w-full py-2 text-sm font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600"
            >
              {uiText.historyRetry}
            </button>
          )}
        </div>
      </>
    );
  };

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/60 z-30 transition-opacity ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 left-0 h-full w-96 max-w-[92vw] bg-gray-800 shadow-2xl z-40 transform transition-transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          <div className="p-4 border-b border-gray-700">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold text-white">{uiText.history}</h2>
              <button
                onClick={onClose}
                className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white"
              >
                &times;
              </button>
            </div>
            <div className="mt-3 inline-flex rounded-md bg-gray-900 p-0.5 border border-gray-700 text-xs w-full">
              <button
                type="button"
                onClick={() => setSidebarTab('reports')}
                className={`flex-1 px-2.5 py-1.5 rounded font-medium ${
                  sidebarTab === 'reports' ? 'bg-blue-600 text-white' : 'text-gray-400'
                }`}
              >
                {uiText.historyReportsTab}
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('comparisons')}
                className={`flex-1 px-2.5 py-1.5 rounded font-medium ${
                  sidebarTab === 'comparisons' ? 'bg-purple-600 text-white' : 'text-gray-400'
                }`}
              >
                {uiText.historyComparisonsTab}
              </button>
            </div>
            {sidebarTab === 'reports' && (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-gray-400">{reportCountLabel}</p>
                <div className="inline-flex rounded-md bg-gray-900/80 p-0.5 border border-gray-700/80 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode('grouped')}
                  className={`px-2.5 py-1 rounded font-medium ${
                    viewMode === 'grouped' ? 'bg-blue-600 text-white' : 'text-gray-400'
                  }`}
                >
                  {uiText.historyGroupedByTicker}
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('flat')}
                  className={`px-2.5 py-1 rounded font-medium ${
                    viewMode === 'flat' ? 'bg-blue-600 text-white' : 'text-gray-400'
                  }`}
                >
                  {uiText.historyFlatList}
                </button>
                </div>
                {onRefreshHistory && (
                  <button
                    type="button"
                    onClick={onRefreshHistory}
                    disabled={isLoading || isLoadingMore}
                    className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50"
                  >
                    {uiText.historyRetry}
                  </button>
                )}
              </div>
            )}
          </div>

          {sidebarTab === 'reports' ? renderReportsContent() : renderComparisonsContent()}
        </div>
      </aside>
    </>
  );
};
