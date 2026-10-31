import React, { useMemo, useState } from 'react';
import type { Language } from '../../types.ts';
import type { ThirteenFTrackerState } from '../../hooks/useThirteenFTracker.ts';
import type {
  ThirteenFConsensusSector,
  ThirteenFConsensusStock,
} from '../../types/thirteenF.ts';
import { getUIText } from '../../constants.ts';
import { resolveInstitutionCik } from '../../utils/thirteenFInstitutionSearch.ts';
import {
  CHANGE_BADGE_CLASS,
  deltaTextClass,
  formatUsdCompact,
} from '../../utils/thirteenFFormat.ts';
import {
  CONSENSUS_LIST_PREVIEW,
  sortSectorsByPriority,
  sortStocksByPriority,
  splitByDirection,
  topConsensusStocks,
} from '../../utils/thirteenFConsensus.ts';
import { ConsensusStockBubbleChart } from './charts/ConsensusStockBubbleChart.tsx';
import { ConsensusSectorBarChart } from './charts/ConsensusSectorBarChart.tsx';

interface AggregateDashboardPanelProps {
  language: Language;
  tracker: ThirteenFTrackerState;
}

const HighlightCard: React.FC<{
  stock: ThirteenFConsensusStock;
  buyLabel: string;
  sellLabel: string;
  institutionsLabel: string;
}> = ({ stock, buyLabel, sellLabel, institutionsLabel }) => (
  <div className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2.5">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
            stock.direction === 'BUY' ? CHANGE_BADGE_CLASS.ADD : CHANGE_BADGE_CLASS.REDUCE
          }`}
        >
          {stock.direction === 'BUY' ? buyLabel : sellLabel}
        </span>
        <span className="font-semibold text-gray-100">{stock.ticker}</span>
      </div>
      <span className="shrink-0 text-xs text-gray-500">
        {stock.institutionCount} {institutionsLabel}
      </span>
    </div>
    <p className="mt-1 truncate text-xs text-gray-500">{stock.name}</p>
    <p className={`mt-1 text-sm font-medium ${deltaTextClass(stock.netMarketValueDeltaUsd)}`}>
      {formatUsdCompact(stock.netMarketValueDeltaUsd)}
    </p>
  </div>
);

const StockConsensusRow: React.FC<{ stock: ThirteenFConsensusStock; rank: number }> = ({
  stock,
  rank,
}) => (
  <div className="flex items-start gap-3 rounded-md border border-gray-800/80 bg-gray-950/30 px-3 py-2">
    <span className="mt-0.5 w-5 shrink-0 text-xs font-medium text-gray-600">{rank}</span>
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-medium text-gray-100">{stock.ticker}</span>
        <span className="truncate text-xs text-gray-500">{stock.name}</span>
      </div>
      <p className="mt-0.5 text-xs text-gray-600">{stock.sector}</p>
      <p className="mt-1 truncate text-xs text-gray-500">
        {stock.institutions.map(inst => inst.name).join(' · ')}
      </p>
    </div>
    <div className="shrink-0 text-right">
      <p className={`text-sm font-medium ${deltaTextClass(stock.netMarketValueDeltaUsd)}`}>
        {formatUsdCompact(stock.netMarketValueDeltaUsd)}
      </p>
      <p className="mt-0.5 text-xs text-gray-600">{stock.institutionCount}</p>
    </div>
  </div>
);

const SectorConsensusRow: React.FC<{ sector: ThirteenFConsensusSector; rank: number }> = ({
  sector,
  rank,
}) => (
  <div className="flex items-start gap-3 rounded-md border border-gray-800/80 bg-gray-950/30 px-3 py-2">
    <span className="mt-0.5 w-5 shrink-0 text-xs font-medium text-gray-600">{rank}</span>
    <div className="min-w-0 flex-1">
      <p className="font-medium text-gray-100">{sector.sector}</p>
      <p className="mt-1 truncate text-xs text-gray-500">{sector.topTickers.join(' · ')}</p>
    </div>
    <div className="shrink-0 text-right">
      <p className={`text-sm font-medium ${deltaTextClass(sector.netMarketValueDeltaUsd)}`}>
        {formatUsdCompact(sector.netMarketValueDeltaUsd)}
      </p>
      <p className="mt-0.5 text-xs text-gray-600">
        {sector.institutionCount} · {sector.tickerCount}
      </p>
    </div>
  </div>
);

const ConsensusListSection: React.FC<{
  title: string;
  titleClass: string;
  emptyText: string;
  showAllLabel: string;
  showLessLabel: string;
  items: React.ReactNode[];
}> = ({ title, titleClass, emptyText, showAllLabel, showLessLabel, items }) => {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, CONSENSUS_LIST_PREVIEW);
  const hasMore = items.length > CONSENSUS_LIST_PREVIEW;

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
      <h3 className={`mb-3 text-sm font-semibold ${titleClass}`}>{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <>
          <div className="space-y-1.5">{visible}</div>
          {hasMore ? (
            <button
              type="button"
              onClick={() => setExpanded(prev => !prev)}
              className="mt-3 text-xs text-blue-400 hover:text-blue-300"
            >
              {expanded
                ? showLessLabel
                : showAllLabel.replace('{count}', String(items.length))}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
};

export const AggregateDashboardPanel: React.FC<AggregateDashboardPanelProps> = ({
  language,
  tracker,
}) => {
  const ui = getUIText(language);
  const {
    institutionOptions,
    aggregateCiks,
    toggleAggregateCik,
    aggregateMinInstitutionCount,
    setAggregateMinInstitutionCount,
    aggregateSelectedCount,
    aggregate,
    aggregateLoading,
    runAggregate,
  } = tracker;

  const { buyStocks, sellStocks, buySectors, sellSectors } = useMemo(() => {
    if (!aggregate) {
      return { buyStocks: [], sellStocks: [], buySectors: [], sellSectors: [] };
    }
    const stocks = splitByDirection(aggregate.stockConsensus);
    const sectors = splitByDirection(aggregate.sectorConsensus);
    return {
      buyStocks: sortStocksByPriority(stocks.buy),
      sellStocks: sortStocksByPriority(stocks.sell),
      buySectors: sortSectorsByPriority(sectors.buy),
      sellSectors: sortSectorsByPriority(sectors.sell),
    };
  }, [aggregate]);

  const topBuy = useMemo(
    () => (aggregate ? topConsensusStocks(aggregate.stockConsensus, 'BUY', 3) : []),
    [aggregate]
  );
  const topSell = useMemo(
    () => (aggregate ? topConsensusStocks(aggregate.stockConsensus, 'SELL', 3) : []),
    [aggregate]
  );

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">{ui.thirteenFAggregateTitle}</h2>
            <p className="mt-1 text-sm text-gray-400">{ui.thirteenFAggregateHint}</p>
          </div>
          <button
            type="button"
            disabled={aggregateCiks.size === 0 || aggregateLoading}
            onClick={() => void runAggregate()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm hover:bg-blue-500 disabled:opacity-50"
          >
            {aggregateLoading ? ui.thirteenFLoading : ui.thirteenFRunAggregate}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {institutionOptions.map(inst => {
            const selected = aggregateCiks.has(resolveInstitutionCik(inst.cik));
            return (
              <button
                key={inst.cik}
                type="button"
                onClick={() => toggleAggregateCik(inst.cik)}
                className={`rounded-full border px-3 py-1.5 text-sm ${
                  selected
                    ? 'border-blue-500 bg-blue-600/20 text-blue-100'
                    : 'border-gray-700 bg-gray-800 text-gray-300 hover:text-white'
                }`}
              >
                {inst.shortName ?? inst.name}
              </button>
            );
          })}
        </div>

        {aggregateSelectedCount >= 2 ? (
          <div className="mt-4 rounded-md border border-gray-800 bg-gray-950/40 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <label
                  htmlFor="consensus-min-institutions"
                  className="text-sm font-medium text-gray-200"
                >
                  {ui.thirteenFConsensusMinInstitutions}
                </label>
                <p className="mt-0.5 text-xs text-gray-500">
                  {ui.thirteenFConsensusMinInstitutionsHint}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="consensus-min-institutions"
                  type="range"
                  min={2}
                  max={aggregateSelectedCount}
                  step={1}
                  value={aggregateMinInstitutionCount}
                  onChange={event =>
                    setAggregateMinInstitutionCount(Number(event.target.value))
                  }
                  className="w-36 accent-blue-500"
                />
                <span className="min-w-[3.5rem] text-right text-sm font-medium tabular-nums text-gray-200">
                  {aggregateMinInstitutionCount} / {aggregateSelectedCount}
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {aggregateCiks.size === 0 ? (
        <p className="py-10 text-center text-sm text-gray-500">{ui.thirteenFAggregateEmpty}</p>
      ) : aggregateLoading && !aggregate ? (
        <p className="py-10 text-center text-sm text-gray-400">{ui.thirteenFLoading}</p>
      ) : !aggregate ? (
        <p className="py-10 text-center text-sm text-gray-500">{ui.thirteenFAggregateEmpty}</p>
      ) : (
        <>
          <section className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-400">
              <span className="font-medium text-gray-200">{aggregate.quarter}</span>
              <span>
                {ui.thirteenFConsensusSummaryStocks
                  .replace('{buy}', String(buyStocks.length))
                  .replace('{sell}', String(sellStocks.length))}
              </span>
              <span>
                {ui.thirteenFConsensusSummarySectors
                  .replace('{buy}', String(buySectors.length))
                  .replace('{sell}', String(sellSectors.length))}
              </span>
              <span className="text-gray-500">
                {ui.thirteenFConsensusMinInstitutions}: {aggregateMinInstitutionCount}
              </span>
            </div>
          </section>

          {(topBuy.length > 0 || topSell.length > 0) && (
            <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
              <h3 className="mb-3 text-base font-medium text-gray-100">
                {ui.thirteenFConsensusHighlights}
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-400/90">
                    {ui.thirteenFConsensusStrongestBuy}
                  </p>
                  <div className="space-y-2">
                    {topBuy.length === 0 ? (
                      <p className="text-sm text-gray-500">{ui.thirteenFConsensusEmpty}</p>
                    ) : (
                      topBuy.map(stock => (
                        <HighlightCard
                          key={stock.ticker}
                          stock={stock}
                          buyLabel={ui.thirteenFConsensusBuy}
                          sellLabel={ui.thirteenFConsensusSell}
                          institutionsLabel={ui.thirteenFInstitutions}
                        />
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-red-400/90">
                    {ui.thirteenFConsensusStrongestSell}
                  </p>
                  <div className="space-y-2">
                    {topSell.length === 0 ? (
                      <p className="text-sm text-gray-500">{ui.thirteenFConsensusEmpty}</p>
                    ) : (
                      topSell.map(stock => (
                        <HighlightCard
                          key={stock.ticker}
                          stock={stock}
                          buyLabel={ui.thirteenFConsensusBuy}
                          sellLabel={ui.thirteenFConsensusSell}
                          institutionsLabel={ui.thirteenFInstitutions}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {aggregate.stockConsensus.length > 0 ? (
            <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
              <h3 className="text-base font-medium text-gray-100">{ui.thirteenFConsensusStockMap}</h3>
              <p className="mt-1 text-xs text-gray-500">{ui.thirteenFConsensusStockMapHint}</p>
              <div className="mt-4">
                <ConsensusStockBubbleChart
                  stocks={aggregate.stockConsensus}
                  buyLabel={ui.thirteenFConsensusBuy}
                  sellLabel={ui.thirteenFConsensusSell}
                  clusterHint={ui.thirteenFConsensusClusterHint}
                  clusterExpandLabel={ui.thirteenFConsensusClusterExpand}
                  clusterCollapseLabel={ui.thirteenFConsensusClusterCollapse}
                  stocksLabel={ui.thirteenFConsensusClusterStocks}
                />
              </div>
            </section>
          ) : null}

          {aggregate.sectorConsensus.length > 0 ? (
            <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4">
              <h3 className="text-base font-medium text-gray-100">{ui.thirteenFConsensusSectorFlow}</h3>
              <p className="mt-1 text-xs text-gray-500">{ui.thirteenFConsensusSectorFlowHint}</p>
              <div className="mt-4">
                <ConsensusSectorBarChart
                  sectors={aggregate.sectorConsensus}
                  buyLabel={ui.thirteenFConsensusBuy}
                  sellLabel={ui.thirteenFConsensusSell}
                />
              </div>
            </section>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <ConsensusListSection
              title={ui.thirteenFConsensusStockBuy}
              titleClass="text-emerald-400"
              emptyText={ui.thirteenFConsensusEmpty}
              showAllLabel={ui.thirteenFConsensusShowAll}
              showLessLabel={ui.thirteenFConsensusShowLess}
              items={buyStocks.map((stock, index) => (
                <StockConsensusRow key={stock.ticker} stock={stock} rank={index + 1} />
              ))}
            />
            <ConsensusListSection
              title={ui.thirteenFConsensusStockSell}
              titleClass="text-red-400"
              emptyText={ui.thirteenFConsensusEmpty}
              showAllLabel={ui.thirteenFConsensusShowAll}
              showLessLabel={ui.thirteenFConsensusShowLess}
              items={sellStocks.map((stock, index) => (
                <StockConsensusRow key={stock.ticker} stock={stock} rank={index + 1} />
              ))}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ConsensusListSection
              title={ui.thirteenFConsensusSectorBuy}
              titleClass="text-emerald-400"
              emptyText={ui.thirteenFConsensusEmpty}
              showAllLabel={ui.thirteenFConsensusShowAll}
              showLessLabel={ui.thirteenFConsensusShowLess}
              items={buySectors.map((sector, index) => (
                <SectorConsensusRow key={sector.sector} sector={sector} rank={index + 1} />
              ))}
            />
            <ConsensusListSection
              title={ui.thirteenFConsensusSectorSell}
              titleClass="text-red-400"
              emptyText={ui.thirteenFConsensusEmpty}
              showAllLabel={ui.thirteenFConsensusShowAll}
              showLessLabel={ui.thirteenFConsensusShowLess}
              items={sellSectors.map((sector, index) => (
                <SectorConsensusRow key={sector.sector} sector={sector} rank={index + 1} />
              ))}
            />
          </div>
        </>
      )}
    </div>
  );
};
