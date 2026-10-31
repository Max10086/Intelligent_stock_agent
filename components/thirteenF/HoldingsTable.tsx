import React, { useMemo } from 'react';
import type { Language } from '../../types.ts';
import type {
  ThirteenFHolding,
  ThirteenFHoldingSortField,
  ThirteenFSortDirection,
} from '../../types/thirteenF.ts';
import { getUIText } from '../../constants.ts';
import {
  deltaTextClass,
  formatPct,
  formatUsdCompact,
  formatUsdPlain,
} from '../../utils/thirteenFFormat.ts';
import { sortHoldingsRows } from '../../utils/thirteenFHoldingsSort.ts';

interface HoldingsTableProps {
  language: Language;
  holdings: ThirteenFHolding[];
  totalMarketValueUsd: number;
  sort: { field: ThirteenFHoldingSortField; dir: ThirteenFSortDirection };
  onSortChange: (field: ThirteenFHoldingSortField) => void;
  highlightTicker?: string | null;
}

const SortHeader: React.FC<{
  label: string;
  field: ThirteenFHoldingSortField;
  activeField: ThirteenFHoldingSortField;
  dir: ThirteenFSortDirection;
  onClick: (field: ThirteenFHoldingSortField) => void;
}> = ({ label, field, activeField, dir, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(field)}
    className="inline-flex items-center gap-1 whitespace-nowrap hover:text-white"
  >
    {label}
    {activeField === field ? <span className="text-xs">{dir === 'asc' ? '↑' : '↓'}</span> : null}
  </button>
);

const resolveValueDelta = (entry: ThirteenFHolding): number | null => {
  if (entry.marketValueDeltaUsd != null) return entry.marketValueDeltaUsd;
  if (entry.sharesDelta == null || entry.referencePriceUsd == null) return null;
  return entry.sharesDelta * entry.referencePriceUsd;
};

export const HoldingsTable: React.FC<HoldingsTableProps> = ({
  language,
  holdings,
  totalMarketValueUsd,
  sort,
  onSortChange,
  highlightTicker,
}) => {
  const ui = getUIText(language);

  const displayHoldings = useMemo(
    () => sortHoldingsRows(holdings, sort.field, sort.dir, totalMarketValueUsd),
    [holdings, sort.dir, sort.field, totalMarketValueUsd]
  );

  if (displayHoldings.length === 0) {
    return <p className="text-sm text-gray-500 py-8 text-center">{ui.thirteenFHoldingsEmpty}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-[960px] w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-gray-500 border-b border-gray-800">
          <tr>
            <th className="px-3 py-3 w-10 whitespace-nowrap">{ui.thirteenFColRank}</th>
            <th className="px-3 py-3 min-w-[4.5rem] whitespace-nowrap">{ui.thirteenFColTicker}</th>
            <th className="px-3 py-3 min-w-[8rem]">{ui.thirteenFColName}</th>
            <th className="px-3 py-3 min-w-[5rem] whitespace-nowrap">
              <SortHeader
                label={ui.thirteenFColWeight}
                field="portfolioWeight"
                activeField={sort.field}
                dir={sort.dir}
                onClick={onSortChange}
              />
            </th>
            <th className="px-3 py-3 min-w-[5.5rem] whitespace-nowrap">{ui.thirteenFColValueDelta}</th>
            <th className="px-3 py-3 min-w-[5.5rem] whitespace-nowrap">{ui.thirteenFColWeightDelta}</th>
            <th className="px-3 py-3 min-w-[6rem] whitespace-nowrap">
              <SortHeader
                label={ui.thirteenFColMarketValue}
                field="marketValue"
                activeField={sort.field}
                dir={sort.dir}
                onClick={onSortChange}
              />
            </th>
            <th className="px-3 py-3 min-w-[6rem] whitespace-nowrap">{ui.thirteenFColSector}</th>
            <th className="px-3 py-3 min-w-[5rem] whitespace-nowrap">{ui.thirteenFColPrice}</th>
            <th className="px-3 py-3 min-w-[7rem] whitespace-nowrap">{ui.thirteenFColReportDate}</th>
          </tr>
        </thead>
        <tbody>
          {displayHoldings.map(entry => {
            const valueDelta = resolveValueDelta(entry);
            return (
              <tr
                key={entry.id}
                className={`border-t border-gray-800 ${
                  highlightTicker === entry.ticker ? 'bg-blue-950/20' : 'text-gray-300'
                }`}
              >
                <td className="px-3 py-3 text-gray-400 whitespace-nowrap">{entry.rank}</td>
                <td className="px-3 py-3 font-medium text-gray-100 whitespace-nowrap">{entry.ticker}</td>
                <td className="px-3 py-3 max-w-[12rem] truncate">{entry.name}</td>
                <td className="px-3 py-3 whitespace-nowrap">{entry.portfolioWeightPct.toFixed(2)}%</td>
                <td
                  className={`px-3 py-3 whitespace-nowrap ${
                    valueDelta != null ? deltaTextClass(valueDelta) : 'text-gray-500'
                  }`}
                >
                  {valueDelta != null ? formatUsdCompact(valueDelta) : '—'}
                </td>
                <td
                  className={`px-3 py-3 whitespace-nowrap ${
                    entry.weightDeltaPct != null
                      ? deltaTextClass(entry.weightDeltaPct)
                      : 'text-gray-500'
                  }`}
                >
                  {entry.weightDeltaPct != null ? formatPct(entry.weightDeltaPct) : '—'}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">{formatUsdCompact(entry.marketValueUsd)}</td>
                <td className="px-3 py-3 text-gray-400 whitespace-nowrap">{entry.sector}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  {entry.referencePriceUsd != null
                    ? formatUsdPlain(entry.referencePriceUsd)
                    : '—'}
                </td>
                <td className="px-3 py-3 text-gray-400 whitespace-nowrap">
                  {entry.reportDate}
                  <span className="ml-2 rounded bg-gray-800 px-1.5 py-0.5 text-xs">13F</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
