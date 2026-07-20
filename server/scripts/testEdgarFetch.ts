import { buildEdgarPrefetchPlan } from '../../utils/edgarFilingContext.ts';
import { fetchEdgarReportsViaPython } from '../lib/edgarPythonClient.ts';

const ticker = process.argv[2] || 'AAPL';

async function main() {
  const fetches = buildEdgarPrefetchPlan();
  console.log(`Fetching EDGAR reports for ${ticker}`, fetches);

  const result = await fetchEdgarReportsViaPython({ ticker, fetches });

  console.log('\nReports:');
  for (const report of result.reports) {
    console.log(
      `- ${report.form}: ${report.title} (${report.filingDate}), ${report.textChars} chars, cacheHit=${report.cacheHit}`
    );
    console.log(`  preview: ${report.body.slice(0, 240).replace(/\s+/g, ' ')}…`);
  }

  if (result.errors.length) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`- ${error.form}: ${error.message}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
