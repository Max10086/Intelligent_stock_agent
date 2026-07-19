import type { GainerMarket, GainerPeriod } from '../types/marketGainers.ts';

export const buildMarketGainersPrompt = (params: {
  market: GainerMarket;
  period: GainerPeriod;
  tradingDateEnd: string;
  tradingDateStart?: string;
}): string => {
  const { market, period, tradingDateEnd, tradingDateStart } = params;

  if (market === 'US') {
    if (period === 'DAILY') {
      return [
        `Find the top 20 US-listed common stocks by official daily percentage gain for the completed US trading session on ${tradingDateEnd} (America/New_York calendar date).`,
        `This must be the regular NYSE/NASDAQ/AMEX session that closed on ${tradingDateEnd}, not weekly/monthly returns and not a different date.`,
        'Use Google Search to verify real market data and news for that exact session date. Do not rely on memory or guess.',
        'Include NYSE, NASDAQ, and AMEX ordinary shares only.',
        'Exclude ETFs, ADR-only shells, warrants, units, and penny stocks below $1.',
        'Return strict JSON only with this shape:',
        '{"asOfDate":"YYYY-MM-DD","entries":[{"rank":1,"name":"Company","ticker":"AAPL","exchange":"NASDAQ","changePct":12.34,"blurb":"一句话中文简介，说明上涨原因。"}]}',
        `Requirements: exactly 20 entries, ranks 1-20, asOfDate MUST be "${tradingDateEnd}", changePct is single-day percent gain for that session, blurb in Simplified Chinese only, max 40 characters.`,
      ].join('\n');
    }

    return [
      `List the top 20 US-listed common stocks by percentage gain for the completed US trading week ending ${tradingDateEnd}.`,
      tradingDateStart ? `Week start trading date: ${tradingDateStart}.` : '',
      'Include NYSE, NASDAQ, and AMEX ordinary shares only. Exclude ETFs and warrants.',
      'Return strict JSON only:',
      '{"asOfDate":"YYYY-MM-DD","periodStart":"YYYY-MM-DD","entries":[{"rank":1,"name":"Company","ticker":"NVDA","exchange":"NASDAQ","changePct":18.5,"blurb":"One concise sentence."}]}',
      'Exactly 20 entries, changePct is weekly return, blurb max 120 characters.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (market === 'CN') {
    if (period === 'THREE_DAY') {
      return [
        `Find the top 20 A-share stocks (Shanghai + Shenzhen) by cumulative percentage gain over the 3 completed CN trading sessions from ${tradingDateStart} through ${tradingDateEnd} (Asia/Shanghai calendar dates).`,
        `Search 东方财富、同花顺、新浪财经等来源，获取该区间真实的 A 股涨幅榜数据。`,
        'Exclude ST/*ST, B-shares, ETFs, and Beijing Stock Exchange listings.',
        'Use web search — do not rely on memory. Never invent placeholder companies (e.g. 公司A/公司B) or fake sequential tickers.',
        'Return strict JSON only:',
        '{"asOfDate":"YYYY-MM-DD","periodStart":"YYYY-MM-DD","entries":[{"rank":1,"name":"贵州茅台","ticker":"600519","exchange":"SSE","changePct":15.2,"blurb":"一句话简介，不超过40字。"}]}',
        `Requirements: exactly 20 real entries if available, ranks 1-20, asOfDate MUST be "${tradingDateEnd}", periodStart MUST be "${tradingDateStart}", changePct is cumulative 3-day return, blurb in Simplified Chinese, max 40 characters.`,
        `Suggested search: A股 3日涨幅榜 ${tradingDateStart} ${tradingDateEnd}`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    return [
      `Find the top 20 A-share stocks by percentage gain for the completed CN trading week ending ${tradingDateEnd} (Asia/Shanghai).`,
      tradingDateStart ? `Week start trading date: ${tradingDateStart}.` : '',
      `Search 东方财富、同花顺等来源获取真实周涨幅榜。Do not invent placeholder companies.`,
      'Exclude ST/*ST, B-shares, ETFs, and Beijing Stock Exchange listings.',
      'Return strict JSON only:',
      '{"asOfDate":"YYYY-MM-DD","periodStart":"YYYY-MM-DD","entries":[{"rank":1,"name":"宁德时代","ticker":"300750","exchange":"SZSE","changePct":22.1,"blurb":"一句话简介，不超过40字。"}]}',
      `Requirements: asOfDate MUST be "${tradingDateEnd}", blurb in Simplified Chinese, max 40 characters.`,
      `Suggested search: A股 周涨幅榜 ${tradingDateStart || ''} ${tradingDateEnd}`.replace(/\s+/g, ' ').trim(),
    ]
      .filter(Boolean)
      .join('\n');
  }

  throw new Error(`Market ${market} gainer fetch is not implemented yet`);
};
