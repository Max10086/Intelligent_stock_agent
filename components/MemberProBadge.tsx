import React from 'react';
import type { Language } from '../types.ts';
import type { SubscriptionSummary } from '../types/auth.ts';
import { getUIText } from '../constants.ts';

interface MemberProBadgeProps {
  language: Language;
  subscription: SubscriptionSummary | null;
  isLoading?: boolean;
  active?: boolean;
}

const formatBillingDate = (iso: string, language: Language): string =>
  new Date(iso).toLocaleDateString(language === 'cn' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

export const MemberProBadge: React.FC<MemberProBadgeProps> = ({
  language,
  subscription,
  isLoading = false,
  active = false,
}) => {
  if (!active && !subscription?.isPaid) return null;

  const ui = getUIText(language);
  const nextBillingLabel =
    subscription?.nextBillingAt &&
    ui.subscriptionNextBilling.replace(
      '{date}',
      formatBillingDate(subscription.nextBillingAt, language)
    );

  return (
    <div className="relative group">
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-400/35 cursor-default"
        tabIndex={0}
        aria-label={ui.subscriptionActiveTitle}
      >
        <span aria-hidden="true">✓</span>
        {ui.memberProBadge}
      </span>

      <div
        className="pointer-events-none absolute right-0 top-full z-30 mt-2 w-64 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2.5 text-xs text-gray-200 shadow-xl opacity-0 invisible translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:pointer-events-auto"
        role="tooltip"
      >
        <p className="font-medium text-emerald-200">{ui.subscriptionActiveTitle}</p>
        <p className="mt-1 text-gray-300">{ui.subscriptionActiveSubtitle}</p>
        {isLoading || (active && !subscription) ? (
          <p className="mt-2 text-gray-400">
            {language === 'cn' ? '加载订阅信息…' : 'Loading subscription…'}
          </p>
        ) : (
          nextBillingLabel && <p className="mt-2 text-gray-300">{nextBillingLabel}</p>
        )}
        <p className="mt-2 text-gray-500 leading-relaxed">{ui.subscriptionManageHint}</p>
      </div>
    </div>
  );
};
