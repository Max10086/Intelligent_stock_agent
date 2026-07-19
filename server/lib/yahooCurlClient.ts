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

/** curl + cookie jar — reliable for Yahoo screener when Node fetch is rate-limited behind SOCKS. */
export const postYahooScreenerViaCurl = async (params: {
  url: string;
  body: string;
}): Promise<{ statusCode: number; body: string }> => {
  let lastError: YahooCurlError | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
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

      const screenerUrl = `${params.url}${params.url.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(crumb)}`;
      const screenerRes = await runCurl({
        url: screenerUrl,
        method: 'POST',
        body: params.body,
        cookieJarPath,
      });

      if (screenerRes.statusCode < 200 || screenerRes.statusCode >= 300) {
        throw new YahooCurlError(
          `Yahoo screener failed (${screenerRes.statusCode})`,
          screenerRes.statusCode,
          screenerRes.body
        );
      }

      return screenerRes;
    } catch (error) {
      if (error instanceof YahooCurlError) {
        lastError = error;
        const isRateLimited =
          error.statusCode === 429 || /too many requests/i.test(error.body);
        if (!isRateLimited || attempt === 3) {
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

  throw lastError ?? new Error('Yahoo screener curl request failed');
};

export const shouldUseYahooCurlClient = (): boolean => Boolean(getGoogleSocksProxyUrl());
