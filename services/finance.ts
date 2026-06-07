import type { CompanyProfile } from '../types.ts';

// Helper to format ticker for Tencent API
const formatTickerForTencent = (ticker: string, exchange: string): string => {
    // ... (保持不变) ...
    const upperExchange = exchange.toUpperCase();
    const upperTicker = ticker.toUpperCase();

    if (['NASDAQ', 'NYSE', 'AMEX', 'US'].includes(upperExchange)) {
        return `us${upperTicker}`;
    }
    if (['HKEX', 'HK'].includes(upperExchange)) {
        return `hk${upperTicker.padStart(5, '0')}`;
    }
    if (['SSE', 'SH'].includes(upperExchange)) {
        return `sh${upperTicker}`;
    }
    if (['SZSE', 'SZ'].includes(upperExchange)) {
        return `sz${upperTicker}`;
    }
    return `us${upperTicker}`;
};

const tencentExchangeToAppExchange = (tencentCode: string, prefix: string): string => {
    // ... (保持不变) ...
    if (prefix === 'us') {
        const suffix = tencentCode.split('.').pop()?.toUpperCase();
        switch (suffix) {
            case 'O':
            case 'OQ':
                return 'NASDAQ';
            case 'N':
                return 'NYSE';
            default:
                return 'NASDAQ'; 
        }
    }
    if (prefix === 'hk') return 'HKEX';
    if (prefix === 'sh') return 'SSE';
    if (prefix === 'sz') return 'SZSE';
    return 'UNKNOWN';
};

interface Candle {
    date: Date;
    close: number;
}

const parseKlineDate = (value: string): Date | null => {
    if (!value) return null;
    const normalized = value.includes('-')
        ? value
        : `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    const dt = new Date(`${normalized}T00:00:00`);
    return Number.isNaN(dt.getTime()) ? null : dt;
};

const parseUsPrice = (raw: string): number => {
    const n = Number((raw || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
};

const parseFinite = (raw: string): number | null => {
    const n = Number((raw || '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
};

const formatSignedPercent = (raw: string): string => {
    const n = parseFinite(raw);
    if (n === null) return '0.00%';
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
};

const formatSignedValue = (raw: string): string => {
    const n = parseFinite(raw);
    if (n === null) return '0.00';
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}`;
};

const parseCurrencyField = (raw: string): string | undefined => {
    if (!raw) return undefined;
    const trimmed = raw.trim();
    return /^[A-Z]{3}$/.test(trimmed) ? trimmed : undefined;
};

const get52WeekBounds = (parts: string[], exchange: string) => {
    const upperExchange = exchange.toUpperCase();
    const highIndex = ['SSE', 'SZSE', 'SH', 'SZ'].includes(upperExchange) ? 47 : 48;
    const lowIndex = ['SSE', 'SZSE', 'SH', 'SZ'].includes(upperExchange) ? 48 : 49;
    const high = parseFinite(parts[highIndex] || '');
    const low = parseFinite(parts[lowIndex] || '');
    return {
        high52w: high !== null ? high.toFixed(2) : '',
        low52w: low !== null ? low.toFixed(2) : '',
    };
};

const fetchWithRetry = async (url: string, options?: RequestInit, retries = 2): Promise<Response> => {
    let lastError: unknown;
    for (let i = 0; i <= retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.ok) return res;
            lastError = new Error(`HTTP ${res.status}`);
        } catch (error) {
            lastError = error;
        }
        if (i < retries) {
            await new Promise(resolve => setTimeout(resolve, 200 * (i + 1)));
        }
    }
    throw lastError instanceof Error ? lastError : new Error('Request failed');
};

const formatPercent = (currentPrice: number, base: number): string => {
    if (!currentPrice || !base) return '0.00%';
    const change = ((currentPrice - base) / base) * 100;
    return (change > 0 ? '+' : '') + change.toFixed(2) + '%';
};

