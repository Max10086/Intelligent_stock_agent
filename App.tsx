
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { SearchComponent } from './components/SearchComponent.tsx';
import { AnalysisComponent } from './components/AnalysisComponent.tsx';
import { BatchQueuePage } from './components/BatchQueuePage.tsx';
import { ModelSettingsPanel } from './components/ModelSettingsPanel.tsx';
import { FollowUpConfirmModal } from './components/FollowUpConfirmModal.tsx';
import { getFollowUpTargetsFromParent } from './utils/followUpHelpers.ts';
import { useStockAgent } from './hooks/useStockAgent.ts';
import { useBatchJobs } from './hooks/useBatchJobs.ts';
import { AnalysisState, Language } from './types.ts';
import { Header } from './components/Header.tsx';
import { ComparePage } from './components/ComparePage.tsx';
import { HistorySidebar } from './components/HistorySidebar.tsx';
import { useCompanyCompare } from './hooks/useCompanyCompare.ts';
import { AnalysisStepTimeline } from './components/AnalysisStepTimeline.tsx';
import { getUIText, FEATURE_BATCH_QUEUE } from './constants.ts';
import { useAuth } from './hooks/useAuth.ts';
import { LoginPage } from './components/LoginPage.tsx';
import { UsageBanner } from './components/UsageBanner.tsx';
import { setUsageRefreshCallback } from './utils/usageEvents.ts';
import { useAnalytics } from './hooks/useAnalytics.ts';
import { resolveRootReportForTicker } from './utils/analysisTimeline.ts';
import { persistUiLanguage, readStoredUiLanguage } from './utils/uiLanguage.ts';

const STEP_TIMELINE_STORAGE_KEY = 'stock-agent-show-step-timeline';

