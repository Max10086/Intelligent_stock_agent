
import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { SearchComponent } from './components/SearchComponent.tsx';
import { AnalysisComponent } from './components/AnalysisComponent.tsx';
import { BatchQueuePage } from './components/BatchQueuePage.tsx';
import { BatchJobStatusPanel } from './components/BatchJobStatusPanel.tsx';
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
import { getUIText, BRAND, FEATURE_BATCH_QUEUE } from './constants.ts';
import { useAuth } from './hooks/useAuth.ts';
import { LoginPage } from './components/LoginPage.tsx';
import { UsageBanner } from './components/UsageBanner.tsx';
import { SubscriptionModal } from './components/SubscriptionModal.tsx';
import { useSubscriptionStatus } from './hooks/useSubscriptionStatus.ts';
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

const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>(() => readStoredUiLanguage() ?? 'en');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewMode>('single');
  const [followUpModal, setFollowUpModal] = useState<{
    parentState: AnalysisState;
    companyIds?: string[];
  } | null>(null);
  const [viewingBaselineReport, setViewingBaselineReport] = useState<AnalysisState | null>(null);
  const [showStepTimeline, setShowStepTimeline] = useState(() => readStoredStepTimelinePreference());
  const [isSubscriptionOpen, setIsSubscriptionOpen] = useState(false);
  const uiText = getUIText(language);
  const auth = useAuth();
  const authReady =
    auth.isAuthenticated && !auth.isLoading && Boolean(auth.session?.access_token);
  const isPaidMember = Boolean(
    (auth.usage?.isPaid || auth.user?.isPaid || auth.subscription?.isPaid) &&
      !auth.usage?.isAdmin &&
      !auth.user?.isAdmin
  );
  const { subscription, isLoading: isSubscriptionLoading, refresh: refreshSubscription } =
    useSubscriptionStatus(isPaidMember, auth.subscription);
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
    historyFetchEnabled:
      authReady && Boolean(auth.user?.id ?? auth.session?.user?.id),
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
      authReady && FEATURE_BATCH_QUEUE && currentView === 'batch',
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
    if (authReady) {
      trackEvent('page_view', { view: currentView });
    }
  }, [authReady, currentView, trackEvent]);

  useEffect(() => {
    if (authReady) {
      void refreshCompareSessions();
    }
  }, [authReady, refreshCompareSessions]);

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

  const isBatchJobInProgress =
    batchJobStatus?.overallStatus === 'PENDING' || batchJobStatus?.overallStatus === 'PROCESSING';
  const showBatchStatus =
    FEATURE_BATCH_QUEUE &&
    Boolean(activeBatchJobId && batchJobStatus) &&
    isBatchJobInProgress &&
    analysisState.status === 'idle' &&
    !isOpeningReport;

  const isViewingCompanyReport =
    currentView === 'single' && analysisState.status !== 'idle';
  const showModelSettingsPanel =
    currentView !== 'batch' && !showBatchStatus && !isViewingCompanyReport;

  /** Main search entry (single view, idle) — input form is the only start action. */
  const isSearchHome =
    currentView === 'single' && analysisState.status === 'idle' && !showBatchStatus;
  const isAdmin = Boolean(auth.user?.isAdmin || auth.usage?.isAdmin);
  const showNewAnalysisButton = !isSearchHome;

  const showStepTimelinePanel =
    isAdmin &&
    showStepTimeline &&
    currentView === 'single' &&
    !isSearchHome &&
    (analysisState.stepLogs?.length ?? 0) > 0;

  useEffect(() => {
    document.title = BRAND.documentTitle;
  }, []);

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
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans flex flex-col">
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
      <SubscriptionModal
        isOpen={isSubscriptionOpen}
        language={language}
        user={
          auth.user ||
          (auth.session?.user
            ? {
                id: auth.session.user.id,
                email: auth.session.user.email || '',
                displayName: null,
                avatarUrl: null,
                isPaid: false,
                isAdmin: false,
                paidUntil: null,
                createdAt: new Date().toISOString(),
              }
            : null)
        }
        onClose={() => setIsSubscriptionOpen(false)}
        onActivated={async () => {
          if (auth.session) {
            await auth.refreshProfile(auth.session);
            await refreshSubscription();
          }
        }}
      />
      <Header
        onReset={handleReset}
        onToggleHistory={() => {
          handleToggleHistory();
          trackEvent('history_open');
        }}
        onOpenCompare={() => setCurrentView('compare')}
        userEmail={auth.user?.email ?? auth.session?.user?.email ?? null}
        onSignOut={() => void auth.signOut()}
        showUpgradeButton={!isPaidMember}
        isPaidMember={isPaidMember}
        subscription={subscription}
        isSubscriptionLoading={isSubscriptionLoading}
        onUpgrade={() => setIsSubscriptionOpen(true)}
        language={language}
        onLanguageChange={handleLanguageChange}
        showNewAnalysisButton={showNewAnalysisButton}
        currentView={currentView}
        onViewChange={FEATURE_BATCH_QUEUE ? handleViewChange : undefined}
        showStepTimeline={isAdmin && showStepTimeline}
        onToggleStepTimeline={
          isAdmin && currentView === 'single' ? handleToggleStepTimeline : undefined
        }
      />
      <main
        className={
          isSearchHome
            ? 'flex-1 flex flex-col container mx-auto px-4 w-full'
            : 'flex-1 flex flex-col container mx-auto px-4 py-8 w-full'
        }
      >
        <UsageBanner
          language={language}
          usage={auth.usage}
          onUpgrade={() => setIsSubscriptionOpen(true)}
        />
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
        {isSearchHome ? (
          <>
            <div className="flex-1 flex items-center justify-center py-10 sm:py-14 -mt-8 sm:-mt-12 w-full">
              <SearchComponent
                onSearch={handleSearch}
                language={language}
                runtimeModelConfig={runtimeModelConfig}
                onConfigApplied={applyRuntimeModelConfig}
                isAdmin={isAdmin}
              />
            </div>
          </>
        ) : (
          <>
            {showModelSettingsPanel && (
              <ModelSettingsPanel
                language={language}
                runtimeModelConfig={runtimeModelConfig}
                onConfigApplied={applyRuntimeModelConfig}
                isAdmin={isAdmin}
              />
            )}
            {FEATURE_BATCH_QUEUE && currentView === 'batch' ? (
          <BatchQueuePage
            language={language}
            queueStatus={queueStatus}
            queueFetchError={queueFetchError}
            onRefreshQueue={() => void fetchQueueStatus()}
            submitBatchJob={submitBatchJob}
            retryFailedJob={retryFailedJob}
            runtimeModelConfig={runtimeModelConfig}
            onConfigApplied={applyRuntimeModelConfig}
            isAdmin={isAdmin}
            onLoadReport={({ id, result }) => {
              void loadFromHistory(id, result)
                .then(() => {
                  clearBatchJob();
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
            {showBatchStatus && batchJobStatus ? (
              <BatchJobStatusPanel
                language={language}
                status={batchJobStatus}
                isPolling={isPolling}
                onViewQueue={() => setCurrentView('batch')}
                onDismiss={clearBatchJob}
              />
            ) : null}
            {analysisState.status === 'idle' && !showBatchStatus && !isOpeningReport ? (
              <SearchComponent
                onSearch={handleSearch}
                language={language}
                runtimeModelConfig={runtimeModelConfig}
                onConfigApplied={applyRuntimeModelConfig}
                isAdmin={isAdmin}
              />
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
        <p>
          {BRAND.name} · {language === 'cn' ? BRAND.productNameCn : BRAND.productNameEn}.{' '}
          {language === 'cn' ? '仅供参考，不构成投资建议。' : 'For informational purposes only. Not financial advice.'}
        </p>
      </footer>
    </div>
  );
};

export default App;
