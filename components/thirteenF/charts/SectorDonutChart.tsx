import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { ThirteenFDistributionSlice } from '../../../types/thirteenF.ts';
import { formatUsdCompact } from '../../../utils/thirteenFFormat.ts';

const CHART_COLORS = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

interface SectorDonutChartProps {
  slices: ThirteenFDistributionSlice[];
  title: string;
}

export const SectorDonutChart: React.FC<SectorDonutChartProps> = ({ slices, title }) => {
  const option = useMemo(() => {
    const top = slices.slice(0, 6);
    const otherValue = slices.slice(6).reduce((sum, row) => sum + row.marketValueUsd, 0);
    const data = top.map(row => ({
      name: row.label,
      value: row.marketValueUsd,
    }));
    if (otherValue > 0) {
      data.push({ name: 'Other', value: otherValue });
    }

    return {
      color: CHART_COLORS,
      tooltip: {
        trigger: 'item',
        formatter: (params: { name: string; value: number; percent: number }) =>
          `${params.name}<br/>${formatUsdCompact(params.value)} (${params.percent.toFixed(1)}%)`,
      },
      legend: {
        show: false,
      },
      series: [
        {
          name: title,
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 4,
            borderColor: '#111827',
            borderWidth: 2,
          },
          label: {
            show: true,
            color: '#e5e7eb',
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 18,
            formatter: (params: { name: string; percent: number }) =>
              `${params.name}\n${params.percent.toFixed(1)}%`,
          },
          labelLine: {
            show: true,
            length: 14,
            length2: 10,
            smooth: true,
            lineStyle: { color: '#6b7280', width: 1.5 },
          },
          data,
        },
      ],
    };
  }, [slices, title]);

  if (slices.length === 0) {
    return <p className="text-sm text-gray-500 py-8 text-center">No sector data</p>;
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: 320, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
};
