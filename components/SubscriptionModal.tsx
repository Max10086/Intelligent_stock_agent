import React from 'react';
import type { Language } from '../types.ts';
import type { UserProfile } from '../types/auth.ts';
import { getUIText } from '../constants.ts';
import { PayPalSubscribeButton } from './PayPalSubscribeButton.tsx';

interface SubscriptionModalProps {
  isOpen: boolean;
  language: Language;
  user: UserProfile | null;
  onClose: () => void;
  onActivated: () => void | Promise<void>;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  isOpen,
  language,
  user,
  onClose,
  onActivated,
}) => {
  const ui = getUIText(language);
  const [error, setError] = React.useState<string | null>(null);
  const isSubscribed = user?.isPaid || user?.hasSubscription;

  if (!isOpen) return null;

  if (!user) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
        <div className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
          <p className="text-sm text-red-200">
            {language === 'cn'
              ? '无法加载账户信息。请刷新页面或检查数据库迁移是否已执行。'
              : 'Could not load your account. Refresh the page or ensure database migrations have been applied.'}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 rounded-md bg-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-600"
          >
            {language === 'cn' ? '关闭' : 'Close'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div
        className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-modal-title"
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="subscription-modal-title" className="text-xl font-semibold text-gray-100">
              {ui.subscriptionTitle}
            </h2>
            <p className="text-sm text-gray-400 mt-1">{ui.subscriptionSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
            aria-label={language === 'cn' ? '关闭' : 'Close'}
          >
            ×
          </button>
        </div>

        <ul className="mb-5 space-y-2 text-sm text-gray-300">
          {ui.subscriptionBenefits.map((benefit, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-green-400">✓</span>
              <span>{benefit}</span>
            </li>
          ))}
        </ul>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <PayPalSubscribeButton
          userId={user.id}
          userEmail={user.email}
          disabled={isSubscribed}
          onActivated={async () => {
            setError(null);
            await onActivated();
            onClose();
          }}
          onError={setError}
        />

        <p className="mt-4 text-xs text-gray-500">{ui.subscriptionFootnote}</p>
      </div>
    </div>
  );
};
