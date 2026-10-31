import { readEdgarIdentity } from '../../utils/edgarFilingContext.js';

/** SEC fair-access policy: max 10 requests/second per IP. Stay well under that. */
const MIN_INTERVAL_MS = 180;
const MAX_429_RETRIES = 5;
const BACKOFF_MS = [8_000, 20_000, 45_000, 90_000, 180_000];

let lastRequestAt = 0;
let globalCooldownUntil = 0;
let queue: Promise<void> = Promise.resolve();

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const waitForSlot = async (): Promise<void> => {
  const now = Date.now();
  if (globalCooldownUntil > now) {
    await sleep(globalCooldownUntil - now);
  }
  const elapsed = Date.now() - lastRequestAt;
  if (elapsed < MIN_INTERVAL_MS) {
    await sleep(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestAt = Date.now();
};

export type SecFetchInit = RequestInit;

const formatSecError = (status: number, url: string): string => {
  const base = `SEC request failed (${status}) for ${url}`;
  if (status === 429) {
    return `${base}. SEC is temporarily rate-limiting this IP — wait 5–15 minutes before retrying (not an account block).`;
  }
  return base;
};

/** Serialized SEC HTTP fetch with global rate limiting and 429 backoff. */
export const secFetch = async (
  url: string,
  init: SecFetchInit = {},
  attempt = 0
): Promise<Response> => {
  const identity = readEdgarIdentity();
  if (!identity) {
    throw new Error('EDGAR_IDENTITY is not configured');
  }

  const run = async (): Promise<Response> => {
    await waitForSlot();
    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
        'User-Agent': identity,
      },
    });

    if (response.status === 429 && attempt < MAX_429_RETRIES) {
      const retryAfterSec = Number(response.headers.get('retry-after') ?? '0');
      const backoffMs =
        retryAfterSec > 0 ? retryAfterSec * 1000 : (BACKOFF_MS[attempt] ?? 180_000);
      globalCooldownUntil = Date.now() + backoffMs;
      console.warn(
        `[sec] 429 for ${url}, retry ${attempt + 1}/${MAX_429_RETRIES} after ${Math.round(backoffMs / 1000)}s`
      );
      await sleep(backoffMs);
      return secFetch(url, init, attempt + 1);
    }

    return response;
  };

  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
};

export const secFetchJson = async <T,>(url: string, init?: SecFetchInit): Promise<T> => {
  const response = await secFetch(url, init);
  if (!response.ok) {
    throw new Error(formatSecError(response.status, url));
  }
  return (await response.json()) as T;
};

export const secFetchText = async (url: string, init?: SecFetchInit): Promise<string> => {
  const response = await secFetch(url, {
    ...init,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(formatSecError(response.status, url));
  }
  return response.text();
};
