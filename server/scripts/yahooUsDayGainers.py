#!/usr/bin/env python3
"""Fetch US gainers from Yahoo Finance screener (daily or weekly)."""
import json
import re
import sys
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf
from yfinance import EquityQuery

US_LISTED_EXCHANGE_CODES = {"NMS", "NAS", "NGM", "NG", "NCM", "NYQ", "NYS", "ASE", "PCX"}
WEEKLY_POOL_SORT_FIELDS = ("percentchange", "dayvolume", "eodvolume")


def is_likely_warrant_or_unit(symbol: str, name: str) -> bool:
    sym = (symbol or "").strip().upper()
    if not sym or "." in sym or "-" in sym:
        return True
    lower = (name or "").lower()
    if re.search(r"\bwarrant\b|\bunits?\b|\brights\b|\bdebenture\b", lower):
        return True
    if len(sym) >= 5 and re.search(r"(?:W|WS|WT|R)$", sym):
        return True
    return False


def is_us_listed_equity_quote(quote: dict) -> bool:
    quote_type = str(quote.get("quoteType") or "").upper()
    if quote_type and quote_type != "EQUITY":
        return False
    symbol = str(quote.get("symbol") or "").strip().upper()
    name = f"{quote.get('shortName') or ''} {quote.get('longName') or ''}"
    if is_likely_warrant_or_unit(symbol, name):
        return False
    exchange = str(quote.get("exchange") or "").upper()
    if exchange and exchange not in US_LISTED_EXCHANGE_CODES:
        return False
    return bool(symbol)


def build_day_query(min_mcap: int, min_volume: int) -> EquityQuery:
    return EquityQuery(
        "and",
        [
            EquityQuery("gt", ["percentchange", 0]),
            EquityQuery("eq", ["region", "us"]),
            EquityQuery("gte", ["intradaymarketcap", min_mcap]),
            EquityQuery("gt", ["dayvolume", min_volume]),
            EquityQuery("is-in", ["exchange", "NMS", "NYQ", "NGM", "NCM", "ASE"]),
        ],
    )


def build_weekly_pool_query(min_mcap: int, min_volume: int) -> EquityQuery:
    return EquityQuery(
        "and",
        [
            EquityQuery("eq", ["region", "us"]),
            EquityQuery("gte", ["intradaymarketcap", min_mcap]),
            EquityQuery("gt", ["dayvolume", min_volume]),
            EquityQuery("is-in", ["exchange", "NMS", "NYQ", "NGM", "NCM", "ASE"]),
        ],
    )


