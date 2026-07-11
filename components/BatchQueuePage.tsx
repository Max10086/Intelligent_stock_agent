import React, { useState, useCallback } from 'react';
import { Language, AnalysisState, RuntimeModelConfig } from '../types.ts';
import { getUIText } from '../constants.ts';
import { QueueDashboardState, QueueJobItem } from '../hooks/useBatchJobs.ts';
import { apiFetch } from '../utils/authenticatedFetch.ts';
import { AnalysisModeSplitButton } from './AnalysisModeSplitButton.tsx';
import { BrandMark } from './BrandMark.tsx';
import { ArrowPathIcon, QueueListIcon } from './icons.tsx';

interface BatchQueuePageProps {
  language: Language;
  queueStatus: QueueDashboardState | null;
  queueFetchError: string | null;
  onRefreshQueue: () => void;
  submitBatchJob: (tickers: string, language: Language) => Promise<unknown>;
  retryFailedJob?: (jobId: string) => Promise<unknown>;
  onLoadReport?: (payload: { id: string; result: AnalysisState }) => void;
  onRefreshHistory?: () => void;
  runtimeModelConfig: RuntimeModelConfig;
  onConfigApplied: (config: RuntimeModelConfig) => void;
  isAdmin?: boolean;
}

const cardShellClass =
  'rounded-2xl border border-gray-600/80 bg-gray-800/60 shadow-[0_8px_32px_rgba(0,0,0,0.35)]';

const StatCard: React.FC<{
  label: string;
  value: number;
  tone: 'yellow' | 'blue' | 'green' | 'red';
}> = ({ label, value, tone }) => {
  const toneClass = {
    yellow: 'border-yellow-500/30 bg-yellow-950/20 text-yellow-300',
    blue: 'border-blue-500/30 bg-blue-950/20 text-blue-300',
    green: 'border-green-500/30 bg-green-950/20 text-green-300',
    red: 'border-red-500/30 bg-red-950/20 text-red-300',
  }[tone];

  return (
    <div className={`rounded-xl border px-4 py-3 text-center ${toneClass}`}>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-gray-400">{label}</div>
    </div>
  );
};

