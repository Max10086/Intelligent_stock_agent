import { useCallback, useEffect, useState } from 'react';
import type { SubscriptionSummary } from '../types/auth.ts';
import { apiFetch, getAuthToken, readApiError } from '../utils/authenticatedFetch.ts';

const needsBillingEnrichment = (summary: SubscriptionSummary | null): boolean =>
  Boolean(summary?.hasSubscription && !summary.nextBillingAt);

export const useSubscriptionStatus = (
  enabled: boolean,
  initialSubscription: SubscriptionSummary | null = null
) => {
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(initialSubscription);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setSubscription(null);
      return;
    }
    setSubscription(initialSubscription);
  }, [enabled, initialSubscription]);

  const refresh = useCallback(async () => {
    if (!enabled || !getAuthToken()) {
      if (!enabled) setSubscription(null);
      return null;
    }

    setIsLoading(true);
    try {
      const response = await apiFetch('/api/billing/status');
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const data = (await response.json()) as SubscriptionSummary;
      setSubscription(data);
      return data;
    } catch (error) {
      console.warn('[subscription] status fetch failed:', error);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    if (needsBillingEnrichment(initialSubscription)) {
      void refresh();
      return;
    }

    if (!initialSubscription) {
      void refresh();
    }
  }, [enabled, initialSubscription, refresh]);

  return { subscription, isLoading, refresh };
};
