import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { ThirteenFDistributionSlice } from '../../../types/thirteenF.ts';
import { formatUsdCompact } from '../../../utils/thirteenFFormat.ts';

const CHART_HEIGHT = 400;

const TREEMAP_COLORS = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#ea580c',
  '#4f46e5',
  '#0d9488',
  '#9333ea',
];

interface StockTreemapChartProps {
  slices: ThirteenFDistributionSlice[];
}

type TreemapLayoutParams = {
  dataIndex: number;
  name?: string;
  rect: { x: number; y: number; width: number; height: number };
  labelRect?: { x: number; y: number; width: number; height: number };
  data?: { weightPct?: number };
};

/** Never hide unless the cell is practically unreadable. */
const fontSizeForRect = (width: number, height: number): number => {
  const minSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  const area = width * height;

  // Wide-but-thin tiles (e.g. GOOGL) — still readable on a single line.
  if (minSide < 36 && longSide > 80) return 9;
  if (minSide < 10 && longSide >= 72 && area >= 360) return 8;
  if (minSide < 8 || area < 120) return 0;
  if (minSide < 12) return 7;
  if (minSide < 16) return 8;
  if (minSide < 22) return 9;
  if (minSide < 30) return 10;
  if (minSide < 40) return 11;
  if (minSide < 52) return 12;
  if (minSide < 66) return 13;
  if (minSide < 84) return 14;
  return 15;
};

const labelTextForRect = (
  name: string,
  weightPct: number | undefined,
  width: number,
  height: number,
  fontSize: number
): string => {
  if (weightPct == null) return name;
  const lineHeight = Math.ceil(fontSize * 1.25);
  const canFitTwoLines =
    height >= lineHeight * 2 + 6 &&
    width >= name.length * fontSize * 0.55 &&
    height >= 32;
  if (canFitTwoLines && weightPct >= 1.2) {
    return `${name}\n${weightPct.toFixed(1)}%`;
  }
  return `${name} ${weightPct.toFixed(1)}%`;
};

export const StockTreemapChart: React.FC<StockTreemapChartProps> = ({ slices }) => {
  const option = useMemo(() => {
    const labelByIndex = new Map<number, string>();

    return {
      color: TREEMAP_COLORS,
      tooltip: {
        textStyle: { fontSize: 14 },
        formatter: (info: { name: string; value: number; data?: { weightPct?: number } }) => {
          const pct = info.data?.weightPct;
          const pctText = pct != null ? ` (${pct.toFixed(2)}%)` : '';
          return `${info.name}<br/>${formatUsdCompact(info.value)}${pctText}`;
        },
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: '100%',
          height: '100%',
          label: {
            show: true,
            position: 'inside',
            align: 'center',
            verticalAlign: 'middle',
            color: '#ffffff',
            fontWeight: 600,
            textShadowColor: 'rgba(0,0,0,0.55)',
            textShadowBlur: 3,
            textShadowOffsetX: 0,
            textShadowOffsetY: 1,
            overflow: 'truncate',
            ellipsis: '…',
            formatter: (params: { dataIndex: number; name?: string; data?: { weightPct?: number } }) => {
              const cached = labelByIndex.get(params.dataIndex);
              if (cached) return cached;
              const name = params.name ?? '';
              const pct = params.data?.weightPct;
              return pct != null ? `${name} ${pct.toFixed(1)}%` : name;
            },
          },
          labelLayout: (params: TreemapLayoutParams) => {
            const { rect, dataIndex, name = '', data, labelRect } = params;
            const fontSize = fontSizeForRect(rect.width, rect.height);
            const text = labelTextForRect(
              name,
              data?.weightPct,
              rect.width,
              rect.height,
              fontSize || 8
            );
            labelByIndex.set(dataIndex, text);

            if (fontSize === 0) {
              return { fontSize: 0 };
            }

            const labelHeight = labelRect?.height ?? Math.ceil(fontSize * (text.includes('\n') ? 2.5 : 1.25));
            // Treemap ignores verticalAlign — anchor label box top so text sits in cell center.
            return {
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2 - labelHeight / 2,
              align: 'center',
              fontSize,
              width: Math.max(rect.width - 6, 0),
            };
          },
          itemStyle: {
            borderColor: '#111827',
            borderWidth: 2,
            gapWidth: 3,
          },
          levels: [
            {
              itemStyle: {
                borderWidth: 2,
                gapWidth: 3,
              },
            },
          ],
          data: slices.map(row => ({
            name: row.label,
            value: row.marketValueUsd,
            weightPct: row.weightPct,
          })),
        },
      ],
    };
  }, [slices]);

  if (slices.length === 0) {
    return <p className="text-sm text-gray-500 py-8 text-center">No holdings data</p>;
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: CHART_HEIGHT, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
};
