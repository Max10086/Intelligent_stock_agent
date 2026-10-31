#!/usr/bin/env python3
"""Build server/data/usTickerSectors.json from public sector datasets."""

from __future__ import annotations

import csv
import io
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_PATH = ROOT / 'data' / 'usTickerSectors.json'

# Russell 3000 `gsector` column uses numeric GICS sector codes, not display names.
GICS_SECTOR_CODE_TO_NAME: dict[str, str] = {
    '10': 'Energy',
    '15': 'Materials',
    '20': 'Industrials',
    '25': 'Consumer Discretionary',
    '30': 'Consumer Staples',
    '35': 'Health Care',
    '40': 'Financials',
    '45': 'Information Technology',
    '50': 'Communication Services',
    '55': 'Utilities',
    '60': 'Real Estate',
}


def normalize_sector(raw: str) -> str:
    text = (raw or '').strip()
    if not text:
        return ''
    # Russell gsector values like "35.0" / "35"
    numeric = text.rstrip('0').rstrip('.') if '.' in text else text
    if numeric.isdigit() or (text.replace('.', '', 1).isdigit() and text.count('.') <= 1):
        code = str(int(float(text)))
        return GICS_SECTOR_CODE_TO_NAME.get(code, text)
    return text

SOURCES = {
    'sp500': 'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/master/data/constituents.csv',
    'russell3000': 'https://raw.githubusercontent.com/yya518/peer-firms/main/russell3000_ticker_GIC.csv',
    'iwm': 'https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/latest-holdings.csv',
}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read().decode('utf-8', errors='replace')


def normalize_ticker(raw: str) -> str:
    return raw.strip().upper().replace('.', '-')


def add(merged: dict[str, dict], ticker: str, sector: str, industry: str | None = None) -> None:
    sym = normalize_ticker(ticker)
    sector = normalize_sector(sector)
    if not sym or not sector:
        return
    if sym in merged:
        return
    entry: dict[str, str] = {'sector': sector}
    if industry and industry.strip():
        entry['industry'] = industry.strip()
    merged[sym] = entry


def main() -> None:
    merged: dict[str, dict] = {}

    sp500 = fetch(SOURCES['sp500'])
    for row in csv.DictReader(io.StringIO(sp500)):
        add(merged, row.get('Symbol', ''), row.get('GICS Sector', ''), row.get('GICS Sub-Industry', ''))
    print(f'sp500: {len(merged)}', file=sys.stderr)

    try:
        r3k = fetch(SOURCES['russell3000'])
        before = len(merged)
        for row in csv.DictReader(io.StringIO(r3k)):
            add(merged, row.get('Symbol') or row.get('symbol') or '', row.get('gsector') or row.get('sector') or '')
        print(f'russell3000: +{len(merged) - before} (total {len(merged)})', file=sys.stderr)
    except Exception as exc:
        print(f'russell3000 skipped: {exc}', file=sys.stderr)

    try:
        iwm = fetch(SOURCES['iwm'])
        before = len(merged)
        lines = iwm.splitlines()
        start = next((i for i, line in enumerate(lines) if line.startswith('Ticker,Name,Sector')), None)
        if start is not None:
            for row in csv.DictReader(lines[start:]):
                add(merged, row.get('Ticker', ''), row.get('Sector', ''))
        print(f'iwm: +{len(merged) - before} (total {len(merged)})', file=sys.stderr)
    except Exception as exc:
        print(f'iwm skipped: {exc}', file=sys.stderr)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(merged, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'wrote {OUT_PATH} ({len(merged)} tickers)')


if __name__ == '__main__':
    main()
