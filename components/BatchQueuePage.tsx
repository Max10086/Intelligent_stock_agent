import React, { useState, useCallback, useEffect } from 'react';
import { Language } from '../types.ts';
import { getUIText } from '../constants.ts';
import { useBatchJobs } from '../hooks/useBatchJobs.ts';

interface BatchQueuePageProps {
  language: Language;
  setLanguage: (lang: Language) => void;
}

interface QueueJob {
  id: string;
  ticker: string;
  companyName?: string | null;
  overallConclusion?: string | null;
  currentPrice?: string | null;
  currency?: string | null;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  completedAt: string | null;
  result: any | null;
  progress?: number;
  currentStep?: string | null;
  logs?: string[] | null;
}

interface QueueStatus {
  jobs: QueueJob[];
  total: number;
  stats: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}

const API_BASE_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3001';

export const BatchQueuePage: React.FC<BatchQueuePageProps> = ({ language, setLanguage }) => {
  const [tickersInput, setTickersInput] = useState('');
  const [queueStatus, setQueueStatus] = useState<QueueStatus | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { submitBatchJob } = useBatchJobs();
  const uiText = getUIText(language);

  // Fetch queue status
  const fetchQueueStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/jobs`);
      if (!response.ok) {
        throw new Error('Failed to fetch queue status');
      }
      const data = await response.json();
      
      // Transform jobs to match QueueJob interface
      const transformedJobs: QueueJob[] = (data.jobs || []).map((job: any) => ({
        id: job.id,
        ticker: job.ticker,
        companyName: job.companyName ?? null,
        overallConclusion: job.overallConclusion ?? null,
        currentPrice: job.currentPrice ?? null,
        currency: job.currency ?? null,
        status: job.status as 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED',
        createdAt: job.createdAt,
        completedAt: job.completedAt || null,
        result: job.result || null,
        progress: job.progress ?? 0,
        currentStep: job.currentStep || null,
        logs: job.logs || null,
      }));
      
      setQueueStatus({
        jobs: transformedJobs,
        total: data.total || 0,
        stats: data.stats || {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        },
      });
    } catch (err) {
      console.error('Error fetching queue status:', err);
    }
  }, []);

  // Poll queue status every 5 seconds
  useEffect(() => {
    fetchQueueStatus(); // Initial fetch
    
    const interval = setInterval(() => {
      fetchQueueStatus();
    }, 5000); // Poll every 5 seconds

    return () => clearInterval(interval);
  }, [fetchQueueStatus]);

  // Handle form submission
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!tickersInput.trim()) {
      setError(language === 'en' ? 'Please enter at least one ticker' : '请输入至少一个股票代码');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Parse tickers (support both comma and newline separated)
      const tickers = tickersInput
        .split(/[,\n]+/)
        .map(t => t.trim())
        .filter(t => t.length > 0);

      if (tickers.length === 0) {
        throw new Error(language === 'en' ? 'No valid tickers found' : '未找到有效的股票代码');
      }

      // Submit batch job
      await submitBatchJob(tickers.join(' '), language);
      
      // Clear input
      setTickersInput('');
      
      // Refresh queue status
      setTimeout(() => {
        fetchQueueStatus();
      }, 1000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit batch job';
      setError(errorMessage);
      console.error('Error submitting batch job:', err);
    } finally {
      setIsSubmitting(false);
    }
  }, [tickersInput, language, submitBatchJob, fetchQueueStatus]);

  // Format date/time
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

  // Get status badge color
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return 'bg-green-500/20 text-green-400 border-green-500';
      case 'PROCESSING':
        return 'bg-blue-500/20 text-blue-400 border-blue-500';
      case 'FAILED':
        return 'bg-red-500/20 text-red-400 border-red-500';
      case 'PENDING':
      default:
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500';
    }
  };

  // Get status text
  const getStatusText = (status: string) => {
    if (language === 'cn') {
      switch (status) {
        case 'COMPLETED':
          return '已完成';
        case 'PROCESSING':
          return '处理中';
        case 'FAILED':
          return '失败';
        case 'PENDING':
        default:
          return '等待中';
      }
    } else {
      return status;
    }
  };

  const formatPrice = (job: QueueJob) => {
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

  const getConclusionTag = (job: QueueJob): {
    label: string;
    className: string;
  } | null => {
    const text = (job.overallConclusion || '').toLowerCase().trim();
    if (!text) return null;

    if (text.includes('strong buy') || text.includes('conviction buy') || text.includes('强烈买入')) {
      return {
        label: language === 'cn' ? '强烈买入' : 'Strong Buy',
        className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500',
      };
    }
    if (text.includes('buy') || text.includes('增持') || text.includes('买入') || text.includes('推荐')) {
      return {
        label: language === 'cn' ? '买入' : 'Buy',
        className: 'bg-green-500/20 text-green-300 border-green-500',
      };
    }
    if (text.includes('strong sell') || text.includes('reduce') || text.includes('强烈卖出')) {
      return {
        label: language === 'cn' ? '强烈卖出' : 'Strong Sell',
        className: 'bg-red-600/20 text-red-300 border-red-600',
      };
    }
    if (text.includes('sell') || text.includes('减持') || text.includes('卖出')) {
      return {
        label: language === 'cn' ? '卖出' : 'Sell',
        className: 'bg-red-500/20 text-red-300 border-red-500',
      };
    }
    if (text.includes('hold') || text.includes('neutral') || text.includes('中性') || text.includes('持有')) {
      return {
        label: language === 'cn' ? '持有' : 'Hold',
        className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500',
      };
    }

    return {
      label: language === 'cn' ? '未分类' : 'Unclassified',
      className: 'bg-slate-500/20 text-slate-300 border-slate-500',
    };
  };

  // Load report (set analysis state from result)
  const handleLoadReport = useCallback((job: QueueJob) => {
    if (job.result) {
      // Store result in localStorage and reload page to show it
      localStorage.setItem('intelligentStockAgentActiveState', JSON.stringify(job.result));
      window.location.reload();
    }
  }, []);

  return (
    <div className="max-w-6xl mx-auto py-8 fade-in">
      <div className="mb-8">
        <h1 className="text-4xl font-extrabold text-white mb-2">
          {language === 'en' ? 'Batch Analysis Queue' : '批量分析队列'}
        </h1>
        <p className="text-gray-400">
          {language === 'en' 
            ? 'Submit multiple tickers for background processing. You can close the browser and check back later.'
            : '提交多个股票代码进行后台处理。您可以关闭浏览器，稍后再回来查看。'
          }
        </p>
      </div>

      {/* Input Area */}
      <div className="bg-gray-800 rounded-lg p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">
          {language === 'en' ? 'Add Tickers to Queue' : '添加股票代码到队列'}
        </h2>
        <form onSubmit={handleSubmit}>
          <textarea
            value={tickersInput}
            onChange={(e) => setTickersInput(e.target.value)}
            placeholder={
              language === 'en'
                ? 'Enter tickers separated by commas or newlines'
                : '输入股票代码，用逗号或换行分隔'
            }
            className="w-full h-32 px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            disabled={isSubmitting}
          />
          {error && (
            <div className="mt-2 text-red-400 text-sm">{error}</div>
          )}
          <div className="mt-4 flex justify-between items-center">
            <button
              type="submit"
              disabled={isSubmitting || !tickersInput.trim()}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md text-white font-semibold transition-colors"
            >
              {isSubmitting
                ? (language === 'en' ? 'Submitting...' : '提交中...')
                : (language === 'en' ? 'Start Batch Analysis' : '开始批量分析')
              }
            </button>
            <button
              type="button"
              onClick={() => setLanguage(language === 'en' ? 'cn' : 'en')}
              className="px-4 py-2 text-sm font-medium text-gray-300 bg-gray-700 rounded-md hover:bg-gray-600 transition-colors"
            >
              {language === 'en' ? '中文' : 'English'}
            </button>
          </div>
        </form>
      </div>

      {/* Live Dashboard */}
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">
            {language === 'en' ? 'Queue Dashboard' : '队列仪表板'}
          </h2>
          <div className="flex gap-4 text-sm">
            <div className="text-center">
              <div className="text-lg font-bold text-yellow-400">{queueStatus?.stats.pending || 0}</div>
              <div className="text-gray-400">{language === 'en' ? 'Pending' : '等待'}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-blue-400">{queueStatus?.stats.processing || 0}</div>
              <div className="text-gray-400">{language === 'en' ? 'Processing' : '处理中'}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-green-400">{queueStatus?.stats.completed || 0}</div>
              <div className="text-gray-400">{language === 'en' ? 'Completed' : '已完成'}</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-red-400">{queueStatus?.stats.failed || 0}</div>
              <div className="text-gray-400">{language === 'en' ? 'Failed' : '失败'}</div>
            </div>
          </div>
        </div>

        {queueStatus && queueStatus.jobs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <colgroup>
                <col className="w-[8%]" />
                <col className="w-[14%]" />
                <col className="w-[10%]" />
                <col className="w-[15%]" />
                <col className="w-[16%]" />
                <col className="w-[13%]" />
                <col className="w-[13%]" />
                <col className="w-[11%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-2 text-gray-400 font-semibold">
                    {language === 'en' ? 'Ticker' : '股票代码'}
                  </th>
                  <th className="text-left py-3 px-2 text-gray-400 font-semibold">
                    {language === 'en' ? 'Company' : '公司名称'}
                  </th>
                  <th className="text-left py-3 px-2 text-gray-400 font-semibold">
                    {language === 'en' ? 'Price' : '股价'}
                  </th>
                  <th className="text-left py-3 px-2 text-gray-400 font-semibold">
                    {language === 'en' ? 'Conclusion' : '结论'}
                  </th>
                  <th className="text-left py-3 px-2 text-gray-400 font-semibold">
                    {language === 'en' ? 'Status & Progress' : '状态与进度'}
                  </th>
                  <th className="text-left py-3 px-2 text-gray-400 font-semibold">
                    {language === 'en' ? 'Created' : '创建时间'}
                  </th>
                  <th className="text-left py-3 px-2 text-gray-400 font-semibold">
                    {language === 'en' ? 'Completed' : '完成时间'}
                  </th>
                  <th className="text-left py-3 px-2 text-gray-400 font-semibold">
                    {language === 'en' ? 'Actions' : '操作'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {queueStatus.jobs.map((job) => (
                  <tr key={job.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-3 px-2 font-medium text-blue-400 truncate" title={job.ticker}>{job.ticker}</td>
                    <td className="py-3 px-2 text-gray-200 text-sm truncate" title={job.companyName || ''}>
                      {job.companyName || '-'}
                    </td>
                    <td className="py-3 px-2 text-gray-200 text-sm whitespace-nowrap truncate" title={formatPrice(job)}>
                      {formatPrice(job)}
                    </td>
                    <td className="py-3 px-2 text-gray-300 text-sm" title={job.overallConclusion || ''}>
                      {job.overallConclusion ? (
                        <div className="space-y-1">
                          {(() => {
                            const tag = getConclusionTag(job);
                            return tag ? (
                              <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border ${tag.className}`}>
                                {tag.label}
                              </span>
                            ) : null;
                          })()}
                          <div className="text-gray-400 text-xs truncate">{job.overallConclusion}</div>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="py-3 px-2">
                      <div className="space-y-2">
                        {/* Status Badge */}
                        <div className="flex items-center gap-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold border leading-tight ${getStatusBadgeClass(job.status)}`}>
                            {getStatusText(job.status)}
                          </span>
                          {job.status === 'PROCESSING' && job.progress !== undefined && (
                            <span className="text-xs text-gray-400">
                              {job.progress}%
                            </span>
                          )}
                        </div>
                        
                        {/* Progress Bar (only show for PROCESSING status) */}
                        {job.status === 'PROCESSING' && (
                          <>
                            <div className="w-full bg-gray-700 rounded-full h-2.5 overflow-hidden relative">
                              <div
                                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-500 ease-out"
                                style={{ width: `${job.progress || 0}%` }}
                              />
                              {/* Progress percentage overlay - only show if progress > 10% for readability */}
                              {job.progress !== undefined && job.progress > 10 && (
                                <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white pointer-events-none">
                                  {job.progress}%
                                </div>
                              )}
                            </div>
                            
                            {/* Current Step Text */}
                            {job.currentStep && (
                              <div className="text-xs text-gray-300 mt-1.5 truncate" title={job.currentStep}>
                                <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full mr-2 animate-pulse" />
                                {job.currentStep}
                              </div>
                            )}
                          </>
                        )}
                        
                        {/* Show progress for completed jobs */}
                        {job.status === 'COMPLETED' && job.progress !== undefined && job.progress > 0 && (
                          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                            <div
                              className="h-full bg-green-500"
                              style={{ width: '100%' }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-gray-400 text-sm truncate" title={formatDateTime(job.createdAt)}>
                      {formatDateTime(job.createdAt)}
                    </td>
                    <td className="py-3 px-2 text-gray-400 text-sm truncate" title={formatDateTime(job.completedAt)}>
                      {formatDateTime(job.completedAt)}
                    </td>
                    <td className="py-3 px-2">
                      {job.status === 'COMPLETED' && job.result ? (
                        <button
                          onClick={() => handleLoadReport(job)}
                          className="px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs text-white transition-colors whitespace-nowrap"
                        >
                          {language === 'en' ? 'View Report' : '查看报告'}
                        </button>
                      ) : (
                        <span className="text-gray-500 text-sm">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 text-gray-500">
            {language === 'en' 
              ? 'No jobs in queue. Submit tickers above to start batch analysis.'
              : '队列为空。在上方提交股票代码以开始批量分析。'
            }
          </div>
        )}

        {/* Auto-refresh indicator */}
        <div className="mt-4 text-center text-xs text-gray-500">
          {language === 'en' 
            ? '🔄 Auto-refreshing every 5 seconds'
            : '🔄 每 5 秒自动刷新'
          }
        </div>
      </div>
    </div>
  );
};
