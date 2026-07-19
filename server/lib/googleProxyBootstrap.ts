import nodeFetch, { type RequestInit } from 'node-fetch';
import { Gaxios } from 'gaxios';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { GoogleGenAIOptions } from '@google/genai';

const SOCKS_PROXY_PATTERN = /^socks/i;

/** Hostnames routed through GOOGLE_SOCKS_PROXY; everything else uses the native fetch. */
const GOOGLE_HOST_PATTERNS = [
  /(^|\.)googleapis\.com$/i,
  /(^|\.)google\.com$/i,
  /(^|\.)gstatic\.com$/i,
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)yahoo\.com$/i,
];

let cachedSocksAgent: SocksProxyAgent | null = null;
let cachedSocksUrl: string | null = null;

const readGoogleSocksProxy = (): string | undefined => {
  const raw = process.env.GOOGLE_SOCKS_PROXY?.trim();
  return raw && raw.length > 0 ? raw : undefined;
};

const normalizeSocksUrl = (rawProxy: string): string =>
  rawProxy.startsWith('socks') ? rawProxy : `socks5h://${rawProxy}`;

export const getGoogleSocksProxyUrl = (): string | undefined => {
  const rawProxy = readGoogleSocksProxy();
  if (!rawProxy || !SOCKS_PROXY_PATTERN.test(rawProxy)) return undefined;
  return normalizeSocksUrl(rawProxy);
};

export const getGoogleSocksAgent = (): SocksProxyAgent | undefined => {
  const rawProxy = readGoogleSocksProxy();
  if (!rawProxy || !SOCKS_PROXY_PATTERN.test(rawProxy)) return undefined;

  const socksUrl = normalizeSocksUrl(rawProxy);
  if (!cachedSocksAgent || cachedSocksUrl !== socksUrl) {
    cachedSocksAgent = new SocksProxyAgent(socksUrl);
    cachedSocksUrl = socksUrl;
  }
  return cachedSocksAgent;
};

const stripSocksFromProcessEnv = (): void => {
  for (const key of [
    'HTTPS_PROXY',
    'https_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'ALL_PROXY',
    'all_proxy',
  ]) {
    const value = process.env[key];
    if (value && SOCKS_PROXY_PATTERN.test(value)) {
      delete process.env[key];
    }
  }
};

const getRequestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
};

const isGoogleHost = (hostname: string): boolean =>
  GOOGLE_HOST_PATTERNS.some(pattern => pattern.test(hostname));

const shouldUseGoogleProxy = (input: RequestInfo | URL): boolean => {
  try {
    const hostname = new URL(getRequestUrl(input)).hostname;
    return isGoogleHost(hostname);
  } catch {
    return false;
  }
};

/** Patch Gaxios so google-auth-library ADC / token refresh uses SOCKS. */
const patchGaxiosForGoogleSocks = (agent: SocksProxyAgent): void => {
  const originalRequest = Gaxios.prototype.request;
  Gaxios.prototype.request = function patchedGaxiosRequest(
    this: Gaxios,
    opts: Parameters<Gaxios['request']>[0]
  ) {
    const url = String(opts?.url || opts?.baseURL || '');
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      // ignore malformed URLs; fall through without forcing agent
    }
    if (hostname && isGoogleHost(hostname)) {
      return originalRequest.call(this, {
        ...opts,
        agent: opts?.agent || agent,
      });
    }
    return originalRequest.call(this, opts);
  };
};

/** Vertex / Gemini client options (SOCKS applied globally via fetch + Gaxios patches). */
export function buildGoogleGenAIClientOptions(
  options: Pick<GoogleGenAIOptions, 'vertexai' | 'project' | 'location'>
): GoogleGenAIOptions {
  return options;
}

/** Route Gemini API fetch + patch auth; leave Supabase and other APIs direct. */
const applyGoogleProxy = (): void => {
  const rawProxy = readGoogleSocksProxy();
  if (!rawProxy) {
    const legacyProxy = [process.env.HTTPS_PROXY, process.env.ALL_PROXY].find(
      value => typeof value === 'string' && SOCKS_PROXY_PATTERN.test(value)
    );
    if (legacyProxy) {
      console.warn(
        '[proxy] Ignoring SOCKS in HTTPS_PROXY/ALL_PROXY for global fetch. ' +
          'Set GOOGLE_SOCKS_PROXY to proxy Google traffic only.'
      );
    }
    return;
  }

  if (!SOCKS_PROXY_PATTERN.test(rawProxy)) {
    console.warn(
      `[proxy] GOOGLE_SOCKS_PROXY must be a socks URL (got "${rawProxy}"). Proxy not enabled.`
    );
    return;
  }

  const socksUrl = normalizeSocksUrl(rawProxy);
  stripSocksFromProcessEnv();

  const agent = getGoogleSocksAgent()!;
  patchGaxiosForGoogleSocks(agent);
  const nativeFetch = globalThis.fetch.bind(globalThis);

  const fetchWithGoogleProxy: typeof fetch = (input, init) => {
    if (shouldUseGoogleProxy(input)) {
      return nodeFetch(input as Parameters<typeof nodeFetch>[0], {
        ...(init as RequestInit),
        agent,
      }) as unknown as Promise<Response>;
    }
    return nativeFetch(input, init);
  };

  globalThis.fetch = fetchWithGoogleProxy;

  console.info(
    `[proxy] Google/Yahoo traffic via SOCKS ${socksUrl} (fetch + gaxios); Supabase direct`
  );
};

let proxyConfigured = false;

/** Idempotent; also runs automatically when this module is first imported. */
export function configureGoogleProxy(): void {
  if (proxyConfigured) return;
  applyGoogleProxy();
  proxyConfigured = true;
}

applyGoogleProxy();
