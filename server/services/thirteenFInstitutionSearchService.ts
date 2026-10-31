import type { ThirteenFInstitution } from '../../types/thirteenF.js';
import { readEdgarIdentity } from '../../utils/edgarFilingContext.js';
import {
  buildSecSearchQueries,
  normalizeInstitutionCik,
  normalizeInstitutionQuery,
  parseInstitutionCikQuery,
  resolveAliasCik,
  resolveInstitutionCik,
  scoreInstitutionMatch,
} from '../../utils/thirteenFInstitutionSearch.js';
import {
  getInstitutionByCik,
  THIRTEEN_F_INSTITUTION_CATALOG,
} from './thirteenFMockData.js';
import { isThirteenFLiveDataEnabled } from './thirteenFEdgarService.js';
import { fetchSecCompanyProfile, fetchSecCompanyProfiles } from '../lib/secSubmissionsClient.js';
import { secFetchJson } from '../lib/secRequestClient.js';

interface SecSearchHit {
  ciks?: string[];
  display_names?: string[];
  form?: string;
  file_date?: string;
}

type InstitutionSearchRow = ThirteenFInstitution & { latestFilingDate?: string };

const parseInstitutionFromDisplayName = (
  displayName: string,
  cik: string,
  latestFilingDate?: string
): InstitutionSearchRow | null => {
  const cleaned = displayName.replace(/\s*\(CIK[^)]+\)\s*/i, '').trim();
  if (!cleaned) return null;
  const shortName =
    cleaned.length > 28 ? `${cleaned.slice(0, 25).trim()}…` : cleaned;
  return {
    cik: normalizeInstitutionCik(cik),
    name: cleaned,
    shortName,
    latestQuarter: undefined,
    latestFilingDate,
  };
};

const mergeInstitution = (
  merged: Map<string, InstitutionSearchRow>,
  item: InstitutionSearchRow
): void => {
  const resolvedCik = resolveInstitutionCik(item.cik);
  const normalized: InstitutionSearchRow = {
    ...item,
    cik: resolvedCik,
  };
  const existing = merged.get(resolvedCik);
  if (!existing) {
    merged.set(resolvedCik, normalized);
    return;
  }
  const existingDate = existing.latestFilingDate ?? '';
  const nextDate = normalized.latestFilingDate ?? '';
  if (nextDate > existingDate) {
    merged.set(resolvedCik, { ...existing, ...normalized, latestFilingDate: nextDate });
  }
};

const fetchSecSearchHits = async (secQuery: string): Promise<ThirteenFInstitution[]> => {
  const identity = readEdgarIdentity();
  if (!identity) return [];

  const url = new URL('https://efts.sec.gov/LATEST/search-index');
  url.searchParams.set('q', secQuery);
  url.searchParams.set('forms', '13F-HR');

  const payload = await secFetchJson<{
    hits?: { hits?: Array<{ _source?: SecSearchHit }> };
  }>(url.toString());

  const byCik = new Map<string, InstitutionSearchRow>();

  for (const hit of payload.hits?.hits ?? []) {
    const source = hit._source;
    if (!source?.ciks?.length || !source.display_names?.length) continue;
    const hitCik = normalizeInstitutionCik(source.ciks[0]);
    const resolvedCik = resolveInstitutionCik(hitCik);
    const fileDate = source.file_date ?? '';
    const existing = byCik.get(resolvedCik);
    if (existing && fileDate <= (existing.latestFilingDate ?? '')) {
      continue;
    }

    const institution = parseInstitutionFromDisplayName(
      source.display_names[0],
      hitCik,
      fileDate
    );
    if (institution) {
      institution.cik = resolvedCik;
      byCik.set(resolvedCik, institution);
    }
  }

  return [...byCik.values()];
};

const searchInstitutionsFromSecMulti = async (
  query: string
): Promise<ThirteenFInstitution[]> => {
  const secQueries = buildSecSearchQueries(query);
  if (secQueries.length === 0) return [];

  const batches = await Promise.all(
    secQueries.map(async secQuery => {
      try {
        return await fetchSecSearchHits(secQuery);
      } catch (error) {
        console.warn(
          `[13f] SEC search query failed (${secQuery}):`,
          error instanceof Error ? error.message : error
        );
        return [];
      }
    })
  );

  const merged = new Map<string, InstitutionSearchRow>();
  for (const batch of batches) {
    for (const item of batch) {
      mergeInstitution(merged, item);
    }
  }

  return [...merged.values()];
};

const catalogCikSet = (): Set<string> =>
  new Set(THIRTEEN_F_INSTITUTION_CATALOG.map(item => item.cik));

const rankInstitutions = (
  institutions: InstitutionSearchRow[],
  query: string,
  aliasCik: string | null,
  cikQuery: string | null,
  exactCikCiks: Set<string>
): ThirteenFInstitution[] => {
  const knownCiks = catalogCikSet();
  const normalizedQuery = normalizeInstitutionQuery(query).toLowerCase();
  const resolvedAliasCik = aliasCik ? resolveInstitutionCik(aliasCik) : null;

  const scored = institutions
    .map(inst => ({
      inst,
      score: scoreInstitutionMatch(inst.name, query, {
        inCatalog: knownCiks.has(inst.cik),
        aliasHit: resolvedAliasCik === inst.cik,
        latestFilingDate: inst.latestFilingDate,
        exactCikMatch: exactCikCiks.has(normalizeInstitutionCik(inst.cik)),
        institutionCik: inst.cik,
        cikQuery,
      }),
    }))
    .filter(row => row.score >= 25);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.inst.name.localeCompare(b.inst.name);
  });

  const filtered =
    scored.length > 0
      ? scored
      : institutions.map(inst => ({
          inst,
          score: scoreInstitutionMatch(inst.name, query, {
            inCatalog: knownCiks.has(inst.cik),
            aliasHit: resolvedAliasCik === inst.cik,
            latestFilingDate: inst.latestFilingDate,
            exactCikMatch: exactCikCiks.has(normalizeInstitutionCik(inst.cik)),
            institutionCik: inst.cik,
            cikQuery,
          }),
        }));

  const minScore =
    tokenCount(normalizedQuery) >= 2 ? 20 : 15;

  return filtered
    .filter(row => row.score >= minScore)
    .slice(0, 12)
    .map(row => {
      const { latestFilingDate: _drop, ...institution } = row.inst;
      return institution;
    });
};

