import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ThirteenFStakeFeedResponse,
  ThirteenFStakeMajorEvent,
} from '../../types/thirteenF.js';
import { readEdgarEnabled, readEdgarIdentity } from '../../utils/edgarFilingContext.js';

const SCRIPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '../scripts/stakeTrackerFetch.py');

export interface StakeTrackerFetchParams {
  ciks: string[];
  limitPerInstitution?: number;
  limit?: number;
}

export const isStakeTrackerConfigured = (): boolean =>
  readEdgarEnabled() && Boolean(readEdgarIdentity());

export const resolveStakeTrackerPython = (): string =>
  (process.env.EDGAR_PYTHON || 'python3').trim() || 'python3';

export const fetchStakeFeedViaPython = async (
  params: StakeTrackerFetchParams
): Promise<ThirteenFStakeFeedResponse> => {
  const identity = readEdgarIdentity();
  if (!identity) {
    throw new Error('EDGAR_IDENTITY is not configured');
  }

  const python = resolveStakeTrackerPython();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EDGAR_IDENTITY: identity,
  };

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
        const parsed = JSON.parse(stdout || '{}') as ThirteenFStakeFeedResponse & {
          error?: string;
        };
        if (parsed.error) {
          reject(new Error(parsed.error));
          return;
        }
        if (code !== 0 && !parsed.filings) {
          reject(new Error(stderr.trim() || `stakeTrackerFetch.py exited with code ${code}`));
          return;
        }
        resolve({
          filings: parsed.filings ?? [],
          totalCount: parsed.totalCount ?? parsed.filings?.length ?? 0,
          institutionCount: parsed.institutionCount ?? params.ciks.length,
          fetchedAt: new Date().toISOString(),
          dataSource: parsed.dataSource ?? 'sec-edgar-submissions',
        });
      } catch (error) {
        reject(
          new Error(
            `Failed to parse stakeTrackerFetch output${stderr ? `: ${stderr.trim()}` : ''}${
              error instanceof Error ? `: ${error.message}` : ''
            }`
          )
        );
      }
    });

    child.stdin.write(
      JSON.stringify({
        ciks: params.ciks,
        limitPerInstitution: params.limitPerInstitution ?? 25,
        limit: params.limit ?? 100,
      })
    );
    child.stdin.end();
  });
};

export const isKnownStakeMajorEvent = (value: string): value is ThirteenFStakeMajorEvent =>
  value === 'NEW_5PCT_STAKE' || value === 'POSITION_CHANGE' || value === 'OTHER';
