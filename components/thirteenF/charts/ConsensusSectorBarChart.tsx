import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { ThirteenFConsensusSector } from '../../../types/thirteenF.ts';
import { formatUsdCompact } from '../../../utils/thirteenFFormat.ts';
import { sortSectorsByPriority } from '../../../utils/thirteenFConsensus.ts';

const CHART_HEIGHT = 340;
const MAX_SECTORS = 10;

interface ConsensusSectorBarChartProps {
  sectors: ThirteenFConsensusSector[];
  buyLabel: string;
  sellLabel: string;
}

export const ConsensusSectorBarChart: React.FC<ConsensusSectorBarChartProps> = ({
  sectors,
  buyLabel,
  sellLabel,
}) => {
  const option = useMemo(() => {
    const ranked = sortSectorsByPriority(sectors).slice(0, MAX_SECTORS);
    if (ranked.length === 0) {
      return null;
    }

    const labels = ranked.map(sector => sector.sector);
    const values = ranked.map(sector =>
      sector.direction === 'BUY'
        ? Math.abs(sector.netMarketValueDeltaUsd)
        : -Math.abs(sector.netMarketValueDeltaUsd)
    );
    const colors = ranked.map(sector =>
      sector.direction === 'BUY' ? '#10b981' : '#ef4444'
    );

    const maxAbs = Math.max(...values.map(Math.abs), 1);

    return {
      grid: { left: 120, right: 48, top: 16, bottom: 24 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(17,24,39,0.95)',
        borderColor: '#374151',
        textStyle: { color: '#e5e7eb', fontSize: 12 },
        formatter: (params: Array<{ dataIndex: number; value: number }>) => {
          const index = params[0]?.dataIndex ?? 0;
          const sector = ranked[index];
          if (!sector) return '';
          const direction = sector.direction === 'BUY' ? buyLabel : sellLabel;
          return [
            `<strong>${sector.sector}</strong>`,
            `${direction} · ${sector.institutionCount} · ${sector.tickerCount} tickers`,
            formatUsdCompact(sector.netMarketValueDeltaUsd),
            sector.topTickers.join(', '),
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'value',
        min: -maxAbs * 1.1,
        max: maxAbs * 1.1,
        axisLine: { lineStyle: { color: '#374151' } },
        axisLabel: {
          color: '#9ca3af',
          formatter: (value: number) => formatUsdCompact(Math.abs(value)),
        },
        splitLine: { lineStyle: { color: '#1f2937', type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        data: labels,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: '#e5e7eb',
          fontSize: 12,
          width: 108,
          overflow: 'truncate',
        },
      },
      series: [
        {
          type: 'bar',
          data: values.map((value, index) => ({
            value,
            itemStyle: {
              color: colors[index],
              borderRadius: value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
            },
          })),
          barMaxWidth: 22,
        },
      ],
    };
  }, [buyLabel, sellLabel, sectors]);

  if (!option) {
    return null;
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: CHART_HEIGHT, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
};
