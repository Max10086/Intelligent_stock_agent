import { normalizeInstitutionCik } from '../../utils/thirteenFInstitutionSearch.js';
import { secFetchJson } from './secRequestClient.js';

export interface SecCompanyProfile {
  cik: string;
  name: string;
  ticker: string | null;
  formerNames: string[];
}

const profileCache = new Map<string, SecCompanyProfile>();

export const fetchSecCompanyProfile = async (
  cik: string
): Promise<SecCompanyProfile | null> => {
  const normalized = normalizeInstitutionCik(cik);
  const cached = profileCache.get(normalized);
  if (cached) return cached;

  try {
    const payload = await secFetchJson<{
      name?: string;
      tickers?: string[];
      formerNames?: Array<{ name?: string }>;
    }>(`https://data.sec.gov/submissions/CIK${normalized}.json`);
    const name = payload.name?.trim();
    if (!name) return null;

    const ticker =
      payload.tickers?.map(item => item.trim().toUpperCase()).find(item => /^[A-Z0-9.-]{1,8}$/.test(item)) ??
      null;

    const formerNames = (payload.formerNames ?? [])
      .map(item => item.name?.trim())
      .filter((item): item is string => Boolean(item))
      .filter(item => item !== name);

    const profile: SecCompanyProfile = { cik: normalized, name, ticker, formerNames };
    profileCache.set(normalized, profile);
    return profile;
  } catch (error) {
    console.warn(
      `[13f] SEC company profile failed for ${normalized}:`,
      error instanceof Error ? error.message : error
    );
    return null;
  }
};

export const fetchSecCompanyProfiles = async (
  ciks: string[]
): Promise<Map<string, SecCompanyProfile>> => {
  const unique = [...new Set(ciks.map(normalizeInstitutionCik))];
  const profiles = await Promise.all(unique.map(cik => fetchSecCompanyProfile(cik)));
  const map = new Map<string, SecCompanyProfile>();
  for (const profile of profiles) {
    if (profile) map.set(profile.cik, profile);
  }
  return map;
};
