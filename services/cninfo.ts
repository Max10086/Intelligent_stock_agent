import type { CompanyProfile, Language } from '../types.ts';
import { isAShareProfile } from '../utils/cninfoFilingContext.ts';
import { apiFetch } from '../utils/authenticatedFetch.ts';

export const fetchCninfoEvidenceBlock = async (
  company: Pick<CompanyProfile, 'ticker' | 'exchange' | 'name'>,
  lang: Language
): Promise<string> => {
  if (!isAShareProfile(company)) return '';

  try {
    const response = await apiFetch('/api/cninfo/filings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: company.ticker,
        exchange: company.exchange,
        name: company.name,
        language: lang,
      }),
    });

    if (!response.ok) {
      console.warn('[cninfo] API request failed:', response.status);
      return '';
    }

    const data = (await response.json()) as { evidenceBlock?: string; loaded?: boolean };
    if (!data.loaded || !data.evidenceBlock?.trim()) {
      return '';
    }
    return data.evidenceBlock;
  } catch (error) {
    console.warn('[cninfo] Failed to load filing excerpts:', error);
    return '';
  }
};
