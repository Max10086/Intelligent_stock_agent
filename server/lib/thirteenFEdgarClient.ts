import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThirteenFQuarterId } from '../../types/thirteenF.js';
import { readEdgarEnabled, readEdgarIdentity } from '../../utils/edgarFilingContext.js';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../scripts/thirteenFFetch.py');

export interface ThirteenFEdgarRawBundle {
  summary: {
    cik: string;
    institutionName: string;
    formerNames?: string[];
    quarter: ThirteenFQuarterId;
    filingDate: string;
    reportDate: string;
    totalMarketValueUsd: number;
    holdingCount: number;
    topSector?: string;
    holdingsSource?: {
      type: '13F-NT-redirect';
      sourceCik: string;
      sourceInstitutionName: string;
      noticeFilingDate: string;
      additionalInformation?: string | null;
    };
  };
  holdings: Array<{
    id: string;
    cik: string;
    quarter: ThirteenFQuarterId;
    ticker: string;
    name: string;
    sector: string;
    industry?: string;
    shares: number;
    marketValueUsd: number;
    portfolioWeightPct: number;
    rank: number;
    filingDate: string;
    reportDate: string;
    referencePriceUsd?: number | null;
    sharesDelta?: number | null;
    weightDeltaPct?: number | null;
    marketValueDeltaUsd?: number | null;
  }>;
  distribution: {
    bySector: Array<{
      key: string;
      label: string;
      marketValueUsd: number;
      weightPct: number;
    }>;
    byStock: Array<{
      key: string;
      label: string;
      marketValueUsd: number;
      weightPct: number;
    }>;
  };
  changes: Array<{
    id: string;
    cik: string;
    quarter: ThirteenFQuarterId;
    priorQuarter: ThirteenFQuarterId;
    ticker: string;
    name: string;
    sector: string;
    category: 'NEW' | 'ADD' | 'REDUCE' | 'CLEAR';
    priorShares: number | null;
    currentShares: number | null;
    sharesDelta: number;
    priorMarketValueUsd: number | null;
    currentMarketValueUsd: number | null;
    marketValueDeltaUsd: number;
    priorWeightPct: number | null;
    currentWeightPct: number | null;
    weightDeltaPct: number | null;
  }>;
  counts: Record<'NEW' | 'ADD' | 'REDUCE' | 'CLEAR', number>;
  totalCounts?: Record<'NEW' | 'ADD' | 'REDUCE' | 'CLEAR', number>;
  displayedCounts?: Record<'NEW' | 'ADD' | 'REDUCE' | 'CLEAR', number>;
  changesLimitPerCategory?: number;
  priorQuarter: ThirteenFQuarterId;
  availableQuarters: Array<{
    quarter: ThirteenFQuarterId;
    filingDate: string;
    reportDate: string;
    isLatest: boolean;
    noticeOnly?: boolean;
  }>;
  dataSource?: 'sec-edgar';
  sectorsEnriched?: boolean;
  /** Bump when cached payload shape changes (e.g. holdings quarter deltas). */
  schemaVersion?: number;
  error?: string;
  partial?: boolean;
}

export const isThirteenFEdgarConfigured = (): boolean =>
  readEdgarEnabled() && Boolean(readEdgarIdentity());

export const resolveEdgarPython = (): string =>
  (process.env.EDGAR_PYTHON || 'python3').trim() || 'python3';

export const fetchThirteenFBundleViaPython = async (params: {
  cik: string;
  quarter?: ThirteenFQuarterId | null;
  maxChangesPerCategory?: number;
}): Promise<ThirteenFEdgarRawBundle> => {
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
    child.on('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            `Python not found (${python}). Cloud Run image must install python3 and edgartools (see requirements-edgar.txt).`
          )
        );
        return;
      }
      reject(error);
    });
    child.on('close', code => {
      try {
        const parsed = JSON.parse(stdout || '{}') as ThirteenFEdgarRawBundle & { error?: string };
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        if (code !== 0 && !parsed.summary) {
          reject(new Error(stderr.trim() || `thirteenFFetch.py exited with code ${code}`));
          return;
        }
        resolve(parsed);
      } catch (error) {
        reject(
          new Error(
            `Failed to parse thirteenFFetch output${stderr ? `: ${stderr.trim()}` : ''}${
              error instanceof Error ? `: ${error.message}` : ''
            }`
          )
        );
      }
    });

    child.stdin.write(
      JSON.stringify({
        cik: params.cik,
        quarter: params.quarter ?? undefined,
        maxChangesPerCategory: params.maxChangesPerCategory ?? 50,
      })
    );
    child.stdin.end();
  });
};
