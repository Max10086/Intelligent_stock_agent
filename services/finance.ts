import { CompanyProfile } from '../types.ts';

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

    try {
        const quoteRes = await fetch(`https://qt.gtimg.cn/q=${formattedTicker}`);

        if (!quoteRes.ok) {
            throw new Error(`Failed to fetch financial data for ${basicProfile.ticker}`);
        }

        const quoteText = await quoteRes.text();
        const quoteData = quoteText.substring(quoteText.indexOf('"') + 1, quoteText.lastIndexOf('"'));
        const parts = quoteData.split('~');

        if (parts.length < 30) {
            throw new Error('Invalid data format from Tencent API');
        }

        const currentPriceStr = parts[3] || '0.00';
        const currentPrice = parseFloat(currentPriceStr);

        // Fetch K-line data (Fetch 60 days to be safe, ensuring we cover the previous month end)
        const klineRes = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${formattedTicker},day,,,60,qfq`);
        const klineJson = await klineRes.json();
        
        const dataNode = klineJson.data[formattedTicker];
        const klineDataKey = Object.keys(dataNode).find(k => k === 'qfqday' || k === 'day');
        // K-line format: [date, open, close, high, low, vol], sorted Old -> New
        const dailyData = klineDataKey ? dataNode[klineDataKey] : [];

        // --- 1. 计算周涨跌幅 (保持原来的滚动逻辑，或根据需求改为本周) ---
        // 通常"周涨幅"业界惯例是滚动5日，如果你想改成"本周涨跌幅"(WTD)，逻辑类似MTD
        // 这里暂时保持你认可的滚动5交易日逻辑
        const calcRollingChange = (daysAgo: number) => {
            const len = dailyData.length;
            const targetIndex = len - 1 - daysAgo; 
            
            if (targetIndex < 0 || !dailyData[targetIndex]) return '0.00%';
            
            const pastClose = parseFloat(dailyData[targetIndex][2]);
            if (!pastClose) return '0.00%';
            
            const change = ((currentPrice - pastClose) / pastClose) * 100;
            return (change > 0 ? '+' : '') + change.toFixed(2) + '%';
        };

        // --- 2. 计算本月涨跌幅 (MTD) ---
        // 逻辑：找到上个月最后一个交易日的收盘价作为基准
        const calcMTD = () => {
            if (!dailyData || dailyData.length === 0) return '0.00%';

            // 获取最近一条K线的日期 (格式通常为 "2026-01-18" 或 "20260118")
            const lastData = dailyData[dailyData.length - 1];
            const lastDateStr = lastData[0].replace(/-/g, ''); // 统一格式为 YYYYMMDD
            const currentYearMonth = lastDateStr.substring(0, 6); // 取前6位，如 "202601"

            let prevMonthClose = 0;

            // 倒序遍历，寻找月份变动的那一刻
            for (let i = dailyData.length - 1; i >= 0; i--) {
                const dateStr = dailyData[i][0].replace(/-/g, '');
                const yearMonth = dateStr.substring(0, 6);

                // 如果找到了不属于当前月份的数据，说明这是上个月的最后一条数据（因为是倒序）
                if (yearMonth !== currentYearMonth) {
                    prevMonthClose = parseFloat(dailyData[i][2]); // Index 2 is Close Price
                    // console.log(`Found baseline for MTD: Date=${dateStr}, Close=${prevMonthClose}`);
                    break;
                }
            }

            // 如果没找到（比如刚上市不满一个月），或者数据不足，返回0
            if (prevMonthClose === 0) return '0.00%';

            const change = ((currentPrice - prevMonthClose) / prevMonthClose) * 100;
            return (change > 0 ? '+' : '') + change.toFixed(2) + '%';
        };

        return {
            ...basicProfile,
            currentPrice: currentPriceStr,
            weekChange: calcRollingChange(5), // 滚动5日涨跌
            monthChange: calcMTD(),           // 本月(MTD)涨跌
        };

    } catch (error) {
        console.error(`Error in getFinancialData for ${basicProfile.ticker}:`, error);
        return {
            ...basicProfile,
            currentPrice: '0.00',
            weekChange: '0.00%',
            monthChange: '0.00%',
        };
    }
};