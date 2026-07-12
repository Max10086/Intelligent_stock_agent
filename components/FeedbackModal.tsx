import React, { useEffect, useMemo, useState } from 'react';
import type { Language } from '../types.ts';
import type { FeedbackCategory } from '../types/auth.ts';
import { getUIText } from '../constants.ts';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';

interface FeedbackModalProps {
  isOpen: boolean;
  language: Language;
  onClose: () => void;
  initialCategory?: FeedbackCategory;
  initialMessage?: string;
  initialRating?: number;
  context?: Record<string, unknown>;
}

const CATEGORIES: FeedbackCategory[] = ['bug', 'feature', 'quality', 'pricing', 'other'];

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  isOpen,
  language,
  onClose,
  initialCategory = 'other',
  initialMessage = '',
  initialRating,
  context,
}) => {
  const ui = getUIText(language);
  const [category, setCategory] = useState<FeedbackCategory>(initialCategory);
  const [message, setMessage] = useState(initialMessage);
  const [rating, setRating] = useState<number | ''>(initialRating ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setCategory(initialCategory);
    setMessage(initialMessage);
    setRating(initialRating ?? '');
    setError(null);
    setSuccess(false);
  }, [isOpen, initialCategory, initialMessage, initialRating]);

  const categoryLabel = useMemo(
    () => ({
      bug: ui.feedbackCategoryBug,
      feature: ui.feedbackCategoryFeature,
      quality: ui.feedbackCategoryQuality,
      pricing: ui.feedbackCategoryPricing,
      other: ui.feedbackCategoryOther,
    }),
    [ui]
  );

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (message.trim().length < 3) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category,
          message: message.trim(),
          rating: rating === '' ? undefined : rating,
          context,
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      setSuccess(true);
      window.setTimeout(() => onClose(), 1200);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to submit feedback');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div
        className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-100">{ui.feedbackTitle}</h2>
            <p className="mt-1 text-sm text-gray-400">{ui.feedbackSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
          >
            ×
          </button>
        </div>

        {success ? (
          <p className="rounded-lg border border-green-700/50 bg-green-950/30 px-4 py-3 text-sm text-green-200">
            {ui.feedbackThanks}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm text-gray-300">{ui.feedbackCategoryLabel}</label>
              <select
                value={category}
                onChange={event => setCategory(event.target.value as FeedbackCategory)}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
              >
                {CATEGORIES.map(item => (
                  <option key={item} value={item}>
                    {categoryLabel[item]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-gray-300">{ui.feedbackMessageLabel}</label>
              <textarea
                value={message}
                onChange={event => setMessage(event.target.value)}
                rows={5}
                placeholder={ui.feedbackMessagePlaceholder}
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
                required
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-gray-300">Rating (optional)</label>
              <select
                value={rating}
                onChange={event =>
                  setRating(event.target.value === '' ? '' : Number(event.target.value))
                }
                className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
              >
                <option value="">—</option>
                {[5, 4, 3, 2, 1].map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            {error && <p className="text-sm text-red-300">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-600"
              >
                {language === 'cn' ? '取消' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || message.trim().length < 3}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {isSubmitting ? ui.feedbackSubmitting : ui.feedbackSubmit}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
