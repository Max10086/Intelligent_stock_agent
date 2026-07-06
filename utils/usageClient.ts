import type { UsageSummary } from '../types/auth.ts';
import { apiFetch, readApiError } from '../utils/authenticatedFetch.ts';

export const checkUsageQuota = async (requestedCompanies = 1): Promise<UsageSummary> => {
  const response = await apiFetch('/api/usage/check', {
    method: 'POST',
    body: JSON.stringify({ requestedCompanies }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || (await readApiError(response)));
  }
  return payload.usage as UsageSummary;
};

export const recordCompanyUsage = async (params: {
  reportId: string;
  companyId: string;
  ticker: string;
}) => {
  const response = await apiFetch('/api/usage/record', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    console.warn('[usage] record failed:', await readApiError(response));
    return null;
  }
  return response.json();
};
