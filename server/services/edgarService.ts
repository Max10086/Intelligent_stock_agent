import type { CompanyProfile, Language } from '../../types.js';
import type { EdgarFilingBundle } from '../../types/edgar.js';
import {
  buildEdgarEvidencePromptBlock,
  buildEdgarFilingBundle,
  buildEdgarPrefetchPlan,
  isUSProfile,
  normalizeUSTicker,
  readEdgarEnabled,
} from '../../utils/edgarFilingContext.js';
import { fetchEdgarReportsViaPython, isEdgarConfigured } from '../lib/edgarPythonClient.js';

const bundleCache = new Map<string, { fetchedAt: number; bundle: EdgarFilingBundle }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cacheKey = (ticker: string, lang: Language) => `${ticker}:${lang}`;

export const prefetchEdgarFilingsForCompany = async (
  company: Pick<CompanyProfile, 'ticker' | 'exchange' | 'name'>,
  lang: Language
): Promise<EdgarFilingBundle | null> => {
  if (!readEdgarEnabled() || !isEdgarConfigured()) return null;
  if (!isUSProfile(company)) return null;

  const ticker = normalizeUSTicker(company.ticker);
  if (!ticker) return null;

  const key = cacheKey(ticker, lang);
  const cached = bundleCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.bundle;
  }

  const fetches = buildEdgarPrefetchPlan();

  try {
    const result = await fetchEdgarReportsViaPython({ ticker, fetches });
    const bundle = buildEdgarFilingBundle({
      ticker,
      reports: result.reports,
      errors: result.errors,
      lang,
    });

    if (!bundle.reports.length) {
      console.warn(
        `[edgar] No reports fetched for ${company.name} (${ticker})${
          bundle.errors.length ? `: ${bundle.errors.map(item => item.message).join('; ')}` : ''
        }`
      );
      return null;
    }

    console.log(
      `[edgar] Loaded ${bundle.reports.length} filing(s) for ${company.name} (${ticker})` +
        bundle.reports.map(item => ` ${item.form}@${item.filingDate}`).join(',')
    );
    if (bundle.errors.length) {
      console.warn(`[edgar] Partial errors for ${ticker}:`, bundle.errors);
    }

    bundleCache.set(key, { fetchedAt: Date.now(), bundle });
    return bundle;
  } catch (error) {
    console.warn(
      `[edgar] Fetch failed for ${company.name} (${ticker}):`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
};

export const getEdgarEvidencePromptBlock = (
  bundle: EdgarFilingBundle | null | undefined,
  lang: Language
): string => {
  if (!bundle?.evidenceText?.trim()) return '';
  return buildEdgarEvidencePromptBlock(bundle.evidenceText, lang);
};
