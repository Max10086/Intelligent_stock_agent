import { useCallback, useEffect, useState } from 'react';
import type { SubscriptionSummary } from '../types/auth.ts';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';

export const useSubscriptionStatus = (enabled: boolean) => {
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setSubscription(null);
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
      setSubscription(null);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { subscription, isLoading, refresh };
};
