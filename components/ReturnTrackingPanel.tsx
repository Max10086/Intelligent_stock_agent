import React from 'react';
import type { Language } from '../types.ts';
import type { ReturnTrackingSnapshotPoint } from '../types/returnTracking.ts';
import { getUIText } from '../constants.ts';
import { formatDisplayPrice, formatReturnPct } from '../utils/priceFormat.ts';
import { formatFollowUpDate } from '../utils/followUpHelpers.ts';

interface ReturnTrackingPanelProps {
  language: Language;
  ticker: string;
  exchange?: string;
  anchorPrice: string;
  anchorDate: string;
  currentPrice?: string;
  returnPct?: number | null;
  timeline?: ReturnTrackingSnapshotPoint[];
  isLoading?: boolean;
}

export const ReturnTrackingPanel: React.FC<ReturnTrackingPanelProps> = ({
  language,
  ticker,
  exchange,
  anchorPrice,
  anchorDate,
  currentPrice,
  returnPct,
  timeline = [],
  isLoading = false,
}) => {
  const ui = getUIText(language);
  const returnLabel = formatReturnPct(returnPct);
  const returnPositive = returnPct !== null && returnPct !== undefined && returnPct >= 0;
  const returnNegative = returnPct !== null && returnPct !== undefined && returnPct < 0;
  const displayPrice = currentPrice || anchorPrice;
  const hasReturn = returnPct !== null && returnPct !== undefined;
  const updatingLabel = language === 'cn' ? '更新中…' : 'updating…';

  return (
    <section className="rounded-lg border border-emerald-800/40 bg-emerald-950/10 p-4 text-sm space-y-3">
      <div>
        <p className="font-semibold text-emerald-300">{ui.returnTrackingTitle}</p>
        <p className="text-xs text-gray-500 mt-1">{ui.returnTrackingHint}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-gray-500">{ui.returnTrackingAnchorPrice}</p>
          <p className="text-gray-200">
            {formatDisplayPrice(anchorPrice, exchange)}{' '}
            <span className="text-gray-500">
              ({formatFollowUpDate(anchorDate, language)})
            </span>
          </p>
        </div>
        <div>
          <p className="text-gray-500">{ui.returnTrackingCurrentPrice}</p>
          <p className="text-gray-200">
            {formatDisplayPrice(displayPrice, exchange)}
            {isLoading && !currentPrice && (
              <span className="ml-1 text-gray-500">{updatingLabel}</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-gray-500">{ui.returnTrackingReturn}</p>
          <p
            className={
              returnPositive
                ? 'text-green-400'
                : returnNegative
                  ? 'text-red-400'
                  : 'text-gray-300'
            }
          >
            {hasReturn
              ? returnLabel
              : isLoading
                ? updatingLabel
                : '—'}
          </p>
        </div>
      </div>

      {timeline.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 mb-2">{ui.returnTrackingTimeline}</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {[...timeline].reverse().map(point => (
              <div
                key={`${ticker}-${point.date}`}
                className="flex items-center justify-between text-xs rounded-md bg-gray-900/40 px-3 py-2"
              >
                <span className="text-gray-400">{point.date}</span>
                <span className="text-gray-200">{formatDisplayPrice(point.price, exchange)}</span>
                <span
                  className={
                    point.returnPct >= 0 ? 'text-green-400' : 'text-red-400'
                  }
                >
                  {formatReturnPct(point.returnPct)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
