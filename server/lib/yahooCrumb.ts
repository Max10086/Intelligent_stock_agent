const YAHOO_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CRUMB_TTL_MS = 30 * 60 * 1000;
/** fc.yahoo.com sets the A3 cookie; finance.yahoo.com can overflow headers via node-fetch+SOCKS. */
const BOOTSTRAP_URL = 'https://fc.yahoo.com';
const CRUMB_URL = 'https://query2.finance.yahoo.com/v1/test/getcrumb';

let cachedSession: { cookie: string; crumb: string; expiresAt: number } | null = null;
let mintInFlight: Promise<{ cookie: string; crumb: string }> | null = null;

export const invalidateYahooFinanceSession = (): void => {
  cachedSession = null;
};

const collectSetCookies = (res: Response): string[] => {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }
  const single = res.headers.get('set-cookie');
  return single ? [single] : [];
};

const mergeCookies = (existing: string, setCookies: string[]): string => {
  const jar = new Map<string, string>();
  for (const part of existing.split(';').map(s => s.trim()).filter(Boolean)) {
    const [name, ...rest] = part.split('=');
    if (name) jar.set(name, rest.join('='));
  }
  for (const raw of setCookies) {
    const [pair] = raw.split(';');
    const [name, ...rest] = pair.split('=');
    if (name) jar.set(name.trim(), rest.join('='));
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const isValidCrumb = (crumb: string): boolean =>
  Boolean(crumb) &&
  !crumb.includes('<html>') &&
  !/too many requests/i.test(crumb) &&
  /^[\w./-]+$/.test(crumb);

const mintYahooFinanceSession = async (): Promise<{ cookie: string; crumb: string }> => {
  const headers = { 'User-Agent': YAHOO_USER_AGENT };

  const bootstrapRes = await fetch(BOOTSTRAP_URL, {
    headers,
    redirect: 'follow',
  });
  let cookie = mergeCookies('', collectSetCookies(bootstrapRes));

  if (!cookie) {
    throw new Error('Failed to obtain Yahoo Finance session cookie');
  }

  const crumbRes = await fetch(CRUMB_URL, {
    headers: { ...headers, Cookie: cookie },
    redirect: 'follow',
  });
  cookie = mergeCookies(cookie, collectSetCookies(crumbRes));

  const crumb = (await crumbRes.text()).trim();
  if (crumbRes.status === 429 || /too many requests/i.test(crumb)) {
    throw new Error('Yahoo Finance crumb rate limited (429)');
  }
  if (!isValidCrumb(crumb)) {
    throw new Error(`Failed to obtain Yahoo Finance crumb (status ${crumbRes.status})`);
  }

  return { cookie, crumb };
};

/** Yahoo custom screener POST requires a session cookie + crumb (see yfinance YfData). */
export const getYahooFinanceSession = async (): Promise<{ cookie: string; crumb: string }> => {
  if (cachedSession && cachedSession.expiresAt > Date.now()) {
    return { cookie: cachedSession.cookie, crumb: cachedSession.crumb };
  }

  if (mintInFlight) {
    return mintInFlight;
  }

  mintInFlight = (async () => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const session = await mintYahooFinanceSession();
        cachedSession = { ...session, expiresAt: Date.now() + CRUMB_TTL_MS };
        return session;
      } catch (error) {
        lastError = error;
        invalidateYahooFinanceSession();
        if (attempt < 3) {
          await sleep(1500 * attempt);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  })();

  try {
    return await mintInFlight;
  } finally {
    mintInFlight = null;
  }
};

export const getYahooUserAgent = (): string => YAHOO_USER_AGENT;
