import React from 'react';
import type { Language } from '../types.ts';
import type { UsageSummary } from '../types/auth.ts';
import { getUIText } from '../constants.ts';

interface UsageBannerProps {
  language: Language;
  usage: UsageSummary | null;
  onUpgrade?: () => void;
}

const formatDateTime = (iso: string, language: Language): string =>
  new Date(iso).toLocaleString(language === 'cn' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export const UsageBanner: React.FC<UsageBannerProps> = ({ language, usage, onUpgrade }) => {
  if (!usage || usage.isPaid || usage.isAdmin) return null;

  const ui = getUIText(language);
  const freeEndsAt = usage.freeEndsAt || usage.trialEndsAt;
  const freeLimit = usage.freeAnalysisLimit ?? usage.dailyLimit;

  const tierLabel =
    usage.tier === 'locked'
      ? ui.usageTierLocked
      : ui.usageTierFree
          .replace('{remaining}', String(usage.remaining))
          .replace('{limit}', String(freeLimit));

  const bannerClass =
    usage.tier === 'locked'
      ? 'border-amber-500/40 bg-amber-950/25 text-amber-100'
      : 'border-blue-500/30 bg-blue-950/20 text-blue-100';

  return (
    <div
      className={`max-w-4xl mx-auto mb-4 rounded-lg border px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2 ${bannerClass}`}
    >
      <div>
        <span className="font-medium">{tierLabel}</span>
        {usage.tier === 'free' && (
          <span className="opacity-80 ml-2">
            {ui.usageRemaining
              .replace('{remaining}', String(usage.remaining))
              .replace('{limit}', String(freeLimit))}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {usage.tier === 'free' && freeEndsAt && (
          <span className="text-xs opacity-80">
            {(ui.usageFreeEnds || ui.usageTrialEnds).replace('{date}', formatDateTime(freeEndsAt, language))}
          </span>
        )}
        {onUpgrade && (
          <button
            type="button"
            onClick={onUpgrade}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
              usage.tier === 'locked'
                ? 'bg-amber-400 text-gray-900 hover:bg-amber-300'
                : 'bg-amber-500/90 text-gray-900 hover:bg-amber-400'
            }`}
          >
            {ui.upgrade}
          </button>
        )}
      </div>
    </div>
  );
};