def parse_iso_date(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d")


def close_on_or_before(series, target: datetime) -> float | None:
    if series is None or series.empty:
        return None
    indexed = series.dropna()
    if indexed.empty:
        return None
    target_ts = target.replace(hour=0, minute=0, second=0, microsecond=0)
    eligible = indexed[indexed.index <= target_ts]
    if eligible.empty:
        return None
    value = float(eligible.iloc[-1])
    return value if value > 0 else None


def compute_weekly_change_pct(data, ticker: str, baseline_date: str, end_date: str) -> float | None:
    baseline = parse_iso_date(baseline_date)
    end = parse_iso_date(end_date)

    if isinstance(data.columns, pd.MultiIndex):
        if ticker not in data.columns.get_level_values(0):
            return None
        closes = data[ticker]["Close"] if "Close" in data[ticker] else data[ticker].get("Adj Close")
    else:
        closes = data["Close"] if "Close" in data else data.get("Adj Close")

    start_close = close_on_or_before(closes, baseline)
    end_close = close_on_or_before(closes, end)
    if start_close is None or end_close is None or start_close <= 0:
        return None
    return round(((end_close - start_close) / start_close) * 100, 2)


def fetch_daily(params: dict) -> dict:
    size = int(params.get("size", 45))
    min_mcap = int(params.get("minMarketCap", 100_000_000))
    min_volume = int(params.get("minDayVolume", 50_000))

    query = build_day_query(min_mcap, min_volume)
    result = yf.screen(query, sortField="percentchange", sortAsc=False, size=size)
    quotes = result.get("quotes", []) if isinstance(result, dict) else []
    return {"quotes": quotes}


def merge_weekly_pool(
    min_mcap: int,
    min_volume: int,
    pool_size_per_sort: int,
    pool_offsets: list[int],
) -> dict[str, dict]:
    query = build_weekly_pool_query(min_mcap, min_volume)
    quote_by_symbol: dict[str, dict] = {}
    for sort_field in WEEKLY_POOL_SORT_FIELDS:
        for offset in pool_offsets:
            result = yf.screen(
                query,
                sortField=sort_field,
                sortAsc=False,
                size=pool_size_per_sort,
                offset=offset,
            )
            quotes = result.get("quotes", []) if isinstance(result, dict) else []
            for quote in quotes:
                if not isinstance(quote, dict):
                    continue
                if not is_us_listed_equity_quote(quote):
                    continue
                symbol = str(quote.get("symbol") or "").strip().upper()
                if symbol and symbol not in quote_by_symbol:
                    quote_by_symbol[symbol] = quote
    return quote_by_symbol


def parse_pool_offsets(params: dict) -> list[int]:
    raw = params.get("poolOffsets")
    if isinstance(raw, list):
        parsed = [int(value) for value in raw if str(value).strip().isdigit()]
        if parsed:
            return parsed
    raw_text = str(params.get("poolOffsets") or params.get("poolOffset") or "").strip()
    if raw_text:
        parsed = [int(part.strip()) for part in raw_text.split(",") if part.strip().isdigit()]
        if parsed:
            return parsed
    return [0, 250, 500, 750, 1000]


def fetch_weekly(params: dict) -> dict:
    pool_size_per_sort = int(params.get("poolSizePerSort", params.get("poolSize", 250)))
    pool_offsets = parse_pool_offsets(params)
    count = int(params.get("count", 20))
    candidate_limit = max(count * 4, 80)
    min_mcap = int(params.get("minMarketCap", 100_000_000))
    min_volume = int(params.get("minDayVolume", 50_000))
    baseline_date = str(params.get("baselineDate") or "")
    trading_date_end = str(params.get("tradingDateEnd") or "")
    if not baseline_date or not trading_date_end:
        raise ValueError("weekly mode requires baselineDate and tradingDateEnd")

    quote_by_symbol = merge_weekly_pool(min_mcap, min_volume, pool_size_per_sort, pool_offsets)
    tickers = list(quote_by_symbol.keys())
    if not tickers:
        return {"quotes": []}

    start = parse_iso_date(baseline_date) - timedelta(days=7)
    end = parse_iso_date(trading_date_end) + timedelta(days=3)
    data = yf.download(
        tickers,
        start=start.strftime("%Y-%m-%d"),
        end=end.strftime("%Y-%m-%d"),
        group_by="ticker",
        auto_adjust=True,
        progress=False,
        threads=True,
    )

    candidates: list[tuple[str, float]] = []
    for ticker in tickers:
        weekly_pct = compute_weekly_change_pct(data, ticker, baseline_date, trading_date_end)
        if weekly_pct is None or weekly_pct <= 0:
            continue
        candidates.append((ticker, weekly_pct))

    candidates.sort(key=lambda item: item[1], reverse=True)
    enriched: list[dict] = []
    for ticker, weekly_pct in candidates:
        quote = dict(quote_by_symbol[ticker])
        mcap = quote.get("intradaymarketcap") or quote.get("marketCap")
        try:
            if mcap is not None and float(mcap) < min_mcap:
                continue
        except (TypeError, ValueError):
            pass
        quote["weeklyChangePercent"] = weekly_pct
        enriched.append(quote)
        if len(enriched) >= candidate_limit:
            break

    return {"quotes": enriched}


def main() -> None:
    params = json.load(sys.stdin)
    mode = str(params.get("mode") or "daily").lower()
    if mode == "weekly":
        payload = fetch_weekly(params)
    else:
        payload = fetch_daily(params)
    json.dump(payload, sys.stdout)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        json.dump({"error": str(exc)}, sys.stdout)
        sys.exit(1)
