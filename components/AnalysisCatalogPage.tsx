import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Language, AnalysisState } from '../types.ts';
import { getUIText } from '../constants.ts';
import { AnalysisCatalogItem, useAnalysisCatalog } from '../hooks/useAnalysisCatalog.ts';
import { useCatalogCumulativeReturns } from '../hooks/useCatalogCumulativeReturns.ts';
import { apiFetch } from '../utils/authenticatedFetch.ts';
import { CumulativeReturnCell } from './CumulativeReturnCell.tsx';
import {
  CATALOG_DISPLAY_CATEGORIES,
  classifyConclusion,
  getCatalogCategoryLabelKey,
  getConclusionTagStyle,
  type ConclusionCategory,
} from '../utils/conclusionCategory.ts';
import { downloadTextFile } from '../utils/downloadTextFile.ts';
import {
  buildCategoryTxtFilename,
  buildReportTxtFilename,
  formatAnalysisStateAsText,
  formatCategoryReportsAsText,
} from '../utils/reportTextExport.ts';
import { BrandMark } from './BrandMark.tsx';
import { ArrowPathIcon } from './icons.tsx';

interface AnalysisCatalogPageProps {
  language: Language;
  userId?: string | null;
  onLoadReport?: (payload: { id: string; result: AnalysisState }) => void;
}

const ACTIVE_CATEGORY_KEY_PREFIX = 'intelligent-stock-agent:catalog-active-category-v1';

const readStoredActiveCategory = (userId: string | null): ConclusionCategory | null => {
  if (!userId) return null;
  try {
    const raw = sessionStorage.getItem(`${ACTIVE_CATEGORY_KEY_PREFIX}:${userId}`);
    if (!raw) return null;
    if (
      raw === 'strong_buy' ||
      raw === 'buy' ||
      raw === 'overweight' ||
      raw === 'hold' ||
      raw === 'sell' ||
      raw === 'other'
    ) {
      return raw;
    }
  } catch {
    // ignore
  }
  return null;
};

const writeStoredActiveCategory = (userId: string | null, category: ConclusionCategory) => {
  if (!userId) return;
  try {
    sessionStorage.setItem(`${ACTIVE_CATEGORY_KEY_PREFIX}:${userId}`, category);
  } catch {
    // ignore
  }
};

const cardShellClass =
  'rounded-2xl border border-gray-600/80 bg-gray-800/60 shadow-[0_8px_32px_rgba(0,0,0,0.35)]';

