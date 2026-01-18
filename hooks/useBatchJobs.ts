import { useState, useCallback, useEffect } from 'react';
import { Language } from '../types.ts';

interface BatchJobStatus {
  batchJobId: string;
  overallStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  stats: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  jobs: Array<{
    id: string;
    ticker: string;
    status: string;
    result?: any;
  }>;
}

const API_BASE_URL = typeof window !== 'undefined' ? '' : 'http://localhost:3001';

export const useBatchJobs = () => {
  const [activeBatchJobId, setActiveBatchJobId] = useState<string | null>(null);
  const [batchJobStatus, setBatchJobStatus] = useState<BatchJobStatus | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const submitBatchJob = useCallback(async (tickers: string, language: Language) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/jobs/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tickers,
          language,
        }),
      });

      if (!response.ok) {
        // Check if response has content before parsing JSON
        const contentType = response.headers.get('content-type');
        let errorMessage = `HTTP error! status: ${response.status}`;
        
        if (contentType && contentType.includes('application/json')) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            // If JSON parsing fails, try to get text
            const text = await response.text();
            errorMessage = text || errorMessage;
          }
        } else {
          const text = await response.text();
          errorMessage = text || errorMessage;
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setActiveBatchJobId(data.batchJobId);
      setIsPolling(true);
      return data.batchJobId;
    } catch (error) {
      console.error('Error submitting batch job:', error);
      throw error;
    }
  }, []);

  const fetchBatchJobStatus = useCallback(async (batchJobId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/jobs/batch/${batchJobId}`);
      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let errorMessage = `HTTP error! status: ${response.status}`;
        
        if (contentType && contentType.includes('application/json')) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            const text = await response.text();
            errorMessage = text || errorMessage;
          }
        } else {
          const text = await response.text();
          errorMessage = text || errorMessage;
        }
        
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      setBatchJobStatus(data);
      return data;
    } catch (error) {
      console.error('Error fetching batch job status:', error);
      throw error;
    }
  }, []);

  // Poll for status updates
  useEffect(() => {
    if (!activeBatchJobId || !isPolling) {
      return;
    }

    const pollInterval = setInterval(async () => {
      try {
        const status = await fetchBatchJobStatus(activeBatchJobId);
        if (status.overallStatus === 'COMPLETED' || status.overallStatus === 'FAILED') {
          setIsPolling(false);
        }
      } catch (error) {
        console.error('Error polling batch job status:', error);
      }
    }, 3000); // Poll every 3 seconds

    // Initial fetch
    fetchBatchJobStatus(activeBatchJobId);

    return () => clearInterval(pollInterval);
  }, [activeBatchJobId, isPolling, fetchBatchJobStatus]);

  const clearBatchJob = useCallback(() => {
    setActiveBatchJobId(null);
    setBatchJobStatus(null);
    setIsPolling(false);
  }, []);

  return {
    activeBatchJobId,
    batchJobStatus,
    isPolling,
    submitBatchJob,
    fetchBatchJobStatus,
    clearBatchJob,
  };
};
