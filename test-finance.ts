// test-sina.ts
import fetch from 'node-fetch';

const fetchSinaUSKline = async (ticker: string) => {
    // 新浪美股接口：不需要 us 前缀，直接用代码（如 AAPL, LAZR）
    // 接口返回的是 JSON 数组，按照日期旧->新排序
    const url = `https://stock.finance.sina.com.cn/usstock/api/json.php/US_MinKService.getDailyK?symbol=${ticker}`;
    
    console.log(`[Sina-Debug] URL: ${url}`);

    try {
        const res = await fetch(url, {
            headers: {
                'Referer': 'https://finance.sina.com.cn/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!res.ok) {
            console.error(`[Sina-Debug] Error Status: ${res.status}`);
            return null;
        }

        const json = await res.json();
        
        // 新浪返回格式: Array<{d: "2023-01-01", o: "100", c: "101", ...}>
        if (!Array.isArray(json)) {
            console.warn(`[Sina-Debug] Response is not an array`, json);
            return null;
        }

        console.log(`[Sina-Debug] Raw Data Length: ${json.length}`);

        // 转换为腾讯格式 [date, open, close, high, low, vol]
        const dailyData = json.map(item => {
            // 新浪的 c 是字符串，需要转 float
            return [item.d, item.o, item.c, item.h, item.l, item.v];
        });

        // 截取最近 320 天（新浪返回的是全部历史，可能很大）
        // 腾讯格式要求：旧 -> 新。新浪返回的也是 旧 -> 新。保持一致。
        const recentData = dailyData.slice(-320);
        
        return recentData;

    } catch (e) {
        console.error(`[Sina-Debug] Fetch failed:`, e);
        return null;
    }
};

const runTest = async (ticker: string) => {
    console.log(`\n=== Testing Sina for ${ticker} ===`);
    
    // 1. Get Real-time Price (Tencent works fine for this)
    const quoteRes = await fetch(`https://qt.gtimg.cn/q=us${ticker}`);
    const quoteText = await quoteRes.text();
    const parts = quoteText.split('~');
    const currentPrice = parseFloat(parts[3]);
    console.log(`Current Price (Tencent): ${currentPrice}`);

    // 2. Get Kline (Sina)
    const dailyData = await fetchSinaUSKline(ticker);

    if (dailyData && dailyData.length > 0) {
        const lastData = dailyData[dailyData.length - 1];
        console.log(`Latest Kline Date: ${lastData[0]}, Close: ${lastData[2]}`);
        
        // Calc Week (5 days ago)
        const weekIdx = dailyData.length - 1 - 5;
        if (weekIdx >= 0) {
            const past = parseFloat(dailyData[weekIdx][2]);
            const change = ((currentPrice - past) / past) * 100;
            console.log(`Week Change: ${change.toFixed(2)}% (Base: ${past})`);
        }
        
        // Calc Month
        // Logic: Find last day of previous month
        const lastDateStr = String(lastData[0]).replace(/-/g, ''); 
        const currentYearMonth = lastDateStr.substring(0, 6); 
        let prevMonthClose = 0;
        for (let i = dailyData.length - 1; i >= 0; i--) {
            const dateStr = String(dailyData[i][0]).replace(/-/g, '');
            const yearMonth = dateStr.substring(0, 6);
            if (yearMonth !== currentYearMonth) {
                prevMonthClose = parseFloat(dailyData[i][2]);
                break;
            }
        }
        if (prevMonthClose > 0) {
            const mChange = ((currentPrice - prevMonthClose) / prevMonthClose) * 100;
            console.log(`Month Change: ${mChange.toFixed(2)}% (Base: ${prevMonthClose})`);
        }

    } else {
        console.log("FAIL: Sina returned no data.");
    }
};

(async () => {
    await runTest("LAZR");
    await runTest("AAPL");
})();