const readStoredStepTimelinePreference = (): boolean => {
  try {
    return localStorage.getItem(STEP_TIMELINE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

const persistStepTimelinePreference = (visible: boolean) => {
  try {
    localStorage.setItem(STEP_TIMELINE_STORAGE_KEY, visible ? '1' : '0');
  } catch {
    // Ignore storage failures in private browsing.
  }
};

type ViewMode = 'single' | 'batch' | 'compare';
type ActiveModelSnapshot = {
  analysis: string | null;
  search: string | null;
};

const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>(() => readStoredUiLanguage() ?? 'en');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewMode>('single');
  const [activeModels, setActiveModels] = useState<ActiveModelSnapshot>({ analysis: null, search: null });
  const [followUpModal, setFollowUpModal] = useState<{
    parentState: AnalysisState;
    companyIds?: string[];
  } | null>(null);
  const [viewingBaselineReport, setViewingBaselineReport] = useState<AnalysisState | null>(null);
  const [showStepTimeline, setShowStepTimeline] = useState(() => readStoredStepTimelinePreference());
  const uiText = getUIText(language);
  const auth = useAuth();
  const {
    analysisState,
    history,
    isLoadingHistory,
    isLoadingMoreHistory,
    loadingReportId,
    historyLoadedCount,
    historyTotalCount,
    historyHasMore,
    historyError,
    saveStatus,
    saveMessage,
    startAnalysis,
    startCandidateAnalysis,
    startFollowUpAnalysis,
    resetAnalysis,
    loadFromHistory,
    deleteFromHistory,
    clearHistory,
    dismissSaveNotice,
    retryLastAnalysis,
    refreshHistory,
    runtimeModelConfig,
    applyRuntimeModelConfig,
    reloadRuntimeModelConfig,
  } = useStockAgent({
    historyFetchEnabled: auth.isAuthenticated && !auth.isLoading,
    userId: auth.user?.id ?? auth.session?.user?.id ?? null,
  });
  const { trackEvent } = useAnalytics();
  const {
    activeBatchJobId,
    batchJobStatus,
    isPolling,
    clearBatchJob,
    queueStatus,
    queueFetchError,
    submitBatchJob,
    fetchQueueStatus,
    retryFailedJob,
  } = useBatchJobs({
    queuePollingEnabled:
      auth.isAuthenticated && FEATURE_BATCH_QUEUE && currentView === 'batch',
  });
  const companyCompare = useCompanyCompare();
  const [isLoadingCompareSessions, setIsLoadingCompareSessions] = useState(false);
  const [compareSessionsError, setCompareSessionsError] = useState<string | null>(null);
  const [openHistoryToComparisons, setOpenHistoryToComparisons] = useState(false);

  const refreshCompareSessions = useCallback(
    async (options?: { force?: boolean; silent?: boolean }) => {
      const force = options?.force ?? false;
      const silent = options?.silent ?? companyCompare.sessionsLoaded;

      if (companyCompare.sessionsLoaded && !force) {
        return;
      }

      if (!silent) {
        setIsLoadingCompareSessions(true);
      }
      setCompareSessionsError(null);

      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await companyCompare.loadSessions({ force });
          setIsLoadingCompareSessions(false);
          return;
        } catch (err) {
          lastError = err;
          if (attempt < 2) {
            await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
          }
        }
      }
      setCompareSessionsError(
        lastError instanceof Error ? lastError.message : 'Failed to load comparisons'
      );
      setIsLoadingCompareSessions(false);
    },
    [companyCompare.loadSessions, companyCompare.sessionsLoaded]
  );

  const handleOpenCompareRun = useCallback(
    (runId: string) => {
      void companyCompare.loadRun(runId);
      setCurrentView('compare');
      setIsHistoryOpen(false);
    },
    [companyCompare.loadRun]
  );

  const handleOpenNewCompare = useCallback(() => {
    companyCompare.setActiveRun(null);
    setCurrentView('compare');
    setIsHistoryOpen(false);
  }, [companyCompare.setActiveRun]);

  const handleOpenCompareHistorySidebar = useCallback(() => {
    setOpenHistoryToComparisons(true);
    setIsHistoryOpen(true);
  }, []);

  const handleOpenToComparisonsHandled = useCallback(() => {
    setOpenHistoryToComparisons(false);
  }, []);

  const handleToggleHistory = useCallback(() => {
    setIsHistoryOpen(true);
    // Reopening the sidebar should show the in-memory / localStorage list immediately.
    // Only retry when we have no items and the last fetch failed.
    if (history.length === 0 && historyError) {
      void refreshHistory();
    }
  }, [history.length, historyError, refreshHistory]);

  const handleLanguageChange = useCallback((lang: Language) => {
    setLanguage(lang);
    persistUiLanguage(lang);
  }, []);

  useEffect(() => {
    setUsageRefreshCallback(() => {
      void auth.refreshUsage();
    });
    return () => setUsageRefreshCallback(null);
  }, [auth.refreshUsage]);

  useEffect(() => {
    if (auth.isAuthenticated) {
      trackEvent('page_view', { view: currentView });
    }
  }, [auth.isAuthenticated, currentView, trackEvent]);

  useEffect(() => {
    if (auth.isAuthenticated) {
      void refreshCompareSessions();
    }
  }, [auth.isAuthenticated, refreshCompareSessions]);

  useEffect(() => {
    const fetchActiveModel = async () => {
      try {
        const response = await fetch('/api/model');
        if (!response.ok) return;
        const data = await response.json();
        const analysis =
          (typeof data?.analysis?.provider === 'string' &&
          typeof data?.analysis?.model === 'string' &&
          data.analysis.provider.trim() &&
          data.analysis.model.trim())
            ? `${data.analysis.provider.trim()}:${data.analysis.model.trim()}`
            : (typeof data?.model === 'string' && data.model.trim() ? data.model.trim() : null);
        const search =
          (typeof data?.search?.provider === 'string' &&
          typeof data?.search?.model === 'string' &&
          data.search.provider.trim() &&
          data.search.model.trim())
            ? `${data.search.provider.trim()}:${data.search.model.trim()}`
            : null;
        setActiveModels({ analysis, search });
      } catch {
        // Keep UI quiet if backend model endpoint is temporarily unavailable.
      }
    };

    fetchActiveModel();
  }, [runtimeModelConfig.analysis.model, runtimeModelConfig.analysis.provider, runtimeModelConfig.search.model]);

  const handleSearch = useCallback(async (query: string) => {
    if (query.trim()) {
      await startAnalysis(query, language);
    }
  }, [language, startAnalysis]);

  const handleReset = useCallback(() => {
    resetAnalysis();
    if (FEATURE_BATCH_QUEUE) {
      clearBatchJob();
    }
    setCurrentView('single');
    setViewingBaselineReport(null);
    setFollowUpModal(null);
  }, [resetAnalysis, clearBatchJob]);

  const handleToggleStepTimeline = useCallback(() => {
    setShowStepTimeline(prev => {
      const next = !prev;
      persistStepTimelinePreference(next);
      return next;
    });
  }, []);

  const handleViewChange = useCallback((view: ViewMode) => {
    setCurrentView(view);
  }, []);

  const handleLoadFromHistory = useCallback((id: string) => {
    setCurrentView('single');
    setViewingBaselineReport(null);
    void loadFromHistory(id).catch(error => {
      console.error('Failed to load history report:', error);
      alert(
        language === 'cn'
          ? `加载报告失败：${error instanceof Error ? error.message : '未知错误'}`
          : `Failed to load report: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    });
    setIsHistoryOpen(false);
  }, [loadFromHistory, language]);

  const openFollowUpModal = useCallback((parentState: AnalysisState, companyIds?: string[]) => {
    setFollowUpModal({ parentState, companyIds });
    setIsHistoryOpen(false);
  }, []);

  const handleFollowUpAllFromHistory = useCallback((id: string) => {
    const parentState = history.find(item => item.id === id);
    if (parentState) {
      openFollowUpModal(parentState);
    }
  }, [history, openFollowUpModal]);

  const handleFollowUpCompany = useCallback((companyId: string) => {
    openFollowUpModal(analysisState, [companyId]);
  }, [analysisState, openFollowUpModal]);

  const handleConfirmFollowUp = useCallback(() => {
    if (!followUpModal) return;
    const { parentState, companyIds } = followUpModal;
    setFollowUpModal(null);
    setViewingBaselineReport(null);
    void startFollowUpAnalysis(parentState, { companyIds });
  }, [followUpModal, startFollowUpAnalysis]);

  const followUpTargetCompanies = useMemo(() => {
    if (!followUpModal) return [];
    return getFollowUpTargetsFromParent(followUpModal.parentState, followUpModal.companyIds);
  }, [followUpModal]);

  const parentReportForView = useMemo(() => {
    if (!analysisState.followUpMeta?.parentAnalysisId) return null;
    return history.find(item => item.id === analysisState.followUpMeta?.parentAnalysisId) || null;
  }, [analysisState.followUpMeta?.parentAnalysisId, history]);

  const initialReportForView = useMemo(() => {
    if (analysisState.analysisType !== 'follow_up') return null;
    const ticker =
      analysisState.focusCompany?.profile.ticker ||
      analysisState.candidateCompanies[0]?.profile.ticker;
    if (!ticker) return null;
    const historyById = new Map(history.map(item => [item.id, item]));
    const root = resolveRootReportForTicker(analysisState, ticker, historyById);
    return root.id !== analysisState.id ? root : null;
  }, [analysisState, history]);

  const handleViewParentReport = useCallback(() => {
    if (parentReportForView) {
      setViewingBaselineReport(parentReportForView);
    }
  }, [parentReportForView]);

  const handleViewInitialReport = useCallback(() => {
    if (initialReportForView) {
      setViewingBaselineReport(initialReportForView);
    }
  }, [initialReportForView]);

  const displayedAnalysisState = viewingBaselineReport || analysisState;
  const activeReportId = viewingBaselineReport?.id || analysisState.id;
  const isOpeningReport = Boolean(loadingReportId);
  const isLoadingReportDetails =
    Boolean(loadingReportId) && loadingReportId === analysisState.id;

  // Show batch job status if active
  const showBatchStatus = FEATURE_BATCH_QUEUE && activeBatchJobId && batchJobStatus;

  /** Main search entry (single view, idle) — input form is the only start action. */
  const isSearchHome =
    currentView === 'single' && analysisState.status === 'idle' && !showBatchStatus;
  const showNewAnalysisButton = !isSearchHome;

  const showStepTimelinePanel =
    showStepTimeline &&
    currentView === 'single' &&
    !isSearchHome &&
    (analysisState.stepLogs?.length ?? 0) > 0;

  if (auth.isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-400 mb-3" />
          <p className="text-gray-400 text-sm">{language === 'cn' ? '加载中...' : 'Loading...'}</p>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <LoginPage
        language={language}
        onSignInWithGoogle={auth.signInWithGoogle}
        onSignInWithEmail={(email, password) => auth.signInWithEmail(email, password, language)}
        onSendSignUpCode={email => auth.sendSignUpCode(email, language)}
        onCompleteSignUp={(email, code, password, confirmPassword) =>
          auth.completeSignUp(email, code, password, confirmPassword, language)
        }
        error={auth.error}
        isConfigured={auth.isConfigured}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      <HistorySidebar
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        isLoading={isLoadingHistory}
        isLoadingMore={isLoadingMoreHistory}
        historyLoadedCount={historyLoadedCount}
        historyTotalCount={historyTotalCount}
        historyHasMore={historyHasMore}
        historyError={historyError}
        onRefreshHistory={() => void refreshHistory()}
        onLoad={handleLoadFromHistory}
        onFollowUpAll={handleFollowUpAllFromHistory}
        onDelete={deleteFromHistory}
        onClearAll={clearHistory}
        currentLanguage={language}
        activeReportId={activeReportId}
        loadingReportId={loadingReportId}
        compareSessions={companyCompare.sessions}
        isLoadingCompareSessions={isLoadingCompareSessions}
        compareSessionsError={compareSessionsError}
        activeCompareRunId={
          currentView === 'compare' ? companyCompare.activeRun?.runId : undefined
        }
        onRefreshCompareSessions={() => void refreshCompareSessions({ force: true })}
        onOpenCompareRun={handleOpenCompareRun}
        onOpenNewCompare={handleOpenNewCompare}
        openToComparisons={openHistoryToComparisons}
        onOpenToComparisonsHandled={handleOpenToComparisonsHandled}
      />
      <FollowUpConfirmModal
        isOpen={Boolean(followUpModal)}
        parentState={followUpModal?.parentState || null}
        targetCompanies={followUpTargetCompanies}
        language={language}
        onClose={() => setFollowUpModal(null)}
        onConfirm={handleConfirmFollowUp}
      />
      <Header
        onReset={handleReset}
        onToggleHistory={() => {
          handleToggleHistory();
          trackEvent('history_open');
        }}
        onOpenCompare={() => setCurrentView('compare')}
        userEmail={auth.user?.email || null}
        onSignOut={() => void auth.signOut()}
        language={language}
        onLanguageChange={handleLanguageChange}
        showNewAnalysisButton={showNewAnalysisButton}
        currentView={currentView}
        onViewChange={FEATURE_BATCH_QUEUE ? handleViewChange : undefined}
        showStepTimeline={showStepTimeline}
        onToggleStepTimeline={currentView === 'single' ? handleToggleStepTimeline : undefined}
      />
      <main className="container mx-auto px-4 py-8">
        <UsageBanner language={language} usage={auth.usage} />
        {saveStatus !== 'idle' && saveMessage && (
          <div className={`max-w-4xl mx-auto mb-4 rounded-lg border px-4 py-3 flex items-center justify-between ${
            saveStatus === 'success'
              ? 'bg-green-900/20 border-green-500/40 text-green-300'
              : saveStatus === 'error'
                ? 'bg-red-900/20 border-red-500/40 text-red-300'
                : 'bg-blue-900/20 border-blue-500/40 text-blue-300'
          }`}>
            <span className="text-sm font-medium">{saveMessage}</span>
            <button
              onClick={dismissSaveNotice}
              className="ml-3 rounded px-2 py-1 text-xs text-gray-200 hover:bg-white/10"
            >
              {language === 'cn' ? '关闭' : 'Dismiss'}
            </button>
          </div>
        )}
        <ModelSettingsPanel
          language={language}
          runtimeModelConfig={runtimeModelConfig}
          onConfigApplied={applyRuntimeModelConfig}
        />
        {FEATURE_BATCH_QUEUE && currentView === 'batch' ? (
          <BatchQueuePage
            language={language}
            queueStatus={queueStatus}
            queueFetchError={queueFetchError}
            onRefreshQueue={() => void fetchQueueStatus()}
            submitBatchJob={submitBatchJob}
            retryFailedJob={retryFailedJob}
            onLoadReport={({ id, result }) => {
              void loadFromHistory(id, result)
                .then(() => {
                  setCurrentView('single');
                  window.setTimeout(() => void refreshHistory(), 500);
                })
                .catch(error => {
                  console.error('Failed to load batch report:', error);
                  alert(
                    language === 'cn'
                      ? `加载报告失败：${error instanceof Error ? error.message : '未知错误'}`
                      : `Failed to load report: ${error instanceof Error ? error.message : 'Unknown error'}`
                  );
                });
            }}
            onRefreshHistory={() => void refreshHistory()}
          />
        ) : currentView === 'compare' ? (
          <ComparePage
            language={language}
            history={history}
            onLoadReport={handleLoadFromHistory}
            compare={companyCompare}
            onCompareSaved={() => void refreshCompareSessions({ force: true, silent: true })}
            onOpenHistorySidebar={handleOpenCompareHistorySidebar}
          />
        ) : (
          <>
            {showBatchStatus ? (
              <div className="max-w-4xl mx-auto">
                <div className="bg-gray-800 rounded-lg p-6 mb-6">
                  <h2 className="text-2xl font-bold mb-4">
                    {language === 'en' ? 'Batch Job Status' : '批量任务状态'}
                  </h2>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">
                        {language === 'en' ? 'Status:' : '状态:'}
                      </span>
                      <span className={`font-semibold ${
                        batchJobStatus.overallStatus === 'COMPLETED' ? 'text-green-400' :
                        batchJobStatus.overallStatus === 'FAILED' ? 'text-red-400' :
                        batchJobStatus.overallStatus === 'PROCESSING' ? 'text-blue-400' :
                        'text-yellow-400'
                      }`}>
                        {batchJobStatus.overallStatus}
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-4 text-sm">
                      <div className="text-center">
                        <div className="text-2xl font-bold">{batchJobStatus.stats.total}</div>
                        <div className="text-gray-400">{language === 'en' ? 'Total' : '总计'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-yellow-400">{batchJobStatus.stats.pending}</div>
                        <div className="text-gray-400">{language === 'en' ? 'Pending' : '等待中'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-blue-400">{batchJobStatus.stats.processing}</div>
                        <div className="text-gray-400">{language === 'en' ? 'Processing' : '处理中'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-green-400">{batchJobStatus.stats.completed}</div>
                        <div className="text-gray-400">{language === 'en' ? 'Completed' : '已完成'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-bold text-red-400">{batchJobStatus.stats.failed}</div>
                        <div className="text-gray-400">{language === 'en' ? 'Failed' : '失败'}</div>
                      </div>
                    </div>
                    {isPolling && (
                      <p className="text-sm text-gray-500 text-center">
                        {language === 'en' 
                          ? '⏳ Polling for updates... You can close this page and check back later.'
                          : '⏳ 正在轮询更新... 您可以关闭此页面，稍后再回来查看。'
                        }
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCurrentView('batch')}
                        className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-white"
                      >
                        {language === 'en' ? 'View Full Queue' : '查看完整队列'}
                      </button>
                      <button
                        onClick={clearBatchJob}
                        className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
                      >
                        {language === 'en' ? 'Close Status' : '关闭状态'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {analysisState.status === 'idle' && !showBatchStatus && !isOpeningReport ? (
              <SearchComponent onSearch={handleSearch} language={language} />
            ) : !showBatchStatus ? (
              <>
                {isLoadingReportDetails && (
                  <div className="max-w-4xl mx-auto mb-4 rounded-lg border border-blue-500/40 bg-blue-950/30 px-4 py-3 flex items-center gap-3">
                    <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-blue-400 shrink-0" />
                    <p className="text-sm text-blue-200">
                      {language === 'cn' ? '正在加载完整报告（含问答详情）…' : 'Loading full report details (including Q&A)…'}
                    </p>
                  </div>
                )}
                {viewingBaselineReport && (
                  <div className="max-w-4xl mx-auto mb-4 rounded-lg border border-gray-600 bg-gray-800/80 px-4 py-3 flex items-center justify-between">
                    <p className="text-sm text-gray-300">
                      {viewingBaselineReport.id === initialReportForView?.id
                        ? (language === 'cn' ? '正在查看首次分析（只读）' : 'Viewing initial report (read-only)')
                        : (language === 'cn' ? '正在查看上一份报告（只读）' : 'Viewing previous report (read-only)')}
                    </p>
                    <button
                      onClick={() => setViewingBaselineReport(null)}
                      className="text-xs font-medium px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white"
                    >
                      {language === 'cn' ? '返回当前报告' : 'Back to current report'}
                    </button>
                  </div>
                )}
                <AnalysisComponent
                  analysisState={displayedAnalysisState}
                  language={language}
                  history={history}
                  isLoadingReportDetails={isLoadingReportDetails}
                  onRetry={viewingBaselineReport ? undefined : retryLastAnalysis}
                  onFollowUpCompany={viewingBaselineReport ? undefined : handleFollowUpCompany}
                  onStartCandidateAnalysis={
                    viewingBaselineReport ? undefined : startCandidateAnalysis
                  }
                  onViewParentReport={handleViewParentReport}
                  onViewInitialReport={handleViewInitialReport}
                  onLoadReport={handleLoadFromHistory}
                  parentReportAvailable={Boolean(parentReportForView)}
                  initialReportAvailable={Boolean(initialReportForView)}
                />
              </>
            ) : null}
          </>
        )}
      </main>
      {showStepTimelinePanel && (
        <section className="border-t border-gray-700 bg-gray-900/95">
          <div className="container mx-auto px-4 py-6 max-w-4xl">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">{uiText.stepTimelineTitle}</h3>
            <AnalysisStepTimeline
              stepLogs={analysisState.stepLogs ?? []}
              language={language}
            />
          </div>
        </section>
      )}
      <footer className="text-center py-4 text-gray-500 text-sm">
        {activeModels.analysis && (
          <p className="mb-1 text-xs text-gray-400">
            {language === 'cn' ? '当前分析模型' : 'Active Analysis'}: <span className="font-semibold text-gray-300">{activeModels.analysis}</span>
          </p>
        )}
        {activeModels.search && (
          <p className="mb-1 text-xs text-gray-400">
            {language === 'cn' ? '当前搜索' : 'Active Search'}:{' '}
            <span className="font-semibold text-gray-300">{activeModels.search}</span>
            {runtimeModelConfig.searchMode === 'advanced' && (
              <span className="text-purple-300 ml-1">
                · {language === 'cn' ? '高级（豆包+Google）' : 'Advanced (Doubao+Google)'}
              </span>
            )}
          </p>
        )}
        <p>Intelligent Stock Agent. For informational purposes only. Not financial advice.</p>
      </footer>
    </div>
  );
};

export default App;
