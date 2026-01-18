
import React, { useState, useCallback } from 'react';
import { SearchComponent } from './components/SearchComponent.tsx';
import { AnalysisComponent } from './components/AnalysisComponent.tsx';
import { BatchQueuePage } from './components/BatchQueuePage.tsx';
import { useStockAgent } from './hooks/useStockAgent.ts';
import { useBatchJobs } from './hooks/useBatchJobs.ts';
import { Language } from './types.ts';
import { Header } from './components/Header.tsx';
import { HistorySidebar } from './components/HistorySidebar.tsx';

type ViewMode = 'single' | 'batch';

const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>('en');
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewMode>('single');
  const { analysisState, history, isLoadingHistory, startAnalysis, resetAnalysis, loadFromHistory, deleteFromHistory, clearHistory } = useStockAgent();
  const { activeBatchJobId, batchJobStatus, isPolling, submitBatchJob, clearBatchJob } = useBatchJobs();

  const handleSearch = useCallback((query: string) => {
    if (query.trim()) {
      startAnalysis(query, language);
    }
  }, [language, startAnalysis]);

  const handleBatchSubmit = useCallback(async (tickers: string) => {
    try {
      await submitBatchJob(tickers, language);
    } catch (error) {
      console.error('Failed to submit batch job:', error);
      alert(error instanceof Error ? error.message : 'Failed to submit batch job');
    }
  }, [language, submitBatchJob]);

  const handleReset = useCallback(() => {
    resetAnalysis();
    clearBatchJob();
    setCurrentView('single');
  }, [resetAnalysis, clearBatchJob]);

  const handleViewChange = useCallback((view: ViewMode) => {
    setCurrentView(view);
  }, []);

  const handleLoadFromHistory = useCallback((id: string) => {
    loadFromHistory(id);
    setIsHistoryOpen(false);
  }, [loadFromHistory]);

  // Show batch job status if active
  const showBatchStatus = activeBatchJobId && batchJobStatus;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-sans">
      <HistorySidebar
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        history={history}
        isLoading={isLoadingHistory}
        onLoad={handleLoadFromHistory}
        onDelete={deleteFromHistory}
        onClearAll={clearHistory}
        currentLanguage={analysisState.language}
      />
      <Header 
        onReset={handleReset} 
        onToggleHistory={() => setIsHistoryOpen(true)}
        currentView={currentView}
        onViewChange={handleViewChange}
      />
      <main className="container mx-auto px-4 py-8">
        {currentView === 'batch' ? (
          <BatchQueuePage language={language} setLanguage={setLanguage} />
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
            {analysisState.status === 'idle' && !showBatchStatus ? (
              <SearchComponent
                onSearch={handleSearch}
                onBatchSubmit={handleBatchSubmit}
                language={language}
                setLanguage={setLanguage}
              />
            ) : !showBatchStatus ? (
              <AnalysisComponent analysisState={analysisState} language={analysisState.language} />
            ) : null}
          </>
        )}
      </main>
      <footer className="text-center py-4 text-gray-500 text-sm">
        <p>Intelligent Stock Agent. For informational purposes only. Not financial advice.</p>
      </footer>
    </div>
  );
};

export default App;
