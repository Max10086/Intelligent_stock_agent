/** Maps nicknames / manager names → CIK for institution search. */
export const THIRTEEN_F_INSTITUTION_ALIASES: Record<string, string> = {
  druckenmiller: '0001536411',
  'stanley druckenmiller': '0001536411',
  dalio: '0001350694',
  'ray dalio': '0001350694',
  buffett: '0001067983',
  'warren buffett': '0001067983',
  ackman: '0001336528',
  'bill ackman': '0001336528',
  tepper: '0001656456',
  'david tepper': '0001656456',
  appaloosa: '0001656456',
  'appaloosa lp': '0001656456',
  'appaloosa management': '0001656456',
  'appaloosa management lp': '0001656456',
  burry: '0001649339',
  'michael burry': '0001649339',
  scion: '0001649339',
  'scion asset management': '0001649339',
  'cathie wood': '0001697748',
  'ark invest': '0001697748',
  'ark investment management': '0001697748',
  nikko: '0001480751',
  'nikko asset management': '0001480751',
  'nikko asset management americas': '0001480751',
  amova: '0001480751',
  'amova asset management': '0001480751',
  'amova asset management americas': '0001480751',
  sprott: '0001512920',
  'sprott inc': '0001512920',
  'sprott asset management': '0001512920',
  'sprott asset management inc': '0001512920',
  'sprott asset management lp': '0001512920',
  'ra capital': '0001346824',
  'ra capital management': '0001346824',
  'ra capital management lp': '0001346824',
  'baker brothers': '0001263508',
  'baker bros': '0001263508',
  'baker bros advisors': '0001263508',
  'rtw investments': '0001493215',
  'rtw investments lp': '0001493215',
};

/** Legacy / renamed filers → current active 13F CIK. */
export const THIRTEEN_F_CIK_REDIRECTS: Record<string, string> = {
  /** Appaloosa Management LP (last filed 2015) → Appaloosa LP (active). */
  '0001006438': '0001656456',
  /** Catalog typo: Scion was incorrectly mapped to Jefferies High Yield Trading. */
  '0001420793': '0001649339',
  /** Legacy Sprott Asset Management Inc (revoked) → active Sprott Inc 13F filer. */
  '0001277006': '0001512920',
};

export const normalizeInstitutionCik = (cik: string): string =>
  cik.replace(/\D/g, '').padStart(10, '0');

/** Follow superseded CIK mappings before SEC fetch or cache lookup. */
export const resolveInstitutionCik = (cik: string): string => {
  const normalized = normalizeInstitutionCik(cik);
  return THIRTEEN_F_CIK_REDIRECTS[normalized] ?? normalized;
};

const LEGAL_SUFFIX_PATTERN =
  /\b(inc\.?|corp\.?|corporation|llc|l\.l\.c\.|lp|l\.p\.|ltd\.?|limited|plc|co\.?|company)\b/gi;

export const normalizeInstitutionQuery = (query: string): string =>
  query.trim().replace(/\s+/g, ' ');

