import type { CompanyProfile, Language } from '../../types.js';
import type { CninfoFilingBundle } from '../../types/cninfo.js';
import {
  buildCninfoEvidencePromptBlock,
  buildCninfoFilingBundle,
  buildCninfoPrefetchPlan,
  guessCninfoPlate,
  isAShareProfile,
  normalizeAShareSecCode,
  readCninfoEnabled,
} from '../../utils/cninfoFilingContext.js';
import { fetchCninfoReportsViaPython, isCninfoConfigured } from '../lib/cninfoPythonClient.js';

const bundleCache = new Map<string, { fetchedAt: number; bundle: CninfoFilingBundle }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cacheKey = (secCode: string, lang: Language) => `${secCode}:${lang}`;

export const prefetchCninfoFilingsForCompany = async (
  company: Pick<CompanyProfile, 'ticker' | 'exchange' | 'name'>,
  lang: Language
): Promise<CninfoFilingBundle | null> => {
  if (!readCninfoEnabled() || !isCninfoConfigured()) return null;
  if (!isAShareProfile(company)) return null;

  const secCode = normalizeAShareSecCode(company.ticker);
  if (!secCode) return null;

  const key = cacheKey(secCode, lang);
  const cached = bundleCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.bundle;
  }

  const plate = guessCninfoPlate(secCode);
  const fetches = buildCninfoPrefetchPlan();

  try {
    const result = await fetchCninfoReportsViaPython({ secCode, plate, fetches });
    const bundle = buildCninfoFilingBundle({
      secCode,
      plate,
      reports: result.reports,
      errors: result.errors,
      lang,
    });

    if (!bundle.reports.length) {
      console.warn(
        `[cninfo] No reports fetched for ${company.name} (${secCode})${
          bundle.errors.length ? `: ${bundle.errors.map(item => item.message).join('; ')}` : ''
        }`
      );
      return null;
    }

    console.log(
      `[cninfo] Loaded ${bundle.reports.length} filing(s) for ${company.name} (${secCode})` +
        bundle.reports.map(item => ` ${item.kind}@${item.annDate}`).join(',')
    );
    if (bundle.errors.length) {
      console.warn(`[cninfo] Partial errors for ${secCode}:`, bundle.errors);
    }

    bundleCache.set(key, { fetchedAt: Date.now(), bundle });
    return bundle;
  } catch (error) {
    console.warn(
      `[cninfo] Fetch failed for ${company.name} (${secCode}):`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
};

export const getCninfoEvidencePromptBlock = (
  bundle: CninfoFilingBundle | null | undefined,
  lang: Language
): string => {
  if (!bundle?.evidenceText?.trim()) return '';
  return buildCninfoEvidencePromptBlock(bundle.evidenceText, lang);
};
