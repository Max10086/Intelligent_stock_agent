import assert from 'node:assert/strict';
import {
  computeWeeklyChangePct,
  fetchUsWeekGainersFromYahoo,
  readUsGainerMinMarketCap,
  resolveUsWeeklyBaselineDate,
} from '../services/yahooUsGainersService.ts';
import { getFinancialData } from '../../services/finance.ts';
import { parseTencentMarketCapToAbsolute } from '../../utils/priceFormat.ts';
import { resolveGainerWindow } from '../services/marketGainersService.ts';

const runUnitTests = () => {
  assert.equal(computeWeeklyChangePct(100, 110), 10);
  assert.equal(computeWeeklyChangePct(200, 250), 25);
  assert.equal(computeWeeklyChangePct(0, 100), null);

  const baseline = resolveUsWeeklyBaselineDate('2026-07-14');
  assert.match(baseline, /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(baseline, '2026-07-14');

  assert.equal(readUsGainerMinMarketCap(), 100_000_000);
  console.info('[test:us-week-gainers] unit tests passed', { baseline });
};

const verifyMarketCaps = async (tickers: string[]) => {
  const minMcap = readUsGainerMinMarketCap();
  const failures: string[] = [];

  for (const ticker of tickers) {
    try {
      const profile = await getFinancialData({ name: ticker, ticker, exchange: 'NASDAQ' });
      const absolute = parseTencentMarketCapToAbsolute(profile.marketCap);
      if (absolute === null || absolute < minMcap) {
        failures.push(`${ticker}:${absolute ?? 'null'}`);
      }
    } catch (error) {
      failures.push(`${ticker}:lookup-failed`);
      console.warn('[test:us-week-gainers] market cap lookup failed', ticker, error);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Entries below min market cap (${minMcap}): ${failures.join(', ')}`);
  }
};

const runIntegrationTest = async () => {
  const window = resolveGainerWindow('US', 'WEEKLY');
  if (!window.tradingDateStart) {
    throw new Error('Expected tradingDateStart for US weekly window');
  }

  console.info('[test:us-week-gainers] fetching weekly payload', window);
  const result = await fetchUsWeekGainersFromYahoo({
    tradingDateEnd: window.tradingDateEnd,
    tradingDateStart: window.tradingDateStart,
    count: 20,
  });

  assert.ok(result.payload.entries.length > 0, 'expected weekly entries');
  assert.equal(result.payload.asOfDate, window.tradingDateEnd);
  assert.equal(result.payload.periodStart, window.tradingDateStart);

  for (const entry of result.payload.entries) {
    assert.ok(entry.changePct > 0, `${entry.ticker} should have positive weekly change`);
    assert.ok(entry.ticker.length > 0);
    assert.ok(entry.rank >= 1 && entry.rank <= 20);
  }

  const cdnaProfile = await getFinancialData({ name: 'CDNA', ticker: 'CDNA', exchange: 'NASDAQ' });
  const cdna = result.payload.entries.find(entry => entry.ticker === 'CDNA');
  const cdnaWeekPct = parseFloat((cdnaProfile.weekChange || '').replace(/[^0-9.-]/g, ''));
  if (Number.isFinite(cdnaWeekPct) && cdnaWeekPct >= 20) {
    assert.ok(cdna, `CDNA (+${cdnaWeekPct}%) should appear when among top weekly movers`);
    console.info('[test:us-week-gainers] CDNA present', { rank: cdna?.rank, changePct: cdna?.changePct });
  }

  const sorted = [...result.payload.entries].sort((a, b) => b.changePct - a.changePct);
  assert.deepEqual(
    result.payload.entries.map(entry => entry.ticker),
    sorted.map(entry => entry.ticker),
    'entries should be sorted by weekly changePct desc'
  );

  console.info(
    '[test:us-week-gainers] top weekly entries',
    result.payload.entries.slice(0, 5).map(entry => ({
      rank: entry.rank,
      ticker: entry.ticker,
      changePct: entry.changePct,
    }))
  );

  await verifyMarketCaps(result.payload.entries.map(entry => entry.ticker));
  console.info('[test:us-week-gainers] integration test passed');
};

async function main() {
  runUnitTests();
  if (process.argv.includes('--integration')) {
    await runIntegrationTest();
  } else {
    console.info('[test:us-week-gainers] skipped integration (pass --integration to run live Yahoo fetch)');
  }
}

main().catch(error => {
  console.error('[test:us-week-gainers] failed', error);
  process.exitCode = 1;
});
