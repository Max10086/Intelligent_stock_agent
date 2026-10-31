import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import type { CallbackDataParams } from 'echarts/types/dist/shared';
import type { ThirteenFConsensusStock } from '../../../types/thirteenF.ts';
import { formatUsdCompact } from '../../../utils/thirteenFFormat.ts';
import {
  type ConsensusBubbleDisplayItem,
  consensusBubbleChartHeight,
  layoutConsensusBubbles,
} from '../../../utils/thirteenFConsensusBubbleLayout.ts';

interface ConsensusStockBubbleChartProps {
  stocks: ThirteenFConsensusStock[];
  buyLabel: string;
  sellLabel: string;
  clusterHint: string;
  clusterExpandLabel: string;
  clusterCollapseLabel: string;
  stocksLabel: string;
  /** Override default chart height (px). */
  height?: number;
}

type BubbleScatterPoint = {
  name: string;
  value: [number, number, number, number];
  symbolSize: number;
  itemStyle: {
    color: string;
    opacity: number;
    borderColor: string;
    borderWidth: number;
    borderType: 'dashed' | 'solid';
  };
  label: {
    show: boolean;
    formatter: string;
    color: string;
    fontSize: number;
    fontWeight: number;
    rich?: Record<string, { color: string; fontSize: number; fontWeight: number }>;
  };
  displayItem: ConsensusBubbleDisplayItem;
};