const StatCard: React.FC<{
  label: string;
  value: number;
  active: boolean;
  tone: 'emerald' | 'green' | 'teal' | 'yellow' | 'red';
  onClick: () => void;
}> = ({ label, value, active, tone, onClick }) => {
  const toneClass = {
    emerald: active
      ? 'border-emerald-400/60 bg-emerald-950/40 text-emerald-200 ring-1 ring-emerald-400/40'
      : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/30',
    green: active
      ? 'border-green-400/60 bg-green-950/40 text-green-200 ring-1 ring-green-400/40'
      : 'border-green-500/30 bg-green-950/20 text-green-300 hover:bg-green-950/30',
    teal: active
      ? 'border-teal-400/60 bg-teal-950/40 text-teal-200 ring-1 ring-teal-400/40'
      : 'border-teal-500/30 bg-teal-950/20 text-teal-300 hover:bg-teal-950/30',
    yellow: active
      ? 'border-yellow-400/60 bg-yellow-950/40 text-yellow-200 ring-1 ring-yellow-400/40'
      : 'border-yellow-500/30 bg-yellow-950/20 text-yellow-300 hover:bg-yellow-950/30',
    red: active
      ? 'border-red-400/60 bg-red-950/40 text-red-200 ring-1 ring-red-400/40'
      : 'border-red-500/30 bg-red-950/20 text-red-300 hover:bg-red-950/30',
  }[tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-center transition-colors cursor-pointer ${toneClass}`}
    >
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-gray-400">{label}</div>
    </button>
  );
};

function getCategoryTone(
  category: (typeof CATALOG_DISPLAY_CATEGORIES)[number]
): 'emerald' | 'green' | 'teal' | 'yellow' | 'red' {
  switch (category) {
    case 'strong_buy':
      return 'emerald';
    case 'buy':
      return 'green';
    case 'overweight':
      return 'teal';
    case 'hold':
      return 'yellow';
    case 'sell':
      return 'red';
    default:
      return 'green';
  }
}

function formatDateTime(dateString: string | null, language: Language) {
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
}

function formatPrice(item: AnalysisCatalogItem) {
  if (!item.currentPrice || item.currentPrice === '0.00') return '-';

  const inferCurrencyCode = () => {
    const rawCurrency = (item.currency || '').trim();
    if (rawCurrency) return rawCurrency.toUpperCase();

    const ticker = (item.ticker || '').toUpperCase();
    const exchange = (item.exchange || '').toUpperCase();

    if (exchange.includes('NASDAQ') || exchange.includes('NYSE') || ticker.startsWith('US.')) {
      return 'USD';
    }
    if (exchange.includes('HK') || ticker.startsWith('HK.')) {
      return 'HKD';
    }
    if (
      exchange.includes('SSE') ||
      exchange.includes('SZSE') ||
      ticker.startsWith('SH') ||
      ticker.startsWith('SZ')
    ) {
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
    return `${symbol}${item.currentPrice}`;
  }

  if (item.currency) {
    return `${item.currentPrice} ${item.currency}`;
  }
  return item.currentPrice;
}

export const AnalysisCatalogPage: React.FC<AnalysisCatalogPageProps> = ({
  language,
  userId = null,
  onLoadReport,
}) => {
  const uiText = getUIText(language);
  const {
    items,
    total,
    loading,
    loadingInitial,
    loadingMore,
    error,
    hasMore,
    groupedByCategory,
    categoryCounts,
    defaultCategory,
    refresh,
  } = useAnalysisCatalog(userId);
  const { returnsById, reload: reloadReturns } = useCatalogCumulativeReturns(items);

  const handleRefresh = useCallback(() => {
    reloadReturns();
    void refresh();
  }, [reloadReturns, refresh]);

  const storedCategory = readStoredActiveCategory(userId);
  const [activeCategory, setActiveCategory] = useState<ConclusionCategory>(
    () => storedCategory ?? defaultCategory
  );
  const [loadingReportId, setLoadingReportId] = useState<string | null>(null);
  const [downloadingReportId, setDownloadingReportId] = useState<string | null>(null);
  const [downloadingCategory, setDownloadingCategory] = useState(false);
  const [categoryDownloadProgress, setCategoryDownloadProgress] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasSetInitialCategory = useRef(false);

  useEffect(() => {
    if (loadingInitial) return;
    if (storedCategory) return;
    if (hasSetInitialCategory.current) return;
    hasSetInitialCategory.current = true;
    setActiveCategory(defaultCategory);
  }, [loadingInitial, defaultCategory, storedCategory]);

  const handleSelectCategory = useCallback(
    (category: ConclusionCategory) => {
      setActiveCategory(category);
      writeStoredActiveCategory(userId, category);
    },
    [userId]
  );

  const activeItems = groupedByCategory[activeCategory];

  const fetchAnalysisReport = useCallback(
    async (id: string): Promise<AnalysisState> => {
      const response = await apiFetch(`/api/jobs/${id}`);
      if (!response.ok) {
        throw new Error(uiText.batchLoadReportError);
      }
      const data = await response.json();
      if (!data.result) {
        throw new Error(uiText.batchEmptyReport);
      }
      return { ...(data.result as AnalysisState), id };
    },
    [uiText]
  );

  const handleLoadReport = useCallback(
    async (item: AnalysisCatalogItem) => {
      if (!onLoadReport) return;
      setLoadingReportId(item.id);
      setLoadError(null);
      try {
        const result = await fetchAnalysisReport(item.id);
        onLoadReport({ id: item.id, result });
      } catch (err) {
        console.error('Error loading catalog report:', err);
        setLoadError(err instanceof Error ? err.message : uiText.batchLoadReportError);
      } finally {
        setLoadingReportId(null);
      }
    },
    [fetchAnalysisReport, onLoadReport, uiText]
  );

  const handleDownloadReport = useCallback(
    async (item: AnalysisCatalogItem) => {
      setDownloadingReportId(item.id);
      setLoadError(null);
      try {
        const result = await fetchAnalysisReport(item.id);
        const content = formatAnalysisStateAsText(result, language);
        const filename = buildReportTxtFilename(item.ticker, item.companyName, item.completedAt);
        downloadTextFile(filename, content);
      } catch (err) {
        console.error('Error downloading catalog report:', err);
        setLoadError(err instanceof Error ? err.message : uiText.catalogDownloadError);
      } finally {
        setDownloadingReportId(null);
      }
    },
    [fetchAnalysisReport, language, uiText]
  );

  const handleDownloadCategory = useCallback(async () => {
    if (activeItems.length === 0 || downloadingCategory) return;

    setDownloadingCategory(true);
    setCategoryDownloadProgress(null);
    setLoadError(null);

    try {
      const reports: Array<{ ticker: string; companyName: string | null; content: string }> = [];

      for (let index = 0; index < activeItems.length; index += 1) {
        const item = activeItems[index];
        setCategoryDownloadProgress(
          uiText.catalogDownloadCategoryProgress
            .replace('{current}', String(index + 1))
            .replace('{total}', String(activeItems.length))
        );
        const result = await fetchAnalysisReport(item.id);
        reports.push({
          ticker: item.ticker,
          companyName: item.companyName,
          content: formatAnalysisStateAsText(result, language),
        });
      }

      const content = formatCategoryReportsAsText({
        category: activeCategory,
        language,
        reports,
      });
      downloadTextFile(buildCategoryTxtFilename(activeCategory, language), content);
    } catch (err) {
      console.error('Error downloading category reports:', err);
      setLoadError(err instanceof Error ? err.message : uiText.catalogDownloadError);
    } finally {
      setDownloadingCategory(false);
      setCategoryDownloadProgress(null);
    }
  }, [
    activeCategory,
    activeItems,
    downloadingCategory,
    fetchAnalysisReport,
    language,
    uiText,
  ]);

  const loadedCountLabel = (() => {
    if (items.length === 0) return '';
    if (total != null) {
      return uiText.catalogTotalCountWithTotal
        .replace('{count}', String(items.length))
        .replace('{total}', String(total));
    }
    return uiText.catalogTotalCount.replace('{count}', String(items.length));
  })();

  return (
    <section className="w-full max-w-6xl mx-auto px-2 sm:px-4 py-8 sm:py-10 fade-in">
      <BrandMark language={language} variant="hero" />
      <p className="mt-6 sm:mt-8 text-center text-base sm:text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
        {uiText.catalogSubtitle}
      </p>

      <div className={`${cardShellClass} p-4 sm:p-6 mt-8 sm:mt-10`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-100">{uiText.catalogTitle}</h2>
            <button
              type="button"
              onClick={() => handleRefresh()}
              disabled={loadingInitial || loadingMore}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-900/50 hover:bg-gray-700/60 text-gray-300 transition-colors disabled:opacity-50"
              title={uiText.catalogRefresh}
            >
              <ArrowPathIcon className={`h-3.5 w-3.5 ${loadingInitial || loadingMore ? 'animate-spin' : ''}`} />
              {uiText.catalogRefresh}
            </button>
          </div>
          {!loadingInitial && items.length > 0 && (
            <p className="text-sm text-gray-400">
              {loadedCountLabel}
              {hasMore && loadingMore ? ` · ${uiText.catalogHasMore}` : ''}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
          {CATALOG_DISPLAY_CATEGORIES.map(category => (
            <StatCard
              key={category}
              label={uiText[getCatalogCategoryLabelKey(category)]}
              value={categoryCounts[category]}
              active={activeCategory === category}
              tone={getCategoryTone(category)}
              onClick={() => handleSelectCategory(category)}
            />
          ))}
        </div>

        {error && <div className="mb-4 text-sm text-red-400">{error}</div>}
        {loadError && <div className="mb-4 text-sm text-red-400">{loadError}</div>}

        {loadingInitial ? (
          <div className="py-16 text-center text-gray-400">{uiText.catalogLoading}</div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-gray-400">{uiText.catalogEmpty}</div>
        ) : activeItems.length === 0 ? (
          <div className="py-16 text-center text-gray-400">{uiText.catalogEmptyCategory}</div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <p className="text-sm text-gray-400">
                {uiText[getCatalogCategoryLabelKey(activeCategory)]}
                {' · '}
                {activeItems.length}
              </p>
              <div className="flex flex-col items-start sm:items-end gap-1">
                <button
                  type="button"
                  onClick={() => void handleDownloadCategory()}
                  disabled={downloadingCategory || downloadingReportId !== null}
                  className="inline-flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-900/50 hover:bg-gray-700/60 text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {downloadingCategory ? uiText.catalogDownloadingCategory : uiText.catalogDownloadCategory}
                </button>
                {categoryDownloadProgress && (
                  <span className="text-xs text-gray-500">{categoryDownloadProgress}</span>
                )}
                {hasMore && (
                  <span className="text-xs text-gray-500">
                    {uiText.catalogDownloadCategoryPartial.replace('{count}', String(activeItems.length))}
                  </span>
                )}
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-700/80">
            <table className="w-full min-w-[820px]">
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
                    {uiText.catalogColCumulativeReturn}
                  </th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.batchColConclusion}
                  </th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.catalogColAnalyzedAt}
                  </th>
                  <th className="text-left py-3 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {uiText.batchColActions}
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map(item => {
                  const itemCategory = classifyConclusion(item.overallConclusion);
                  const tagStyle = getConclusionTagStyle(itemCategory);
                  const tagLabel = uiText[tagStyle.labelKey];

                  return (
                    <tr
                      key={item.id}
                      className="border-b border-gray-700/50 hover:bg-gray-700/20 transition-colors"
                    >
                      <td
                        className="py-3 px-3 font-semibold text-blue-400 truncate max-w-[7rem]"
                        title={item.ticker}
                      >
                        {item.ticker}
                      </td>
                      <td
                        className="py-3 px-3 text-gray-200 text-sm truncate max-w-[10rem]"
                        title={item.companyName || ''}
                      >
                        {item.companyName || '-'}
                      </td>
                      <td
                        className="py-3 px-3 text-gray-200 text-sm whitespace-nowrap"
                        title={formatPrice(item)}
                      >
                        {formatPrice(item)}
                      </td>
                      <td className="py-3 px-3 text-sm whitespace-nowrap">
                        <CumulativeReturnCell
                          display={returnsById[item.id]}
                          loadingLabel={uiText.catalogReturnLoading}
                        />
                      </td>
                      <td
                        className="py-3 px-3 text-gray-300 text-sm min-w-[8rem]"
                        title={item.overallConclusion || ''}
                      >
                        {item.overallConclusion ? (
                          <div className="space-y-1">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold border ${tagStyle.className}`}
                            >
                              {tagLabel}
                            </span>
                            <div className="text-gray-400 text-xs line-clamp-2">
                              {item.overallConclusion}
                            </div>
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td
                        className="py-3 px-3 text-gray-400 text-sm whitespace-nowrap"
                        title={formatDateTime(item.completedAt, language)}
                      >
                        {formatDateTime(item.completedAt, language)}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleLoadReport(item)}
                            disabled={loadingReportId === item.id || downloadingReportId === item.id}
                            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {loadingReportId === item.id
                              ? uiText.batchLoadingReport
                              : uiText.batchViewReport}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDownloadReport(item)}
                            disabled={
                              downloadingReportId === item.id ||
                              loadingReportId === item.id ||
                              downloadingCategory
                            }
                            className="text-xs px-3 py-1.5 rounded-lg border border-gray-600 bg-gray-900/50 hover:bg-gray-700/60 text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {downloadingReportId === item.id
                              ? uiText.catalogDownloadingTxt
                              : uiText.catalogDownloadTxt}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

        {!loadingInitial && loadingMore && (
          <p className="mt-4 text-center text-sm text-gray-500">{uiText.catalogLoadingMore}</p>
        )}

        {categoryCounts.other > 0 && (
          <p className="mt-4 text-xs text-gray-500">
            {uiText.catalogOtherCount.replace('{count}', String(categoryCounts.other))}
          </p>
        )}
      </div>
    </section>
  );
};
