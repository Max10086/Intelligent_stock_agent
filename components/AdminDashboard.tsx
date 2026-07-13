import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Language } from '../types.ts';
import type {
  AdminActivationStatus,
  AdminFeedbackResponse,
  AdminMetricsResponse,
  AdminUsersResponse,
} from '../types/admin.ts';
import { getUIText } from '../constants.ts';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';

interface AdminDashboardProps {
  language: Language;
  onBack: () => void;
}

type PeriodPreset = 7 | 30 | 90;

const ADMIN_USERS_POLL_MS = 30_000;

const formatDateTime = (value: string | null, language: Language): string => {
  if (!value) return '—';
  return new Date(value).toLocaleString(language === 'cn' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const periodLabel = (days: PeriodPreset, language: Language): string => {
  const ui = getUIText(language);
  if (days === 7) return ui.adminPeriod7d;
  if (days === 30) return ui.adminPeriod30d;
  return ui.adminPeriod90d;
};

const activationStatusLabel = (
  status: AdminActivationStatus,
  language: Language
): string => {
  const ui = getUIText(language);
  if (status === 'activated') return ui.adminActivationActivated;
  if (status === 'started_incomplete') return ui.adminActivationStarted;
  return ui.adminActivationNotStarted;
};

const activationStatusClass = (status: AdminActivationStatus): string => {
  if (status === 'activated') {
    return 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300';
  }
  if (status === 'started_incomplete') {
    return 'border-amber-700/50 bg-amber-950/40 text-amber-300';
  }
  return 'border-gray-700 bg-gray-900 text-gray-400';
};

const KpiCard: React.FC<{ label: string; value: string | number; hint?: string; loading?: boolean }> = ({
  label,
  value,
  hint,
  loading,
}) => (
  <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
    <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
    {loading ? (
      <div className="mt-2 h-8 w-20 animate-pulse rounded bg-gray-800" />
    ) : (
      <p className="mt-2 text-2xl font-semibold text-gray-100">{value}</p>
    )}
    {hint && !loading && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
  </div>
);

const TrendBars: React.FC<{
  title: string;
  rows: Array<{ date: string; count: number }>;
  loading?: boolean;
}> = ({ title, rows, loading }) => (
  <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
    <h3 className="mb-3 text-sm font-medium text-gray-200">{title}</h3>
    {loading ? (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-4 animate-pulse rounded bg-gray-800" />
        ))}
      </div>
    ) : rows.length === 0 ? (
      <p className="text-sm text-gray-500">—</p>
    ) : (
      <div className="space-y-2">
        {rows.slice(-14).map(row => {
          const max = Math.max(1, ...rows.map(r => r.count));
          return (
            <div key={row.date} className="grid grid-cols-[72px_1fr_36px] items-center gap-2 text-xs">
              <span className="text-gray-500">{row.date.slice(5)}</span>
              <div className="h-2 rounded bg-gray-800">
                <div
                  className="h-2 rounded bg-blue-500"
                  style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}
                />
              </div>
              <span className="text-right text-gray-300">{row.count}</span>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

const SectionSkeleton: React.FC<{ rows?: number }> = ({ rows = 4 }) => (
  <div className="space-y-2">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className="h-10 animate-pulse rounded bg-gray-800" />
    ))}
  </div>
);

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ language, onBack }) => {
  const ui = getUIText(language);
  const [periodDays, setPeriodDays] = useState<PeriodPreset>(30);
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null);
  const [users, setUsers] = useState<AdminUsersResponse | null>(null);
  const [feedback, setFeedback] = useState<AdminFeedbackResponse | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [usersRefreshing, setUsersRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDoneRef = useRef(false);

  const queryRange = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - periodDays * 24 * 60 * 60 * 1000);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
    };
  }, [periodDays]);

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        from: queryRange.from,
        to: queryRange.to,
      });
      const response = await apiFetch(`/api/admin/metrics?${params.toString()}`);
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      setMetrics((await response.json()) as AdminMetricsResponse);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : ui.adminError);
    } finally {
      setMetricsLoading(false);
    }
  }, [queryRange.from, queryRange.to, ui.adminError]);

  const loadUsers = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setUsersLoading(true);
    } else {
      setUsersRefreshing(true);
    }
    try {
      const response = await apiFetch('/api/admin/users?limit=50');
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      setUsers((await response.json()) as AdminUsersResponse);
    } catch (loadError) {
      if (!silent) {
        setError(prev => prev ?? (loadError instanceof Error ? loadError.message : ui.adminError));
      }
    } finally {
      if (!silent) {
        setUsersLoading(false);
      } else {
        setUsersRefreshing(false);
      }
    }
  }, [ui.adminError]);

  const loadFeedback = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setFeedbackLoading(true);
    }
    try {
      const response = await apiFetch('/api/admin/feedback?limit=30');
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      setFeedback((await response.json()) as AdminFeedbackResponse);
    } catch (loadError) {
      if (!silent) {
        setError(prev => prev ?? (loadError instanceof Error ? loadError.message : ui.adminError));
      }
    } finally {
      if (!silent) {
        setFeedbackLoading(false);
      }
    }
  }, [ui.adminError]);

  const loadAllData = useCallback(async () => {
    await Promise.all([loadMetrics(), loadUsers(), loadFeedback()]);
  }, [loadFeedback, loadMetrics, loadUsers]);

  useEffect(() => {
    if (!initialLoadDoneRef.current) {
      initialLoadDoneRef.current = true;
      void loadAllData();
      return;
    }
    void loadMetrics();
  }, [loadAllData, loadMetrics]);

  useEffect(() => {
    const refreshLiveSections = () => {
      void loadUsers({ silent: true });
      void loadFeedback({ silent: true });
    };

    const intervalId = window.setInterval(refreshLiveSections, ADMIN_USERS_POLL_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshLiveSections();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadFeedback, loadUsers]);

  const funnelSteps = metrics
    ? [
        { label: ui.adminFunnelRegistered, value: metrics.funnel.registered },
        { label: ui.adminFunnelActivated, value: metrics.funnel.activated },
        { label: ui.adminFunnelHitPaywall, value: metrics.funnel.hitPaywall },
        { label: ui.adminFunnelPaid, value: metrics.funnel.paid },
      ]
    : [];

  const showInitialLoading = metricsLoading && !metrics;
  const showPeriodRefreshing = metricsLoading && Boolean(metrics);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 bg-gray-900/80">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold">{ui.adminTitle}</h1>
            <p className="text-sm text-gray-400">
              {new Date(queryRange.from).toLocaleDateString()} –{' '}
              {new Date(queryRange.to).toLocaleDateString()}
            </p>
            {showPeriodRefreshing && (
              <p className="mt-1 flex items-center gap-2 text-xs text-blue-300">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-blue-300 border-t-transparent" />
                {ui.adminRefreshingPeriod} ({periodLabel(periodDays, language)})
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md bg-gray-800 p-1">
              {[7, 30, 90].map(days => (
                <button
                  key={days}
                  type="button"
                  disabled={metricsLoading}
                  onClick={() => setPeriodDays(days as PeriodPreset)}
                  className={`rounded px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    periodDays === days ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white'
                  }`}
                >
                  {days === 7 ? ui.adminPeriod7d : days === 30 ? ui.adminPeriod30d : ui.adminPeriod90d}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={metricsLoading || usersLoading || feedbackLoading}
              onClick={() => void loadAllData()}
              className="rounded-md bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ui.adminRefresh}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-md bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
            >
              {ui.adminBack}
            </button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {showInitialLoading && (
          <p className="text-sm text-gray-400">{ui.adminLoading}</p>
        )}
        {error && (
          <div className="rounded-lg border border-red-700/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div
          className={`space-y-6 transition-opacity duration-200 ${
            showPeriodRefreshing ? 'opacity-60' : 'opacity-100'
          }`}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label={ui.adminKpiSignups}
              value={metrics?.growth.signups ?? '—'}
              loading={metricsLoading}
            />
            <KpiCard
              label={ui.adminKpiActivated}
              value={metrics?.growth.activatedInPeriod ?? '—'}
              loading={metricsLoading}
            />
            <KpiCard
              label={ui.adminKpiWau}
              value={metrics?.growth.wau ?? '—'}
              loading={metricsLoading}
            />
            <KpiCard
              label={ui.adminKpiNewPaid}
              value={metrics?.revenue.newPaidUsers ?? '—'}
              hint={
                metrics && !metricsLoading
                  ? `${ui.adminKpiTotalPaid}: ${metrics.revenue.totalPaidUsers}`
                  : undefined
              }
              loading={metricsLoading}
            />
            <KpiCard
              label={ui.adminKpiConversion}
              value={metrics ? formatPercent(metrics.revenue.conversionRate) : '—'}
              loading={metricsLoading}
            />
            <KpiCard
              label={ui.adminKpiAnalyses}
              value={metrics?.usage.analysesInPeriod ?? '—'}
              loading={metricsLoading}
            />
            <KpiCard
              label={ui.adminTopTickers}
              value={metrics?.usage.topTickers[0]?.ticker || '—'}
              hint={
                metrics?.usage.topTickers[0] && !metricsLoading
                  ? `${metrics.usage.topTickers[0].count} analyses`
                  : undefined
              }
              loading={metricsLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
              <h3 className="mb-4 text-sm font-medium text-gray-200">{ui.adminFunnelTitle}</h3>
              {metricsLoading ? (
                <SectionSkeleton rows={4} />
              ) : metrics ? (
                <div className="space-y-3">
                  {funnelSteps.map(step => {
                    const base = metrics.funnel.registered || 1;
                    const pct = Math.round((step.value / base) * 100);
                    return (
                      <div key={step.label}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="text-gray-300">{step.label}</span>
                          <span className="text-gray-400">
                            {step.value} ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 rounded bg-gray-800">
                          <div
                            className="h-2 rounded bg-emerald-500"
                            style={{ width: `${Math.max(4, pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <TrendBars
              title={`${ui.adminTrendsTitle} · ${ui.adminKpiSignups}`}
              rows={metrics?.trends.signupsByDay ?? []}
              loading={metricsLoading}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <TrendBars
              title={`${ui.adminTrendsTitle} · ${ui.adminKpiNewPaid}`}
              rows={metrics?.trends.paidByDay ?? []}
              loading={metricsLoading}
            />
            <TrendBars
              title={`${ui.adminTrendsTitle} · ${ui.adminKpiAnalyses}`}
              rows={metrics?.trends.analysesByDay ?? []}
              loading={metricsLoading}
            />
          </div>
        </div>

        <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium text-gray-200">{ui.adminUsersTitle}</h3>
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>{ui.adminUsersAllTime}</span>
              <span>·</span>
              <span>{ui.adminUsersAutoRefresh}</span>
              {usersRefreshing && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1 text-blue-300">
                    <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-blue-300 border-t-transparent" />
                    {ui.adminUsersRefreshing}
                  </span>
                </>
              )}
            </div>
          </div>
          {usersLoading && !users ? (
            <SectionSkeleton rows={6} />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">{ui.adminColEmail}</th>
                    <th className="px-3 py-2">{ui.adminColRegistered}</th>
                    <th className="px-3 py-2">{ui.adminColAnalyses}</th>
                    <th className="px-3 py-2">{ui.adminColActivation}</th>
                    <th className="px-3 py-2">{ui.adminColPaid}</th>
                    <th className="px-3 py-2">{ui.adminColLastActive}</th>
                  </tr>
                </thead>
                <tbody>
                  {(users?.users ?? []).map(user => (
                    <tr key={user.id} className="border-t border-gray-800 text-gray-300">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-100">{user.email}</div>
                        {user.isAdmin && (
                          <span className="text-xs text-amber-400">admin</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{formatDateTime(user.createdAt, language)}</td>
                      <td className="px-3 py-2">{user.totalAnalyses}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${activationStatusClass(user.activationStatus)}`}
                        >
                          {activationStatusLabel(user.activationStatus, language)}
                        </span>
                      </td>
                      <td className="px-3 py-2">{user.isPaid ? '✓' : '—'}</td>
                      <td className="px-3 py-2">{formatDateTime(user.lastActiveAt, language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-700 bg-gray-900/70 p-4">
          <h3 className="mb-4 text-sm font-medium text-gray-200">{ui.adminFeedbackTitle}</h3>
          {feedbackLoading && !feedback ? (
            <SectionSkeleton rows={3} />
          ) : !feedback?.items.length ? (
            <p className="text-sm text-gray-500">{ui.adminNoFeedback}</p>
          ) : (
            <div className="space-y-3">
              {feedback.items.map(item => (
                <div key={item.id} className="rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="rounded bg-gray-800 px-2 py-0.5 text-gray-300">{item.category}</span>
                    <span>{item.userEmail}</span>
                    {item.userIsPaid && <span className="text-amber-400">paid</span>}
                    {item.rating && <span>★ {item.rating}</span>}
                    <span>{formatDateTime(item.createdAt, language)}</span>
                  </div>
                  <p className="mt-2 text-sm text-gray-200 whitespace-pre-wrap">{item.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