const calculatePeriodChanges = (candles: Candle[], currentPrice: number) => {
    if (!candles.length) return { weekChange: '0.00%', monthChange: '0.00%' };
    const sorted = [...candles].sort((a, b) => a.date.getTime() - b.date.getTime());

    const getPeriodBaselineClose = (periodStart: Date): number => {
        let firstInPeriodIndex = -1;
        for (let i = 0; i < sorted.length; i++) {
            if (sorted[i].date >= periodStart) {
                firstInPeriodIndex = i;
                break;
            }
        }

        if (firstInPeriodIndex > 0) return sorted[firstInPeriodIndex - 1].close;
        if (firstInPeriodIndex === 0) return sorted[0].close;
        return sorted[sorted.length - 1].close;
    };

    const now = new Date();
    const day = now.getDay(); // 0 Sun ... 6 Sat
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    return {
        weekChange: formatPercent(currentPrice, getPeriodBaselineClose(weekStart)),
        monthChange: formatPercent(currentPrice, getPeriodBaselineClose(monthStart)),
    };
};

const fetchUsNasdaqCandles = async (ticker: string): Promise<Candle[]> => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 200);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const url = `https://api.nasdaq.com/api/quote/${ticker}/historical?assetclass=stocks&fromdate=${fmt(start)}&todate=${fmt(end)}&limit=200`;
    const headers = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.nasdaq.com',
        'Referer': 'https://www.nasdaq.com/',
    };

    const res = await fetch(url, { headers });
    if (!res.ok) return [];
    const json = await res.json();
    const rows = json?.data?.tradesTable?.rows;
    if (!Array.isArray(rows)) return [];

    const parseNasdaqDate = (value: string): Date | null => {
        if (!value) return null;
        const [mm, dd, yyyy] = value.split('/');
        const m = Number(mm);
        const d = Number(dd);
        const y = Number(yyyy);
        if (!m || !d || !y) return null;
        const dt = new Date(y, m - 1, d);
        return Number.isNaN(dt.getTime()) ? null : dt;
    };

    return rows
        .map((row: any) => {
            const dt = parseNasdaqDate(row?.date || '');
            const close = parseUsPrice(row?.close || '');
            if (!dt || Number.isNaN(dt.getTime()) || !close) return null;
            return { date: dt, close };
        })
        .filter(Boolean) as Candle[];
};

export const searchTicker = async (query: string): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'> | null> => {
    // ... (保持不变) ...
    const upperQuery = query.toUpperCase();
    const potentialPrefixes = ['us', 'sh', 'sz', 'hk'];

    for (const prefix of potentialPrefixes) {
        const formattedTicker = `${prefix}${upperQuery}`;
        try {
            const res = await fetch(`https://qt.gtimg.cn/q=${formattedTicker}`);
            if (!res.ok) continue;

            const text = await res.text();
            if (text.includes('~') && !text.includes('v_pv_none_match=1')) {
                const dataStr = text.substring(text.indexOf('"') + 1, text.lastIndexOf('"'));
                const parts = dataStr.split('~');
                if (parts.length > 2 && parts[1]) {
                    const name = parts[1];
                    const tickerWithExchange = parts[2];
                    const ticker = upperQuery;
                    const exchange = tencentExchangeToAppExchange(tickerWithExchange, prefix);
                    
                    if (exchange !== 'UNKNOWN') {
                        return { name, ticker, exchange };
                    }
                }
            }
        } catch (error) {
            console.warn(`Ticker search failed for ${formattedTicker}`, error);
            continue;
        }
    }
    return null;
};

