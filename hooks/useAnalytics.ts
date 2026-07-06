import { useCallback } from 'react';
import type { AnalyticsEventType } from '../types/auth.ts';
import { apiFetch } from '../utils/authenticatedFetch.ts';

export const useAnalytics = () => {
  const trackEvent = useCallback(
    (eventType: AnalyticsEventType, metadata?: Record<string, unknown>, path?: string) => {
      void apiFetch('/api/analytics/event', {
        method: 'POST',
        body: JSON.stringify({
          eventType,
          metadata,
          path: path || (typeof window !== 'undefined' ? window.location.pathname : undefined),
        }),
      }).catch(error => {
        console.warn('[analytics] track failed:', eventType, error);
      });
    },
    []
  );

  return { trackEvent };
};