/** True when the query is numeric / CIK-shaped (not a name search). */
export const isInstitutionCikSearchQuery = (query: string): boolean => {
  const trimmed = normalizeInstitutionQuery(query);
  if (!trimmed) return false;
  if (/^cik[\s#:-]*\d{1,10}$/i.test(trimmed)) return true;
  return /^\d{3,10}$/.test(trimmed.replace(/\s/g, ''));
};

/** Minimum characters before firing institution search (CIK allows 3 digits). */
export const institutionSearchMinQueryLength = (query: string): number =>
  isInstitutionCikSearchQuery(query) ? 3 : 2;

/**
 * Parse user input into a 10-digit institution CIK when the query is CIK-shaped.
 * Supports `1350694`, `0001350694`, `CIK 1350694`, etc.
 */
export const parseInstitutionCikQuery = (query: string): string | null => {
  const trimmed = normalizeInstitutionQuery(query);
  if (!trimmed) return null;

  let digits = '';
  const cikPrefix = trimmed.match(/^cik[\s#:-]*(\d{1,10})$/i);
  if (cikPrefix) {
    digits = cikPrefix[1] ?? '';
  } else if (/^\d{3,10}$/.test(trimmed.replace(/\s/g, ''))) {
    digits = trimmed.replace(/\D/g, '');
  } else {
    return null;
  }

  if (digits.length < 3 || digits.length > 10) return null;
  return normalizeInstitutionCik(digits);
};

export const tokenizeInstitutionQuery = (query: string): string[] =>
  normalizeInstitutionQuery(query)
    .toLowerCase()
    .split(/\s+/)
    .filter(token => token.length >= 2);

export const stripLegalSuffixes = (name: string): string =>
  name.replace(LEGAL_SUFFIX_PATTERN, '').replace(/\s+/g, ' ').trim();

export const buildSecSearchQueries = (rawQuery: string): string[] => {
  const normalized = normalizeInstitutionQuery(rawQuery);
  if (normalized.length < 2) return [];

  const tokens = tokenizeInstitutionQuery(normalized);
  const queries = new Set<string>();

  queries.add(`"${normalized}"`);

  if (tokens.length >= 2) {
    queries.add(tokens.map(token => `"${token}"`).join(' AND '));
    queries.add(tokens.join(' '));
  }

  const stripped = stripLegalSuffixes(normalized);
  if (stripped.length >= 2 && stripped.toLowerCase() !== normalized.toLowerCase()) {
    queries.add(`"${stripped}"`);
    const strippedTokens = tokenizeInstitutionQuery(stripped);
    if (strippedTokens.length >= 2) {
      queries.add(strippedTokens.map(token => `"${token}"`).join(' AND '));
    }
  }

  if (tokens.length === 1) {
    queries.add(`"${tokens[0]}"`);
  } else if (tokens.length >= 2) {
    // e.g. "Appaloosa Management" also search "Appaloosa" to find renamed filers (Appaloosa LP).
    queries.add(`"${tokens[0]}"`);
  }

  return [...queries];
};

export const scoreInstitutionMatch = (
  name: string,
  query: string,
  options?: {
    inCatalog?: boolean;
    aliasHit?: boolean;
    latestFilingDate?: string;
    exactCikMatch?: boolean;
    institutionCik?: string;
    cikQuery?: string | null;
  }
): number => {
  const normalizedQuery = normalizeInstitutionQuery(query).toLowerCase();
  if (!normalizedQuery) return 0;

  if (options?.exactCikMatch) return 600;

  const cikQuery = options?.cikQuery ? parseInstitutionCikQuery(options.cikQuery) : null;
  if (cikQuery && options?.institutionCik && normalizeInstitutionCik(options.institutionCik) === cikQuery) {
    return 580;
  }

  const normalizedName = name.toLowerCase();
  const tokens = tokenizeInstitutionQuery(normalizedQuery);
  let score = 0;

  if (cikQuery && normalizedName.includes(cikQuery.replace(/^0+/, ''))) {
    score += 40;
  }

  if (options?.aliasHit) score += 250;
  if (options?.inCatalog) score += 30;

  const filingYear = options?.latestFilingDate
    ? Number.parseInt(options.latestFilingDate.slice(0, 4), 10)
    : NaN;
  if (Number.isFinite(filingYear)) {
    if (filingYear >= 2025) score += 90;
    else if (filingYear >= 2023) score += 50;
    else if (filingYear >= 2020) score += 15;
    else score -= 120;
  }

  if (normalizedName === normalizedQuery) score += 200;
  if (normalizedName.startsWith(normalizedQuery)) score += 120;
  if (normalizedName.includes(normalizedQuery)) score += 90;

  const strippedName = stripLegalSuffixes(normalizedName);
  const strippedQuery = stripLegalSuffixes(normalizedQuery);
  if (strippedQuery && strippedName.startsWith(strippedQuery)) score += 70;
  if (strippedQuery && strippedName.includes(strippedQuery)) score += 50;

  if (tokens.length > 0) {
    const matched = tokens.filter(token => normalizedName.includes(token)).length;
    score += (matched / tokens.length) * 60;

    if (tokens.every(token => normalizedName.includes(token))) {
      score += 40;
    }
  }

  if (tokens.length === 1) {
    const token = tokens[0];
    const wordBoundary = new RegExp(`\\b${escapeRegExp(token)}`, 'i');
    if (wordBoundary.test(name)) score += 35;
    if (normalizedName.startsWith(token)) score += 25;
    else if (normalizedName.includes(token)) score -= 5;
  }

  return score;
};

export const resolveAliasCik = (query: string): string | null => {
  const key = normalizeInstitutionQuery(query).toLowerCase();
  if (!key) return null;
  return THIRTEEN_F_INSTITUTION_ALIASES[key] ?? null;
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const buildHighlightPattern = (query: string): RegExp | null => {
  const tokens = tokenizeInstitutionQuery(query);
  if (tokens.length === 0) return null;
  return new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
};

export const splitByHighlightPattern = (
  text: string,
  pattern: RegExp | null
): Array<{ text: string; highlight: boolean }> => {
  if (!pattern) return [{ text, highlight: false }];

  const parts: Array<{ text: string; highlight: boolean }> = [];
  let lastIndex = 0;
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

  for (const match of text.matchAll(globalPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, index), highlight: false });
    }
    parts.push({ text: match[0], highlight: true });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), highlight: false });
  }

  return parts.length > 0 ? parts : [{ text, highlight: false }];
};
