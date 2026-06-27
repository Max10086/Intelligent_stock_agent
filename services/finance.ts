import type { CompanyProfile } from '../types.ts';

const decodeTencentQuoteText = async (res: Response): Promise<string> => {
    const buffer = await res.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const encodings = ['gb18030', 'gbk', 'utf-8'];

    for (const encoding of encodings) {
        try {
            return new TextDecoder(encoding as any).decode(bytes);
        } catch {
            // Try next encoding.
        }
    }

    // Final fallback: utf-8 decode
    return new TextDecoder('utf-8').decode(bytes);
};

const hasBrokenName = (name: string): boolean => {
    if (!name) return true;
    if (name.includes('�')) return true;
    if (/[\u0000-\u001f]/.test(name)) return true;
    return false;
};

const normalizeDisplayName = (rawName: string | undefined, fallbackTicker: string): string => {
    const cleaned = (rawName || '').replace(/\s+/g, ' ').trim();
    if (hasBrokenName(cleaned)) {
        return fallbackTicker;
    }
    return cleaned;
};

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

const looksLikeTicker = (query: string): boolean => /^[A-Za-z0-9.\-]{1,10}$/.test(query.trim());

const COMPANY_QUERY_ALIAS: Record<string, string> = {
    '闪迪': 'sandisk',
    'sandisk': 'sandisk',
    '西部数据': 'western digital',
    '西数': 'western digital',
};

const normalizeCompanyQuery = (query: string): string[] => {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const lower = trimmed.toLowerCase();
    const mapped = COMPANY_QUERY_ALIAS[lower] || COMPANY_QUERY_ALIAS[trimmed] || '';
    const hasNonAscii = /[^\x00-\x7F]/.test(trimmed);
    const candidates: string[] = [];
    if (!hasNonAscii || !mapped) candidates.push(trimmed);
    if (mapped && !candidates.includes(mapped)) candidates.push(mapped);
    return candidates;
};

const yahooExchangeToAppExchange = (exchange?: string): string => {
    const ex = (exchange || '').toUpperCase();
    if (['NMS', 'NAS', 'NGM', 'NYQ', 'ASE', 'PCX'].includes(ex)) return 'NASDAQ';
    if (['HKG', 'HKGSI'].includes(ex)) return 'HKEX';
    if (['SHH'].includes(ex)) return 'SSE';
    if (['SHE', 'SHZ'].includes(ex)) return 'SZSE';
    return 'UNKNOWN';
};

const smartboxPrefixToExchange = (prefix: string): string => {
    const p = prefix.toLowerCase();
    if (p === 'us') return 'NASDAQ';
    if (p === 'hk') return 'HKEX';
    if (p === 'sh') return 'SSE';
    if (p === 'sz') return 'SZSE';
    return 'UNKNOWN';
};

const decodeUnicodeEscapes = (value: string): string => {
    if (!value) return value;
    if (!value.includes('\\u')) return value;
    try {
        const safe = value.replace(/"/g, '\\"');
        return JSON.parse(`"${safe}"`);
    } catch {
        return value;
    }
};

const validateTickerViaTencent = async (ticker: string, exchange: string): Promise<boolean> => {
    const formatted = formatTickerForTencent(ticker, exchange);
    try {
        const res = await fetchWithRetry(`https://qt.gtimg.cn/q=${formatted}`);
        const text = await decodeTencentQuoteText(res);
        return text.includes('~') && !text.includes('v_pv_none_match=1');
    } catch {
        return false;
    }
};

const searchTickerByTencentSmartbox = async (query: string): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'> | null> => {
    const url = `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(query)}&t=all`;
    const res = await fetchWithRetry(url);
    const text = await res.text();
    const match = text.match(/v_hint="([^"]*)"/);
    if (!match || !match[1]) return null;

    const entries = match[1].split('^');
    const queryLower = query.trim().toLowerCase();
    const candidates: Array<{ score: number; name: string; ticker: string; exchange: string }> = [];

    for (const entry of entries) {
        const parts = entry.split('~');
        // Typical shape: marketPrefix ~ code.suffix ~ name ~ pinyin ~ type
        if (parts.length < 5) continue;
        const marketPrefix = parts[0];
        const rawCode = parts[1] || '';
        const name = decodeUnicodeEscapes(parts[2] || '');
        const secType = (parts[4] || '').toUpperCase();
        const exchange = smartboxPrefixToExchange(marketPrefix);
        if (exchange === 'UNKNOWN') continue;
        // Keep common equity variants:
        // GP (stock), GP-A / GP-B (A/B shares in CN markets).
        if (!secType.startsWith('GP')) continue; // skip options/warrants/structured products

        const ticker = rawCode.split('.')[0].toUpperCase();
        if (!ticker || ticker.includes('-') || ticker.includes('=')) continue;

        let score = 0;
        const nameLower = name.toLowerCase();
        if (nameLower === queryLower) score += 100;
        else if (nameLower.includes(queryLower) || queryLower.includes(nameLower)) score += 60;
        if (exchange === 'NASDAQ') score += 5; // mild preference for US when ties

        candidates.push({ score, name, ticker, exchange });
    }

    candidates.sort((a, b) => b.score - a.score);
    for (const c of candidates) {
        const isValid = await validateTickerViaTencent(c.ticker, c.exchange);
        if (!isValid) continue;
        return { name: c.name, ticker: c.ticker, exchange: c.exchange };
    }

    return null;
};

