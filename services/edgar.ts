import type { CompanyProfile, Language } from '../types.ts';
import { isUSProfile } from '../utils/edgarFilingContext.ts';
import { apiFetch } from '../utils/authenticatedFetch.ts';

export const fetchEdgarEvidenceBlock = async (
  company: Pick<CompanyProfile, 'ticker' | 'exchange' | 'name'>,
  lang: Language
): Promise<string> => {
  if (!isUSProfile(company)) return '';

  try {
    const response = await apiFetch('/api/edgar/filings', {
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
      console.warn('[edgar] API request failed:', response.status);
      return '';
    }

    const data = (await response.json()) as { evidenceBlock?: string; loaded?: boolean };
    if (!data.loaded || !data.evidenceBlock?.trim()) {
      return '';
    }
    return data.evidenceBlock;
  } catch (error) {
    console.warn('[edgar] Failed to load filing excerpts:', error);
    return '';
  }
};
