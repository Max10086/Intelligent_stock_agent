import { buildCninfoPrefetchPlan, guessCninfoPlate } from '../../utils/cninfoFilingContext.ts';
import { fetchCninfoReportsViaPython } from '../lib/cninfoPythonClient.ts';

const secCode = process.argv[2] || '600519';

async function main() {
  const plate = guessCninfoPlate(secCode);
  const fetches = buildCninfoPrefetchPlan();
  console.log(`Fetching cninfo reports for ${secCode} (${plate})`, fetches);

  const result = await fetchCninfoReportsViaPython({ secCode, plate, fetches });

  console.log('\nReports:');
  for (const report of result.reports) {
    console.log(
      `- ${report.kind} ${report.year}: ${report.title} (${report.annDate}), ${report.textChars} chars, cacheHit=${report.cacheHit}`
    );
    console.log(`  preview: ${report.body.slice(0, 240).replace(/\s+/g, ' ')}…`);
  }

  if (result.errors.length) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log(`- ${error.kind} ${error.year}: ${error.message}`);
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
