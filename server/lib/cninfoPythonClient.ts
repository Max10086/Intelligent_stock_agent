import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CninfoFetchSpec, CninfoReportPayload } from '../../types/cninfo.js';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../scripts/cninfoFetch.py');

export interface CninfoFetchResult {
  reports: CninfoReportPayload[];
  errors: Array<{ year: number; kind: CninfoFetchSpec['kind']; message: string }>;
}

export const isCninfoConfigured = (): boolean => {
  const flag = (process.env.CNINFO_ENABLED || 'true').trim().toLowerCase();
  return flag !== '0' && flag !== 'false' && flag !== 'off';
};

export const resolveCninfoPython = (): string =>
  (process.env.CNINFO_PYTHON || 'python3').trim() || 'python3';

export const fetchCninfoReportsViaPython = async (params: {
  secCode: string;
  plate?: 'sz' | 'sh' | 'bj';
  fetches: CninfoFetchSpec[];
  force?: boolean;
}): Promise<CninfoFetchResult> => {
  const python = resolveCninfoPython();
  const env = { ...process.env };
  const cacheDir = process.env.CNINFO_CACHE_DIR?.trim();
  if (cacheDir) {
    env.CNINFO_CACHE_DIR = cacheDir;
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
        const parsed = JSON.parse(stdout || '{}') as CninfoFetchResult & { error?: string };
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        if (code !== 0 && !parsed.reports?.length) {
          reject(new Error(stderr.trim() || `cninfoFetch.py exited with code ${code}`));
          return;
        }
        resolve({
          reports: Array.isArray(parsed.reports) ? parsed.reports : [],
          errors: Array.isArray(parsed.errors) ? parsed.errors : [],
        });
      } catch (error) {
        reject(
          new Error(
            `Failed to parse cninfoFetch output${stderr ? `: ${stderr.trim()}` : ''}${
              error instanceof Error ? `: ${error.message}` : ''
            }`
          )
        );
      }
    });

    child.stdin.write(
      JSON.stringify({
        secCode: params.secCode,
        plate: params.plate,
        force: Boolean(params.force),
        fetches: params.fetches,
      })
    );
    child.stdin.end();
  });
};
