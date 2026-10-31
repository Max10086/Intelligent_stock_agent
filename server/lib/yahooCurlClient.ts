import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { getGoogleSocksProxyUrl } from './googleProxyBootstrap.ts';
import { getYahooUserAgent } from './yahooCrumb.ts';

const execFileAsync = promisify(execFile);

const HTTP_STATUS_MARKER = '\n__HTTP_STATUS__';

export class YahooCurlError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly body: string
  ) {
    super(message);
    this.name = 'YahooCurlError';
  }
}

const parseCurlResponse = (stdout: string): { statusCode: number; body: string } => {
  const markerIndex = stdout.lastIndexOf(HTTP_STATUS_MARKER);
  if (markerIndex === -1) {
    return { statusCode: 0, body: stdout };
  }
  const body = stdout.slice(0, markerIndex);
  const statusCode = Number(stdout.slice(markerIndex + HTTP_STATUS_MARKER.length).trim());
  return { statusCode: Number.isFinite(statusCode) ? statusCode : 0, body };
};

const runCurl = async (params: {
  url: string;
  method?: 'GET' | 'POST';
  body?: string;
  cookieJarPath: string;
}): Promise<{ statusCode: number; body: string }> => {
  const proxy = getGoogleSocksProxyUrl();
  const args = [
    '-sS',
    '-m',
    '45',
    '-c',
    params.cookieJarPath,
    '-b',
    params.cookieJarPath,
    '-w',
    `${HTTP_STATUS_MARKER}%{http_code}`,
    '-H',
    `User-Agent: ${getYahooUserAgent()}`,
  ];

  if (proxy) {
    args.push('--proxy', proxy);
  }

  if (params.method === 'POST') {
    args.push('-X', 'POST', '-H', 'Content-Type: application/json');
    if (params.body) {
      args.push('-d', params.body);
    }
  }

  args.push(params.url);

  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 16 * 1024 * 1024 });
  return parseCurlResponse(stdout);
};

const isValidCrumb = (crumb: string): boolean =>
  Boolean(crumb) &&
  !crumb.includes('<html>') &&
  !/too many requests/i.test(crumb) &&
  /^[\w./-]+$/.test(crumb);

const withYahooCurlSession = async <T>(
  run: (params: {
    runRequest: (params: {
      url: string;
      method?: 'GET' | 'POST';
      body?: string;
    }) => Promise<{ statusCode: number; body: string }>;
    crumb: string;
  }) => Promise<T>
): Promise<T> => {
  let lastError: YahooCurlError | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const dir = await mkdtemp(join(tmpdir(), 'yahoo-curl-'));
    const cookieJarPath = join(dir, 'cookies.txt');

    try {
      await runCurl({ url: 'https://fc.yahoo.com', cookieJarPath });

      const crumbRes = await runCurl({
        url: 'https://query2.finance.yahoo.com/v1/test/getcrumb',
        cookieJarPath,
      });
      const crumb = crumbRes.body.trim();
      if (crumbRes.statusCode === 429 || !isValidCrumb(crumb)) {
        throw new YahooCurlError(
          `Yahoo getcrumb failed (${crumbRes.statusCode})`,
          crumbRes.statusCode,
          crumbRes.body
        );
      }

      const runRequest = (params: {
        url: string;
        method?: 'GET' | 'POST';
        body?: string;
      }) => runCurl({ ...params, cookieJarPath });

      return await run({ runRequest, crumb });
    } catch (error) {
      if (error instanceof YahooCurlError) {
        lastError = error;
        const isRateLimited =
          error.statusCode === 429 || /too many requests/i.test(error.body);
        if (!isRateLimited || attempt === 2) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
      } else {
        throw error;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  throw lastError ?? new Error('Yahoo curl session failed');
};

/** curl + cookie jar — reliable for Yahoo screener when Node fetch is rate-limited behind SOCKS. */
export const postYahooScreenerViaCurl = async (params: {
  url: string;
  body: string;
}): Promise<{ statusCode: number; body: string }> => {
  const [response] = await withYahooCurlSession(async ({ runRequest, crumb }) => {
    const screenerUrl = `${params.url}${params.url.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(crumb)}`;
    const screenerRes = await runRequest({
      url: screenerUrl,
      method: 'POST',
      body: params.body,
    });

    if (screenerRes.statusCode < 200 || screenerRes.statusCode >= 300) {
      throw new YahooCurlError(
        `Yahoo screener failed (${screenerRes.statusCode})`,
        screenerRes.statusCode,
        screenerRes.body
      );
    }

    return [screenerRes];
  });

  return response;
};

/** One Yahoo session — multiple GET requests (e.g. batched quote lookups). */
export const getYahooJsonBatchesViaCurl = async (
  buildUrls: (crumb: string) => string[]
): Promise<Array<{ statusCode: number; body: string }>> =>
  withYahooCurlSession(async ({ runRequest, crumb }) => {
    const responses: Array<{ statusCode: number; body: string }> = [];
    for (const url of buildUrls(crumb)) {
      const res = await runRequest({ url });
      if (res.statusCode === 429) {
        throw new YahooCurlError('Yahoo request rate limited (429)', 429, res.body);
      }
      responses.push(res);
    }
    return responses;
  });

export const shouldUseYahooCurlClient = (): boolean => Boolean(getGoogleSocksProxyUrl());

/** Chart v8 works without crumb when routed through SOCKS; screener endpoints still need a session. */
export const getYahooChartViaCurl = async (
  chartUrl: string
): Promise<{ statusCode: number; body: string }> => {
  const proxy = getGoogleSocksProxyUrl();
  const args = [
    '-sS',
    '-m',
    '45',
    '-w',
    `${HTTP_STATUS_MARKER}%{http_code}`,
    '-H',
    `User-Agent: ${getYahooUserAgent()}`,
  ];
  if (proxy) {
    args.push('--proxy', proxy);
  }
  args.push(chartUrl);
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 16 * 1024 * 1024 });
  return parseCurlResponse(stdout);
};
