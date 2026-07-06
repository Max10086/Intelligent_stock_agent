import { useCallback, useState } from 'react';
import type {
  RecordReturnTrackingRequest,
  RecordReturnTrackingResponse,
  ReturnTrackingCompanyResult,
} from '../types/returnTracking.ts';
import { localObservedDate } from '../utils/localDate.ts';
import { apiFetch } from '../utils/authenticatedFetch.ts';

export const useReturnTracking = () => {
  const [data, setData] = useState<RecordReturnTrackingResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordOpen = useCallback(async (request: Omit<RecordReturnTrackingRequest, 'observedDate'>) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch('/api/return-tracking/record', {
        method: 'POST',
        body: JSON.stringify({
          ...request,
          observedDate: localObservedDate(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to record return tracking');
      }
      const result = payload as RecordReturnTrackingResponse;
      setData(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record return tracking';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getCompanyResult = useCallback(
    (companyKey: string): ReturnTrackingCompanyResult | undefined =>
      data?.companies.find(company => company.companyKey === companyKey),
    [data]
  );

  return {
    data,
    isLoading,
    error,
    recordOpen,
    getCompanyResult,
  };
};
