import 'dotenv/config';
import { getAdminMetrics } from '../services/adminMetrics.js';
import { disconnectDatabase } from '../db.js';

const days = Number(process.argv[2]) || 7;
const to = new Date();
const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

const metrics = await getAdminMetrics({
  from: from.toISOString(),
  to: to.toISOString(),
});

console.log(`\nTrade Alpha weekly metrics (${days}d ending ${to.toISOString().slice(0, 10)})\n`);
console.log(`Signups:          ${metrics.growth.signups}`);
console.log(`Activated:        ${metrics.growth.activatedInPeriod}`);
console.log(`Weekly active:    ${metrics.growth.wau}`);
console.log(`New paid:         ${metrics.revenue.newPaidUsers}`);
console.log(`Total paid:       ${metrics.revenue.totalPaidUsers}`);
console.log(`Conversion:       ${(metrics.revenue.conversionRate * 100).toFixed(1)}%`);
console.log(`Analyses:         ${metrics.usage.analysesInPeriod}`);
console.log(`Hit paywall:      ${metrics.funnel.hitPaywall}`);
console.log(`Funnel:           ${metrics.funnel.registered} reg → ${metrics.funnel.activated} act → ${metrics.funnel.paid} paid`);

if (metrics.usage.topTickers.length > 0) {
  console.log(
    `Top ticker:       ${metrics.usage.topTickers[0].ticker} (${metrics.usage.topTickers[0].count})`
  );
}

console.log('');
await disconnectDatabase();
