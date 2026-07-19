import React from 'react';
import { formatReturnPct } from '../utils/priceFormat.ts';
import type { CatalogReturnDisplay } from '../types/catalogReturn.ts';

export const CumulativeReturnCell: React.FC<{
  display: CatalogReturnDisplay | undefined;
  loadingLabel: string;
}> = ({ display, loadingLabel }) => {
  if (!display || display.status === 'idle') {
    return <span className="text-gray-500">—</span>;
  }
  if (display.status === 'loading') {
    return <span className="text-gray-500 animate-pulse">{loadingLabel}</span>;
  }
  if (display.status === 'error' || display.returnPct === null) {
    return <span className="text-gray-500">—</span>;
  }

  const positive = display.returnPct >= 0;
  return (
    <span
      className={`font-semibold tabular-nums ${positive ? 'text-green-400' : 'text-red-400'}`}
      title={display.currentPrice ? `Latest: ${display.currentPrice}` : undefined}
    >
      {formatReturnPct(display.returnPct)}
    </span>
  );
};