export const BatchQueuePage: React.FC<BatchQueuePageProps> = ({
  language,
  queueStatus,
  queueFetchError,
  onRefreshQueue,
  submitBatchJob,
  retryFailedJob,
  onLoadReport,
  onRefreshHistory,
  runtimeModelConfig,
  onConfigApplied,
  isAdmin = false,
}) => {
  const [tickersInput, setTickersInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingReportId, setLoadingReportId] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);
  const uiText = getUIText(language);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (!tickersInput.trim()) {
        setError(uiText.batchNoTickersError);
        return;
      }

      setIsSubmitting(true);
      setError(null);

      try {
        const tickers = tickersInput
          .split(/[,\n]+/)
          .map(t => t.trim())
          .filter(t => t.length > 0);

        if (tickers.length === 0) {
          throw new Error(uiText.batchInvalidTickersError);
        }

        await submitBatchJob(tickers.join(' '), language);
        setTickersInput('');
        void onRefreshHistory?.();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to submit batch job';
        setError(errorMessage);
        console.error('Error submitting batch job:', err);
      } finally {
        setIsSubmitting(false);
      }
    },
    [tickersInput, language, submitBatchJob, onRefreshHistory, uiText]
  );

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString(language === 'cn' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-500/20 text-green-400 border-green-500/50';
      case 'PROCESSING':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
      case 'FAILED':
        return 'bg-red-500/20 text-red-400 border-red-500/50';
      case 'PENDING':
      default:
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return uiText.batchJobCompleted;
      case 'PROCESSING':
        return uiText.batchJobProcessing;
      case 'FAILED':
        return uiText.batchJobFailed;
      case 'PENDING':
      default:
        return uiText.batchJobPending;
    }
  };

  const formatPrice = (job: QueueJobItem) => {
    if (!job.currentPrice || job.currentPrice === '0.00') return '-';
    const inferCurrencyCode = () => {
      const rawCurrency = (job.currency || '').trim();
      if (rawCurrency) return rawCurrency.toUpperCase();

      const ticker = (job.ticker || '').toUpperCase();
      const exchange = (job.result?.focusCompany?.profile?.exchange || '').toUpperCase();

      if (exchange.includes('NASDAQ') || exchange.includes('NYSE') || ticker.startsWith('US.')) {
        return 'USD';
      }
      if (exchange.includes('HK') || ticker.startsWith('HK.')) {
        return 'HKD';
      }
      if (exchange.includes('SSE') || exchange.includes('SZSE') || ticker.startsWith('SH') || ticker.startsWith('SZ')) {
        return 'CNY';
      }

      return '';
    };

    const currencyCode = inferCurrencyCode();
    const currencySymbolMap: Record<string, string> = {
      USD: '$',
      HKD: 'HK$',
      CNY: '¥',
      RMB: '¥',
      CNH: '¥',
      JPY: 'JPY¥',
      EUR: 'EUR€',
      GBP: 'GBP£',
    };

    const symbol = currencySymbolMap[currencyCode];
    if (symbol) {
      return `${symbol}${job.currentPrice}`;
    }

    if (job.currency) {
      return `${job.currentPrice} ${job.currency}`;
    }
    return job.currentPrice;
  };

  const getConclusionTag = (job: QueueJobItem): {
    label: string;
    className: string;
  } | null => {
    const text = (job.overallConclusion || '').toLowerCase().trim();
    if (!text) return null;

    if (text.includes('strong buy') || text.includes('conviction buy') || text.includes('强烈买入')) {
      return {
        label: uiText.batchConclusionStrongBuy,
        className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
      };
    }
    if (text.includes('buy') || text.includes('增持') || text.includes('买入') || text.includes('推荐')) {
      return {
        label: uiText.batchConclusionBuy,
        className: 'bg-green-500/20 text-green-300 border-green-500/50',
      };
    }
    if (text.includes('strong sell') || text.includes('reduce') || text.includes('强烈卖出')) {
      return {
        label: uiText.batchConclusionStrongSell,
        className: 'bg-red-600/20 text-red-300 border-red-600/50',
      };
    }
    if (text.includes('sell') || text.includes('减持') || text.includes('卖出')) {
      return {
        label: uiText.batchConclusionSell,
        className: 'bg-red-500/20 text-red-300 border-red-500/50',
      };
    }
    if (text.includes('hold') || text.includes('neutral') || text.includes('中性') || text.includes('持有')) {
      return {
        label: uiText.batchConclusionHold,
        className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/50',
      };
    }

    return {
      label: uiText.batchConclusionUnclassified,
      className: 'bg-slate-500/20 text-slate-300 border-slate-500/50',
    };
  };

  const handleLoadReport = useCallback(
    async (job: QueueJobItem) => {
      if (!onLoadReport) return;
      setLoadingReportId(job.id);
      try {
        const response = await apiFetch(`/api/jobs/${job.id}`);
        if (!response.ok) {
          throw new Error(uiText.batchLoadReportError);
        }
        const data = await response.json();
        if (!data.result) {
          throw new Error(uiText.batchEmptyReport);
        }
        onLoadReport({
          id: job.id,
          result: { ...(data.result as AnalysisState), id: job.id },
        });
      } catch (err) {
        console.error('Error loading batch report:', err);
        setError(err instanceof Error ? err.message : uiText.batchLoadReportError);
      } finally {
        setLoadingReportId(null);
      }
    },
    [onLoadReport, uiText]
  );

  const handleRetryJob = useCallback(
    async (job: QueueJobItem) => {
      if (!retryFailedJob) return;
      setRetryingJobId(job.id);
      setError(null);
      try {
        await retryFailedJob(job.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to retry job';
        setError(message);
      } finally {
        setRetryingJobId(null);
      }
    },
    [retryFailedJob]
  );

  const canResumeJob = (job: QueueJobItem) =>
    job.status === 'FAILED' && Boolean(job.hasCheckpoint);

  const stats = queueStatus?.stats ?? { pending: 0, processing: 0, completed: 0, failed: 0 };

  return (
    <section className="w-full max-w-6xl mx-auto px-2 sm:px-4 py-8 sm:py-10 fade-in">
      <BrandMark language={language} variant="hero" />
      <p className="mt-6 sm:mt-8 text-center text-base sm:text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
        {uiText.batchSubtitle}
      </p>

      <div className={`${cardShellClass} p-4 sm:p-6 mb-6 mt-8 sm:mt-10`}>
        <h2 className="text-sm font-semibold text-gray-300 mb-4">{uiText.batchAddTickersTitle}</h2>
        <form onSubmit={handleSubmit}>
          <div className="flex flex-col sm:flex-row sm:items-stretch gap-3 sm:gap-2 sm:rounded-xl sm:border sm:border-gray-600/60 sm:bg-gray-900/40 sm:p-2">
            <div className="relative flex-1 min-w-0">
              <div className="absolute top-4 left-4 pointer-events-none">
                <QueueListIcon className="h-5 w-5 text-gray-400" />
              </div>
              <textarea
                value={tickersInput}
                onChange={e => setTickersInput(e.target.value)}
                placeholder={uiText.batchTickersPlaceholder}
                className="w-full min-h-[7.5rem] sm:min-h-[5.5rem] pl-11 pr-4 py-3.5 text-base bg-gray-800 border border-gray-600 rounded-xl sm:rounded-lg sm:border-0 sm:bg-transparent text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:focus:ring-1 resize-y"
                disabled={isSubmitting}
              />
            </div>

            <AnalysisModeSplitButton
              language={language}
              runtimeModelConfig={runtimeModelConfig}
              onConfigApplied={onConfigApplied}
              isAdmin={isAdmin}
              submitLabel={uiText.batchStartButton}
              submittingLabel={uiText.batchSubmitting}
              isSubmitting={isSubmitting}
              canSubmit={Boolean(tickersInput.trim())}
            />
          </div>

          {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
          {queueFetchError && <div className="mt-3 text-sm text-amber-400">{queueFetchError}</div>}
        </form>
      </div>

      <div className={`${cardShellClass} p-4 sm:p-6`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-100">{uiText.batchDashboardTitle}</h2>
            <button
              type="button"
              onClick={() => void onRefreshQueue()}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-900/50 hover:bg-gray-700/60 text-gray-300 transition-colors"
              title={uiText.batchRefresh}
            >
              <ArrowPathIcon className="h-3.5 w-3.5" />
              {uiText.batchRefresh}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 sm:max-w-xl sm:w-full">
            <StatCard label={uiText.batchStatPending} value={stats.pending} tone="yellow" />
            <StatCard label={uiText.batchStatProcessing} value={stats.processing} tone="blue" />
            <StatCard label={uiText.batchStatCompleted} value={stats.completed} tone="green" />
            <StatCard label={uiText.batchStatFailed} value={stats.failed} tone="red" />
          </div>
        </div>

        {queueStatus && queueStatus.jobs.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-gray-700/80">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-gray-700 bg-gray-900/40">
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.batchColTicker}
                  </th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.batchColCompany}
                  </th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.batchColPrice}
                  </th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.batchColConclusion}
                  </th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.batchCreated}
                  </th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.batchColStatus}
                  </th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.batchColActions}
                  </th>
                </tr>
              </thead>
              <tbody>
                {queueStatus.jobs.map(job => {
                  const conclusionTag = getConclusionTag(job);

                  return (
                    <tr
                      key={job.id}
                      className="border-b border-gray-700/50 hover:bg-gray-700/20 transition-colors"
                    >
                      <td className="py-3 px-3 font-semibold text-blue-400 truncate max-w-[7rem]" title={job.ticker}>
                        {job.ticker}
                      </td>
                      <td className="py-3 px-3 text-gray-200 text-sm truncate max-w-[10rem]" title={job.companyName || ''}>
                        {job.companyName || '-'}
                      </td>
                      <td className="py-3 px-3 text-gray-200 text-sm whitespace-nowrap" title={formatPrice(job)}>
                        {formatPrice(job)}
                      </td>
                      <td className="py-3 px-3 text-gray-300 text-sm min-w-[8rem]" title={job.overallConclusion || ''}>
                        {job.overallConclusion ? (
                          <div className="space-y-1">
                            {conclusionTag && (
                              <span
                                className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold border ${conclusionTag.className}`}
                              >
                                {conclusionTag.label}
                              </span>
                            )}
                            <div className="text-gray-400 text-xs line-clamp-2">{job.overallConclusion}</div>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td
                        className="py-3 px-3 text-gray-400 text-sm whitespace-nowrap"
                        title={formatDateTime(job.createdAt)}
                      >
                        {formatDateTime(job.createdAt)}
                      </td>
                      <td className="py-3 px-3 min-w-[10rem]">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold border leading-tight ${getStatusBadgeClass(job.status)}`}
                            >
                              {getStatusText(job.status)}
                            </span>
                            {job.status === 'PROCESSING' && job.progress !== undefined && (
                              <span className="text-xs text-gray-400 tabular-nums">{job.progress}%</span>
                            )}
                          </div>

                          {job.status === 'PROCESSING' && (
                            <>
                              <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                                <div
                                  className="h-full bg-gradient-to-r from-blue-500 to-sky-400 transition-all duration-500 ease-out"
                                  style={{ width: `${job.progress || 0}%` }}
                                />
                              </div>
                              {job.currentStep && (
                                <div className="text-xs text-gray-300 line-clamp-2" title={job.currentStep}>
                                  <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full mr-2 animate-pulse align-middle" />
                                  {job.currentStep}
                                </div>
                              )}
                            </>
                          )}

                          {job.status === 'FAILED' && job.error && (
                            <div className="text-xs text-red-300/90 line-clamp-2" title={job.error}>
                              {job.error}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {job.status === 'COMPLETED' ? (
                          <button
                            onClick={() => void handleLoadReport(job)}
                            disabled={loadingReportId === job.id}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-wait rounded-lg text-xs font-semibold text-white transition-colors"
                          >
                            {loadingReportId === job.id ? uiText.batchLoadingReport : uiText.batchViewReport}
                          </button>
                        ) : job.status === 'FAILED' && retryFailedJob ? (
                          <button
                            type="button"
                            onClick={() => void handleRetryJob(job)}
                            disabled={retryingJobId === job.id}
                            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-600 disabled:cursor-wait rounded-lg text-xs font-semibold text-white transition-colors"
                          >
                            {retryingJobId === job.id
                              ? uiText.batchRetrying
                              : canResumeJob(job)
                                ? uiText.batchResume
                                : uiText.batchRetry}
                          </button>
                        ) : (
                          <span className="text-gray-500 text-sm">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-14 px-4 rounded-xl border border-dashed border-gray-700 bg-gray-900/20">
            <QueueListIcon className="h-10 w-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm max-w-md mx-auto">{uiText.batchEmptyState}</p>
          </div>
        )}

        <p className="mt-5 text-center text-xs text-gray-500">{uiText.batchAutoRefreshHint}</p>
      </div>
    </section>
  );
};
