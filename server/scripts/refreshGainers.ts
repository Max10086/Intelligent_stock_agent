import 'dotenv/config';
import '../lib/googleProxyBootstrap.js';
import { createGoogleGenAIClient } from '../lib/googleGenAIClient.js';
import type { GainerMarket } from '../../types/marketGainers.js';
import type { GainerPeriod } from '../../types/marketGainers.js';
import { ModelClient } from '../services/modelClient.js';
import { refreshMarketGainers } from '../services/marketGainersService.js';
import { runGainerAutoAnalyzeForAdmins } from '../services/gainerAutoAnalyzeService.js';
import { disconnectDatabase } from '../db.js';

function getAIClient() {
  return createGoogleGenAIClient();
}

const parseArg = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
};

const market = (parseArg('market') || 'US').toUpperCase() as GainerMarket;
const period = (parseArg('period') || (market === 'CN' ? 'THREE_DAY' : 'DAILY')).toUpperCase() as GainerPeriod;
const force = process.argv.includes('--force');

async function main() {
  const modelClient = new ModelClient(getAIClient());
    console.info('[gainers:refresh] starting', { market, period, force });
    const result = await refreshMarketGainers({
    market,
    period,
    modelClient,
    force,
  });
  console.log('[gainers:refresh] completed', result);

  const autoAnalyze = await runGainerAutoAnalyzeForAdmins();
  console.log('[gainers:refresh] auto-analyze', autoAnalyze);
}

main()
  .catch(error => {
    console.error('[gainers:refresh] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase();
  });