export const getFinancialData = async (
    basicProfile: Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'>
): Promise<CompanyProfile> => {
    const formattedTicker = formatTickerForTencent(basicProfile.ticker, basicProfile.exchange);
    const upperExchange = basicProfile.exchange.toUpperCase();
    const isUS = ['NASDAQ', 'NYSE', 'AMEX', 'US'].includes(upperExchange);

    try {
        const quoteRes = await fetchWithRetry(`https://qt.gtimg.cn/q=${formattedTicker}`);

        if (!quoteRes.ok) {
            throw new Error(`Failed to fetch financial data for ${basicProfile.ticker}`);
        }

        const quoteText = await quoteRes.text();
        const quoteData = quoteText.substring(quoteText.indexOf('"') + 1, quoteText.lastIndexOf('"'));
        const parts = quoteData.split('~');

        if (parts.length < 30) {
            throw new Error('Invalid data format from Tencent API');
        }

        const quoteTime = parts[30] || '';
        const prevClose = parts[4] || '0.00';
        const openPrice = parts[5] || '0.00';
        const dayHigh = parts[33] || '0.00';
        const dayLow = parts[34] || '0.00';
        const dayChange = formatSignedValue(parts[31] || '0');
        const dayChangePct = formatSignedPercent(parts[32] || '0');
        const volume = parts[36] || parts[6] || '0';
        const amount = parts[37] || '0';
        const turnoverRate = parts[38] || '';
        const amplitude = parts[43] || '';
        const peRaw = parseFinite(parts[39] || '');
        const peTtm = peRaw !== null ? peRaw.toFixed(2) : '';
        const pbRaw = parseFinite(parts[46] || '');
        const pb = pbRaw !== null ? pbRaw.toFixed(2) : '';
        const marketCap = parts[44] || '';
        const floatMarketCap = parts[45] || '';
        const { high52w, low52w } = get52WeekBounds(parts, basicProfile.exchange);
        const currency = parseCurrencyField(parts[35] || '');

        let currentPrice = parseFloat(parts[3] || '0');
        let currentPriceStr = parts[3] || '0.00';
        let weekChange = dayChangePct || '0.00%';
        let monthChange = dayChangePct || '0.00%';
        let candles: Candle[] = [];

        try {
            if (isUS) {
                candles = await fetchUsNasdaqCandles(basicProfile.ticker);
                if (candles.length > 0) {
                    const latestClose = candles
                        .sort((a, b) => b.date.getTime() - a.date.getTime())[0]
                        .close;
                    currentPrice = latestClose;
                    currentPriceStr = latestClose.toFixed(2);
                }
            }

            if (candles.length === 0) {
                const klineRes = await fetchWithRetry(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${formattedTicker},day,,,90,qfq`);
                const klineJson = await klineRes.json();
                const dataNode = klineJson?.data?.[formattedTicker];
                const klineDataKey = dataNode ? (Object.keys(dataNode).find(k => k === 'day' || k === 'qfqday') || '') : '';
                const dailyData = klineDataKey ? dataNode[klineDataKey] : [];
                candles = Array.isArray(dailyData)
                    ? dailyData
                        .map((row: any[]) => {
                            const dt = parseKlineDate(row?.[0] || '');
                            const close = parseFloat(row?.[2] || '0');
                            if (!dt || !close) return null;
                            return { date: dt, close };
                        })
                        .filter(Boolean) as Candle[]
                    : [];
            }

            if (candles.length > 0 && currentPrice > 0) {
                const periodChange = calculatePeriodChanges(candles, currentPrice);
                weekChange = periodChange.weekChange;
                monthChange = periodChange.monthChange;
            }
        } catch (periodError) {
            console.warn(`Period-change data unavailable for ${basicProfile.ticker}:`, periodError);
        }

        return {
            ...basicProfile,
            currentPrice: currentPriceStr,
            weekChange,
            monthChange,
            quoteTime,
            prevClose,
            openPrice,
            dayHigh,
            dayLow,
            dayChange,
            dayChangePct,
            volume,
            amount,
            turnoverRate,
            amplitude,
            peTtm,
            pb,
            marketCap,
            floatMarketCap,
            high52w,
            low52w,
            currency,
            dataSource: 'tencent-quote',
        };

    } catch (error) {
        console.error(`Error in getFinancialData for ${basicProfile.ticker}:`, error);
        return {
            ...basicProfile,
            currentPrice: '0.00',
            weekChange: '0.00%',
            monthChange: '0.00%',
            dayChange: '0.00',
            dayChangePct: '0.00%',
            dataSource: 'tencent-quote',
        };
    }
};