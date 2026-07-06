import React from 'react';
import type { Language } from '../types.ts';
import type { UsageSummary } from '../types/auth.ts';
import { getUIText } from '../constants.ts';

interface UsageBannerProps {
  language: Language;
  usage: UsageSummary | null;
}

export const UsageBanner: React.FC<UsageBannerProps> = ({ language, usage }) => {
  if (!usage || usage.isPaid || usage.isAdmin) return null;

  const ui = getUIText(language);
  const tierLabel =
    usage.tier === 'trial'
      ? ui.usageTierTrial.replace('{limit}', String(usage.dailyLimit))
      : ui.usageTierStandard.replace('{limit}', String(usage.dailyLimit));

  return (
    <div className="max-w-4xl mx-auto mb-4 rounded-lg border border-blue-500/30 bg-blue-950/20 px-4 py-3 text-sm text-blue-100 flex flex-wrap items-center justify-between gap-2">
      <div>
        <span className="font-medium">{tierLabel}</span>
        <span className="text-blue-200/80 ml-2">
          {ui.usageRemaining
            .replace('{remaining}', String(usage.remaining))
            .replace('{limit}', String(usage.dailyLimit))}
        </span>
      </div>
      {usage.tier === 'trial' && usage.trialEndsAt && (
        <span className="text-xs text-blue-300/80">
          {ui.usageTrialEnds.replace(
            '{date}',
            new Date(usage.trialEndsAt).toLocaleDateString(language === 'cn' ? 'zh-CN' : 'en-US')
          )}
        </span>
      )}
    </div>
  );
};
