import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EdgarFetchSpec, EdgarReportPayload } from '../../types/edgar.js';
import { readEdgarEnabled, readEdgarIdentity } from '../../utils/edgarFilingContext.js';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../scripts/edgarFetch.py');

export interface EdgarFetchResult {
  reports: EdgarReportPayload[];
  errors: Array<{ form: EdgarFetchSpec['form']; message: string }>;
}

export const isEdgarConfigured = (): boolean =>
  readEdgarEnabled() && Boolean(readEdgarIdentity());

export const resolveEdgarPython = (): string =>
  (process.env.EDGAR_PYTHON || 'python3').trim() || 'python3';

export const fetchEdgarReportsViaPython = async (params: {
  ticker: string;
  fetches: EdgarFetchSpec[];
  force?: boolean;
}): Promise<EdgarFetchResult> => {
  const identity = readEdgarIdentity();
  if (!identity) {
    throw new Error('EDGAR_IDENTITY is not configured');
  }

  const python = resolveEdgarPython();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EDGAR_IDENTITY: identity,
  };
  const cacheDir = process.env.EDGAR_CACHE_DIR?.trim();
  if (cacheDir) {
    env.EDGAR_CACHE_DIR = cacheDir;
  }

  return new Promise((resolve, reject) => {
    const child = spawn(python, [SCRIPT_PATH], {
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
      try {
        const parsed = JSON.parse(stdout || '{}') as EdgarFetchResult & { error?: string };
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        if (code !== 0 && !parsed.reports?.length) {
          reject(new Error(stderr.trim() || `edgarFetch.py exited with code ${code}`));
          return;
        }
        resolve({
          reports: Array.isArray(parsed.reports) ? parsed.reports : [],
          errors: Array.isArray(parsed.errors) ? parsed.errors : [],
        });
      } catch (error) {
        reject(
          new Error(
            `Failed to parse edgarFetch output${stderr ? `: ${stderr.trim()}` : ''}${
              error instanceof Error ? `: ${error.message}` : ''
            }`
          )
        );
      }
    });

    child.stdin.write(
      JSON.stringify({
        ticker: params.ticker,
        force: Boolean(params.force),
        fetches: params.fetches,
      })
    );
    child.stdin.end();
  });
};
