import { useCallback, useState } from 'react';
import type {
  RecordReturnTrackingRequest,
  RecordReturnTrackingResponse,
  ReturnTrackingCompanyResult,
  ReturnTrackingSourceType,
} from '../types/returnTracking.ts';
import { localObservedDate } from '../utils/localDate.ts';
import { apiFetch } from '../utils/authenticatedFetch.ts';

export const useReturnTracking = () => {
  const [data, setData] = useState<RecordReturnTrackingResponse | null>(null);
  const [isLoadingCached, setIsLoadingCached] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCached = useCallback(
    async (sourceType: ReturnTrackingSourceType, sourceId: string) => {
      setIsLoadingCached(true);
      setError(null);
      try {
        const response = await apiFetch(
          `/api/return-tracking/${sourceType}/${encodeURIComponent(sourceId)}`
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load return tracking');
        }
        const result = payload as RecordReturnTrackingResponse;
        if (result.companies.length > 0) {
          setData(result);
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load return tracking';
        setError(message);
        throw err;
      } finally {
        setIsLoadingCached(false);
      }
    },
    []
  );

  const recordOpen = useCallback(async (request: Omit<RecordReturnTrackingRequest, 'observedDate'>) => {
    setIsRefreshing(true);
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
      setIsRefreshing(false);
    }
  }, []);

  const openAndTrack = useCallback(
    async (request: Omit<RecordReturnTrackingRequest, 'observedDate'>) => {
      try {
        await loadCached(request.sourceType, request.sourceId);
      } catch {
        // Cache miss or first open — fall through to live refresh.
      }
      return recordOpen(request);
    },
    [loadCached, recordOpen]
  );

  const getCompanyResult = useCallback(
    (companyKey: string): ReturnTrackingCompanyResult | undefined =>
      data?.companies.find(company => company.companyKey === companyKey),
    [data]
  );

  return {
    data,
    isLoading: isLoadingCached || isRefreshing,
    isLoadingCached,
    isRefreshing,
    error,
    loadCached,
    recordOpen,
    openAndTrack,
    getCompanyResult,
  };
};