const tokenCount = (query: string): number =>
  query.split(/\s+/).filter(token => token.length >= 2).length;

const enrichInstitutionsWithSecProfiles = async (
  institutions: ThirteenFInstitution[]
): Promise<ThirteenFInstitution[]> => {
  if (institutions.length === 0) return institutions;

  const profiles = await fetchSecCompanyProfiles(institutions.map(item => item.cik));
  return institutions.map(inst => {
    const profile = profiles.get(normalizeInstitutionCik(inst.cik));
    if (!profile) return inst;

    const filingName = inst.name.trim();
    const formerNames = [...profile.formerNames];
    if (
      filingName &&
      filingName.toLowerCase() !== profile.name.toLowerCase() &&
      !formerNames.some(name => name.toLowerCase() === filingName.toLowerCase())
    ) {
      formerNames.unshift(filingName);
    }

    const shortName =
      profile.name.length > 28 ? `${profile.name.slice(0, 25).trim()}…` : profile.name;

    return {
      ...inst,
      name: profile.name,
      shortName,
      formerNames: formerNames.length > 0 ? formerNames : undefined,
    };
  });
};

const collectLocalMatches = (query: string): ThirteenFInstitution[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return THIRTEEN_F_INSTITUTION_CATALOG.slice(0, 12);
  }

  const cikQuery = parseInstitutionCikQuery(query);
  const digitSuffix = cikQuery?.replace(/^0+/, '') ?? normalized.replace(/\D/g, '');

  return THIRTEEN_F_INSTITUTION_CATALOG.filter(item => {
    const itemCik = normalizeInstitutionCik(item.cik);
    if (cikQuery && itemCik === cikQuery) return true;
    if (digitSuffix.length >= 3 && itemCik.includes(digitSuffix)) return true;
    return (
      item.name.toLowerCase().includes(normalized) ||
      item.shortName?.toLowerCase().includes(normalized) ||
      itemCik.includes(normalized.replace(/\D/g, ''))
    );
  });
};

const lookupInstitutionByCik = async (cikInput: string): Promise<ThirteenFInstitution | null> => {
  const cik = resolveInstitutionCik(cikInput);
  const catalogHit = getInstitutionByCik(cik);

  if (isThirteenFLiveDataEnabled()) {
    try {
      const profile = await fetchSecCompanyProfile(cik);
      if (profile?.name) {
        const shortName =
          profile.name.length > 28 ? `${profile.name.slice(0, 25).trim()}…` : profile.name;
        return {
          cik: profile.cik,
          name: profile.name,
          shortName,
          formerNames: profile.formerNames.length > 0 ? profile.formerNames : undefined,
          description: catalogHit?.description,
          latestQuarter: catalogHit?.latestQuarter,
        };
      }
    } catch (error) {
      console.warn(
        `[13f] CIK profile lookup failed for ${cik}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return catalogHit ?? null;
};

export const searchInstitutionsRanked = async (
  query: string
): Promise<ThirteenFInstitution[]> => {
  const normalizedQuery = normalizeInstitutionQuery(query);
  if (!normalizedQuery) {
    return THIRTEEN_F_INSTITUTION_CATALOG.slice(0, 12);
  }

  const aliasCik = resolveAliasCik(normalizedQuery);
  const aliasInstitution = aliasCik ? getInstitutionByCik(aliasCik) : undefined;
  const cikQuery = parseInstitutionCikQuery(normalizedQuery);
  const exactCikCiks = new Set<string>();

  const merged = new Map<string, InstitutionSearchRow>();

  for (const item of collectLocalMatches(normalizedQuery)) {
    mergeInstitution(merged, { ...item, latestFilingDate: undefined });
  }

  if (aliasInstitution) {
    mergeInstitution(merged, {
      ...aliasInstitution,
      cik: resolveInstitutionCik(aliasInstitution.cik),
      latestFilingDate: undefined,
    });
  }

  if (cikQuery) {
    exactCikCiks.add(cikQuery);
    const byCik = await lookupInstitutionByCik(cikQuery);
    if (byCik) {
      mergeInstitution(merged, { ...byCik, latestFilingDate: undefined });
    }
  }

  if (isThirteenFLiveDataEnabled() && normalizedQuery.length >= 2 && !cikQuery) {
    try {
      const secResults = await searchInstitutionsFromSecMulti(normalizedQuery);
      for (const item of secResults) {
        mergeInstitution(merged, item);
      }
    } catch (error) {
      console.warn(
        '[13f] SEC institution search failed:',
        error instanceof Error ? error.message : error
      );
    }
  }

  const ranked = rankInstitutions(
    [...merged.values()],
    normalizedQuery,
    aliasCik,
    cikQuery,
    exactCikCiks
  );
  if (isThirteenFLiveDataEnabled() && ranked.length > 0) {
    try {
      return await enrichInstitutionsWithSecProfiles(ranked);
    } catch (error) {
      console.warn(
        '[13f] SEC company profile enrichment failed:',
        error instanceof Error ? error.message : error
      );
    }
  }
  return ranked;
};