const searchTickerByCompanyName = async (query: string): Promise<Pick<CompanyProfile, 'name' | 'ticker' | 'exchange'> | null> => {
    // 1) Tencent SmartBox supports Chinese names well.
    try {
        const bySmartbox = await searchTickerByTencentSmartbox(query);
        if (bySmartbox) return bySmartbox;
    } catch (error) {
        console.warn(`Smartbox search failed for ${query}`, error);
    }

    // 2) Yahoo fallback for English names/aliases.
    const candidates = normalizeCompanyQuery(query);
    for (const candidate of candidates) {
        try {
            const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(candidate)}`;
            const res = await fetchWithRetry(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            const json = await res.json();
            const quotes = Array.isArray(json?.quotes) ? json.quotes : [];
            for (const q of quotes) {
                const symbol = (q?.symbol || '').toString().trim();
                const exchange = yahooExchangeToAppExchange(q?.exchange || q?.exchDisp);
                if (!symbol || exchange === 'UNKNOWN') continue;
                // Filter out derivatives/OTC-like symbols for primary listing match.
                if (symbol.includes('-') || symbol.includes('=')) continue;

                const isValid = await validateTickerViaTencent(symbol, exchange);
                if (!isValid) continue;

                return {
                    name: q?.longname || q?.shortname || candidate,
                    ticker: symbol.toUpperCase(),
                    exchange,
                };
            }
        } catch (error) {
            console.warn(`Company search failed for ${candidate}`, error);
        }
    }
    return null;
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
    const isCn = ['SSE', 'SZSE', 'SH', 'SZ'].includes(upperExchange);

    if (isCn) {
        // A-shares: verified against Tencent 260-day K-line — true 52w range is at [67]/[68].
        // [47]/[48] are unreliable (often a shorter window or stale values).
        let high = parseFinite(parts[67] || '');
        let low = parseFinite(parts[68] || '');

        if (high === null || low === null || high <= 0 || low <= 0 || high < low) {
            high = parseFinite(parts[47] || '');
            low = parseFinite(parts[48] || '');
        }

        // Some high-volatility symbols (e.g. sh603256) store an earlier 52w low at [66].
        const extraLow = parseFinite(parts[66] || '');
        if (
            low !== null &&
            extraLow !== null &&
            extraLow > 0 &&
            extraLow < low &&
            extraLow >= low * 0.15
        ) {
            low = extraLow;
        }

        return {
            high52w: high !== null ? high.toFixed(2) : '',
            low52w: low !== null ? low.toFixed(2) : '',
        };
    }

    const high = parseFinite(parts[48] || '');
    const low = parseFinite(parts[49] || '');
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
    const trimmed = query.trim();
    const upperQuery = trimmed.toUpperCase();

    // 1) Prefer direct ticker probing for ticker-like inputs.
    if (looksLikeTicker(trimmed)) {
        const potentialPrefixes = ['us', 'sh', 'sz', 'hk'];
        for (const prefix of potentialPrefixes) {
            const formattedTicker = `${prefix}${upperQuery}`;
            try {
                const res = await fetchWithRetry(`https://qt.gtimg.cn/q=${formattedTicker}`);
                if (!res.ok) continue;

                const text = await decodeTencentQuoteText(res);
                if (text.includes('~') && !text.includes('v_pv_none_match=1')) {
                    const dataStr = text.substring(text.indexOf('"') + 1, text.lastIndexOf('"'));
                    const parts = dataStr.split('~');
                    if (parts.length > 2 && parts[1]) {
                        const name = normalizeDisplayName(parts[1], upperQuery);
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
            }
        }
    }

    // 2) Company-name search fallback (handles queries like "闪迪").
    return await searchTickerByCompanyName(trimmed);
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

        const quoteText = await decodeTencentQuoteText(quoteRes);
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
        // Tencent quote payload uses [45] for total market cap and [44] for float market cap
        // (verified with US symbols like PL/PLTR where [45] matches broker-reported total cap).
        const marketCap = parts[45] || '';
        const floatMarketCap = parts[44] || '';
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