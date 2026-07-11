import React, { useMemo } from 'react';
import type { Language } from '../types.ts';
import { getUIText } from '../constants.ts';
import { QueueListIcon } from './icons.tsx';

export interface BatchJobStatusSnapshot {
  batchJobId: string;
  overallStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  stats: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  jobs: Array<{
    id: string;
    ticker: string;
    status: string;
  }>;
}

interface BatchJobStatusPanelProps {
  language: Language;
  status: BatchJobStatusSnapshot;
  isPolling?: boolean;
  onViewQueue: () => void;
  onDismiss: () => void;
}

const cardShellClass =
  'rounded-2xl border border-gray-600/80 bg-gray-800/60 shadow-[0_8px_32px_rgba(0,0,0,0.35)]';

const StatCard: React.FC<{
  label: string;
  value: number;
  tone: 'slate' | 'yellow' | 'blue' | 'green' | 'red';
}> = ({ label, value, tone }) => {
  const toneClass = {
    slate: 'border-gray-500/30 bg-gray-900/40 text-gray-200',
    yellow: 'border-yellow-500/30 bg-yellow-950/20 text-yellow-300',
    blue: 'border-blue-500/30 bg-blue-950/20 text-blue-300',
    green: 'border-green-500/30 bg-green-950/20 text-green-300',
    red: 'border-red-500/30 bg-red-950/20 text-red-300',
  }[tone];

  return (
    <div className={`rounded-xl border px-4 py-4 sm:py-5 text-center ${toneClass}`}>
      <div className="text-3xl sm:text-4xl font-bold tabular-nums">{value}</div>
      <div className="mt-1.5 text-xs sm:text-sm text-gray-400">{label}</div>
    </div>
  );
};

const statusBadgeClass = (status: string) => {
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

export const BatchJobStatusPanel: React.FC<BatchJobStatusPanelProps> = ({
  language,
  status,
  isPolling = false,
  onViewQueue,
  onDismiss,
}) => {
  const ui = getUIText(language);

  const statusLabel = (jobStatus: string) => {
    switch (jobStatus) {
      case 'COMPLETED':
        return ui.batchJobCompleted;
      case 'PROCESSING':
        return ui.batchJobProcessing;
      case 'FAILED':
        return ui.batchJobFailed;
      case 'PENDING':
      default:
        return ui.batchJobPending;
    }
  };

  const overallLabel = statusLabel(status.overallStatus);
  const finishedCount = status.stats.completed + status.stats.failed;
  const progressPercent =
    status.stats.total > 0 ? Math.round((finishedCount / status.stats.total) * 100) : 0;

  const progressLabel = ui.batchJobProgressLabel
    .replace('{done}', String(finishedCount))
    .replace('{total}', String(status.stats.total));

  const sortedJobs = useMemo(
    () =>
      [...status.jobs].sort((a, b) => {
        const order = (s: string) =>
          s === 'PROCESSING' ? 0 : s === 'PENDING' ? 1 : s === 'FAILED' ? 2 : 3;
        return order(a.status) - order(b.status) || a.ticker.localeCompare(b.ticker);
      }),
    [status.jobs]
  );

  return (
    <section className="w-full max-w-6xl mx-auto px-2 sm:px-4 py-10 sm:py-14 fade-in flex-1 flex flex-col justify-center">
      <div className="text-center mb-8 sm:mb-10">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl border border-blue-500/30 bg-blue-950/30 mb-4">
          <QueueListIcon className="h-7 w-7 text-blue-400" />
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          {ui.batchJobStatusTitle}
        </h1>
        <p className="mt-3 text-base sm:text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
          {ui.batchJobStatusSubtitle}
        </p>
      </div>

      <div className={`${cardShellClass} p-5 sm:p-8`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <p className="text-sm text-gray-400">{language === 'cn' ? '当前状态' : 'Overall status'}</p>
            <span
              className={`mt-2 inline-block px-3 py-1 rounded-lg text-sm font-semibold border ${statusBadgeClass(status.overallStatus)}`}
            >
              {overallLabel}
            </span>
          </div>
          <p className="text-sm sm:text-base text-gray-300 tabular-nums">{progressLabel}</p>
        </div>

        <div className="mb-8">
          <div className="flex justify-between items-center mb-2 text-sm">
            <span className="text-gray-400">{language === 'cn' ? '整体进度' : 'Overall progress'}</span>
            <span className="font-semibold text-gray-200 tabular-nums">{progressPercent}%</span>
          </div>
          <div className="h-3 sm:h-3.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-sky-400 transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4 mb-8">
          <StatCard label={ui.batchStatTotal} value={status.stats.total} tone="slate" />
          <StatCard label={ui.batchStatPending} value={status.stats.pending} tone="yellow" />
          <StatCard label={ui.batchStatProcessing} value={status.stats.processing} tone="blue" />
          <StatCard label={ui.batchStatCompleted} value={status.stats.completed} tone="green" />
          <StatCard label={ui.batchStatFailed} value={status.stats.failed} tone="red" />
        </div>

        {sortedJobs.length > 0 && (
          <div className="mb-8 rounded-xl border border-gray-700/80 bg-gray-900/30 p-4 sm:p-5">
            <p className="text-sm font-semibold text-gray-300 mb-3">
              {language === 'cn' ? '本批股票' : 'This batch'}
            </p>
            <div className="flex flex-wrap gap-2">
              {sortedJobs.map(job => (
                <span
                  key={job.id}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm ${statusBadgeClass(job.status)}`}
                >
                  <span className="font-semibold">{job.ticker}</span>
                  <span className="text-xs opacity-90">{statusLabel(job.status)}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {isPolling && (
          <div className="mb-6 flex items-center justify-center gap-2 text-sm text-gray-400">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-blue-400" />
            {ui.batchJobPollingHint}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
          <button
            type="button"
            onClick={onViewQueue}
            className="flex-1 px-6 py-3.5 sm:py-4 rounded-xl text-base font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors"
          >
            {ui.batchJobViewQueue}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 px-6 py-3.5 sm:py-4 rounded-xl text-base font-semibold text-gray-200 bg-gray-700/80 hover:bg-gray-600 border border-gray-600 transition-colors"
          >
            {ui.batchJobCloseStatus}
          </button>
        </div>
      </div>
    </section>
  );
};
