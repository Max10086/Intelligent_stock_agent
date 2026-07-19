import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGoogleSocksProxyUrl } from './googleProxyBootstrap.ts';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../scripts/yahooUsDayGainers.py');

export const shouldUseYahooPythonClient = (): boolean => Boolean(getGoogleSocksProxyUrl());

const runPythonScreener = (params: Record<string, unknown>): Promise<{ quotes: Record<string, unknown>[] }> => {
  const proxy = getGoogleSocksProxyUrl();
  const env = { ...process.env };
  if (proxy) {
    env.HTTPS_PROXY = proxy;
    env.HTTP_PROXY = proxy;
  }

  return new Promise((resolve, reject) => {
    const child = spawn('python3', [SCRIPT_PATH], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `yahooUsDayGainers.py exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as {
          quotes?: Record<string, unknown>[];
          error?: string;
        };
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        resolve({ quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [] });
      } catch (error) {
        reject(
          new Error(
            `Failed to parse yfinance screener output${stderr ? `: ${stderr.trim()}` : ''}`
          )
        );
      }
    });

    child.stdin.write(JSON.stringify(params));
    child.stdin.end();
  });
};

export const fetchUsDayGainersQuotesViaPython = async (params: {
  size: number;
  minMarketCap: number;
  minDayVolume: number;
}): Promise<{ quotes: Record<string, unknown>[]; rawResponse: unknown }> => {
  const result = await runPythonScreener({ mode: 'daily', ...params });
  return {
    quotes: result.quotes,
    rawResponse: { source: 'yfinance', mode: 'daily', quotes: result.quotes },
  };
};

export const fetchUsWeekGainersQuotesViaPython = async (params: {
  poolSizePerSort: number;
  poolOffsets: number[];
  count: number;
  minMarketCap: number;
  minDayVolume: number;
  baselineDate: string;
  tradingDateEnd: string;
}): Promise<{ quotes: Record<string, unknown>[]; rawResponse: unknown }> => {
  const result = await runPythonScreener({ mode: 'weekly', ...params });
  return {
    quotes: result.quotes,
    rawResponse: { source: 'yfinance', mode: 'weekly', quotes: result.quotes },
  };
};