export const ConsensusStockBubbleChart: React.FC<ConsensusStockBubbleChartProps> = ({
  stocks,
  buyLabel,
  sellLabel,
  clusterHint,
  clusterExpandLabel,
  clusterCollapseLabel,
  stocksLabel,
  height,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedClusterIds, setExpandedClusterIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpandedClusterIds(new Set());
  }, [stocks]);

  const toggleCluster = useCallback((clusterId: string | null | undefined) => {
    if (!clusterId) {
      return;
    }
    setExpandedClusterIds(prev => {
      const next = new Set(prev);
      if (next.has(clusterId)) {
        next.delete(clusterId);
      } else {
        next.add(clusterId);
      }
      return next;
    });
  }, []);

  const chartHeight = height ?? consensusBubbleChartHeight(stocks, expandedClusterIds);

  const layout = useMemo(
    () => layoutConsensusBubbles(stocks, chartHeight, expandedClusterIds),
    [chartHeight, expandedClusterIds, stocks]
  );

  const option = useMemo((): EChartsOption | null => {
    if (!layout) {
      return null;
    }

    const { items, yMin, yMax, maxInstitutions, maxScore, grid } = layout;

    const seriesData = items.map(item => {
      const isCluster = item.kind === 'cluster';
      const isBuy = item.stock.direction === 'BUY';
      return {
        name: isCluster ? item.cluster?.id ?? item.stock.ticker : item.stock.ticker,
        value: [item.x, item.y, item.sizePx, item.score],
        symbolSize: item.sizePx,
        itemStyle: {
          color: isBuy ? '#10b981' : '#ef4444',
          opacity: isCluster ? 0.72 : 0.9,
          borderColor: isCluster ? '#fbbf24' : isBuy ? '#34d399' : '#f87171',
          borderWidth: isCluster ? 2 : 1,
          borderType: (isCluster ? 'dashed' : 'solid') as 'dashed' | 'solid',
        },
        label: {
          show:
            isCluster ||
            item.kind === 'member' ||
            item.score >= maxScore * 0.38,
          formatter: isCluster
            ? `{count|×${item.cluster?.stocks.length ?? 0}}`
            : item.stock.ticker,
          color: '#f3f4f6',
          fontSize: isCluster ? 13 : 12,
          fontWeight: 600,
          rich: isCluster
            ? {
                count: {
                  color: '#fde68a',
                  fontSize: 13,
                  fontWeight: 700,
                },
              }
            : undefined,
        },
        displayItem: item,
      } satisfies BubbleScatterPoint;
    });

    const formatTooltip = (params: CallbackDataParams | CallbackDataParams[]): string => {
      const raw = Array.isArray(params) ? params[0] : params;
      const displayItem = (raw?.data as BubbleScatterPoint | undefined)?.displayItem;
      if (!displayItem) {
        return '';
      }

      if (displayItem.kind === 'cluster' && displayItem.cluster) {
        const cluster = displayItem.cluster;
        const direction = cluster.direction === 'BUY' ? buyLabel : sellLabel;
        const preview = cluster.stocks
          .slice(0, 6)
          .map(stock => `${stock.ticker} (${formatUsdCompact(stock.netMarketValueDeltaUsd)})`)
          .join('<br/>');
        const remainder =
          cluster.stocks.length > 6
            ? `<br/>+${cluster.stocks.length - 6} ${stocksLabel}`
            : '';
        return [
          `<strong>${cluster.stocks.length} ${stocksLabel}</strong> · ${direction}`,
          `${cluster.institutionCount} institutions · avg ${formatUsdCompact(cluster.centroidY)}`,
          `Total ${formatUsdCompact(cluster.netDeltaUsd)}`,
          preview + remainder,
          clusterExpandLabel,
        ].join('<br/>');
      }

      const item = displayItem.stock;
      const direction = item.direction === 'BUY' ? buyLabel : sellLabel;
      const institutions = item.institutions.map(inst => inst.name).join(', ');
      const collapseHint =
        displayItem.kind === 'member' ? `<br/>${clusterCollapseLabel}` : '';
      return [
        `<strong>${item.ticker}</strong> · ${item.name}`,
        `${direction} · ${item.institutionCount} · ${item.sector}`,
        formatUsdCompact(item.netMarketValueDeltaUsd),
        institutions,
        collapseHint,
      ].join('<br/>');
    };

    return {
      grid,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(17,24,39,0.95)',
        borderColor: '#374151',
        textStyle: { color: '#e5e7eb', fontSize: 12 },
        formatter: formatTooltip,
      },
      xAxis: {
        name: 'Institutions',
        nameLocation: 'middle',
        nameGap: 28,
        nameTextStyle: { color: '#9ca3af', fontSize: 11 },
        min: 1.5,
        max: maxInstitutions + 0.5,
        interval: 1,
        axisLine: { lineStyle: { color: '#374151' } },
        axisLabel: { color: '#9ca3af' },
        splitLine: { lineStyle: { color: '#1f2937', type: 'dashed' } },
      },
      yAxis: {
        name: 'Net $ change',
        min: yMin,
        max: yMax,
        nameTextStyle: { color: '#9ca3af', fontSize: 11 },
        axisLine: { lineStyle: { color: '#374151' } },
        axisLabel: {
          color: '#9ca3af',
          formatter: (value: number) => formatUsdCompact(value),
        },
        splitLine: { lineStyle: { color: '#1f2937', type: 'dashed' } },
      },
      series: [
        {
          type: 'scatter',
          data: seriesData as BubbleScatterPoint[],
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#4b5563', type: 'dashed', width: 1 },
            data: [{ yAxis: 0 }],
            label: { show: false },
          },
          emphasis: {
            scale: 1.1,
            focus: 'self',
          },
        },
      ],
    };
  }, [
    buyLabel,
    clusterCollapseLabel,
    clusterExpandLabel,
    layout,
    sellLabel,
    stocksLabel,
  ]);

  const onChartClick = useCallback(
    (params: { data?: { displayItem?: ConsensusBubbleDisplayItem } }) => {
      const displayItem = params.data?.displayItem;
      if (!displayItem) {
        return;
      }
      if (displayItem.kind === 'cluster' || displayItem.kind === 'member') {
        toggleCluster(displayItem.clusterId);
      }
    },
    [toggleCluster]
  );

  if (!option) {
    return null;
  }

  const collapsedClusterCount = layout?.clusters.filter(
    cluster => !expandedClusterIds.has(cluster.id)
  ).length;

  return (
    <div ref={containerRef} className="w-full">
      {(collapsedClusterCount ?? 0) > 0 ? (
        <p className="mb-2 text-xs text-gray-500">{clusterHint}</p>
      ) : null}
      <ReactECharts
        option={option}
        style={{ height: chartHeight, width: '100%' }}
        opts={{ renderer: 'canvas' }}
        onEvents={{ click: onChartClick }}
      />
    </div>
  );
};
