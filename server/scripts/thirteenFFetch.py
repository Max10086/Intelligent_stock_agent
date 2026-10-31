#!/usr/bin/env python3
"""JSON stdin/stdout SEC 13F-HR fetcher for Node.js (edgartools).

Input:
{
  "cik": "0001350694",
  "quarter": "2025-Q2",   // optional — defaults to latest filing
  "maxChangesPerCategory": 50
}

Output: holdings bundle with changes vs prior quarter.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

try:
    from edgar import Company, set_identity
except ImportError:  # pragma: no cover
    Company = None  # type: ignore
    set_identity = None  # type: ignore


KNOWN_ETFS = {
    "SPY", "IVV", "VOO", "QQQ", "IWM", "VTI", "VEA", "VWO", "EFA", "EEM",
    "GLD", "SLV", "TLT", "HYG", "LQD", "XLF", "XLK", "XLE", "XLV", "XLI",
    "ARKK", "SCHD", "VIG", "IEMG", "IEFA", "AGG", "BND", "TIP", "SHY",
}

# Legacy / renamed filers → active 13F CIK (keep in sync with thirteenFInstitutionSearch.ts).
CIK_REDIRECTS: dict[str, str] = {
    "0001006438": "0001656456",  # Appaloosa Management LP → Appaloosa LP
    "0001420793": "0001649339",  # legacy catalog typo (Jefferies) → Scion
    "0001277006": "0001512920",  # legacy Sprott Asset Management Inc → Sprott Inc
}


def resolve_primary_cik(cik: str) -> str:
    normalized = normalize_cik(cik)
    return CIK_REDIRECTS.get(normalized, normalized)

THIRTEENF_NS = {"n": "http://www.sec.gov/edgar/thirteenffiler"}


def ensure_identity() -> None:
    identity = os.environ.get("EDGAR_IDENTITY", "").strip()
    if not identity:
        raise ValueError("EDGAR_IDENTITY is required (SEC mandates a contact email/name)")
    if set_identity is None:
        raise RuntimeError("edgartools is not installed — run: pip install -r requirements-edgar.txt")
    set_identity(identity)


def normalize_cik(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        raise ValueError(f"invalid cik: {raw!r}")
    return digits.zfill(10)


def fetch_sec_company_name(cik: str) -> str:
    """Load SEC-registered legal name (works even when edgartools Company.name is empty)."""
    identity = os.environ.get("EDGAR_IDENTITY", "").strip()
    if not identity:
        return ""
    normalized = normalize_cik(cik)
    url = f"https://data.sec.gov/submissions/CIK{normalized}.json"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": identity, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.load(response)
    except Exception:
        return ""
    return str(payload.get("name") or "").strip()


def fetch_sec_former_names(cik: str) -> list[str]:
    """Load SEC-registered former legal names for rename banners."""
    identity = os.environ.get("EDGAR_IDENTITY", "").strip()
    if not identity:
        return []
    normalized = normalize_cik(cik)
    url = f"https://data.sec.gov/submissions/CIK{normalized}.json"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": identity, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            payload = json.load(response)
    except Exception:
        return []

    current_name = str(payload.get("name") or "").strip()
    names: list[str] = []
    for item in payload.get("formerNames") or []:
        name = str(item.get("name") or "").strip()
        if name and name != current_name and name not in names:
            names.append(name)
    return names


def report_date_to_quarter(report_date: date | datetime | str | None) -> str | None:
    if report_date is None:
        return None
    if isinstance(report_date, str):
        report_date = datetime.strptime(report_date[:10], "%Y-%m-%d").date()
    elif isinstance(report_date, datetime):
        report_date = report_date.date()
    quarter = (report_date.month - 1) // 3 + 1
    return f"{report_date.year}-Q{quarter}"


def quarter_sort_key(quarter: str) -> tuple[int, int]:
    match = re.match(r"^(\d{4})-Q([1-4])$", quarter or "")
    if not match:
        return (0, 0)
    return (int(match.group(1)), int(match.group(2)))


def infer_sector(issuer: str, ticker: str, put_call: str = "") -> str:
    upper = (issuer or "").upper()
    if put_call:
        return "Options"
    if "ETF" in upper or ticker in KNOWN_ETFS:
        return "ETF"
    return "Equity"


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_int(value: Any, default: int = 0) -> int:
    parsed = safe_float(value, float(default))
    if parsed != parsed:  # NaN
        return default
    return int(round(parsed))


def safe_ticker(raw: Any) -> str:
    text = str(raw or "").strip().upper()
    if not text or text in {"NAN", "NONE", "N/A"}:
        return ""
    return text


def filing_quarter_id(filing) -> str | None:
    report_date = getattr(filing, "report_date", None) or getattr(filing, "period_of_report", None)
    if report_date is None and hasattr(filing, "obj"):
        try:
            obj = filing.obj()
            report_date = getattr(obj, "report_date", None) or getattr(obj, "period_of_report", None)
        except Exception:
            report_date = None
    return report_date_to_quarter(report_date)


def list_quarter_options(company, limit: int = 8) -> list[dict[str, Any]]:
    """Merge 13F-HR and 13F-NT so notice-only quarters (e.g. after a reorg) still appear."""
    by_quarter: dict[str, dict[str, Any]] = {}

    for form in ("13F-HR", "13F-NT"):
        filings = company.get_filings(form=form)
        if not filings:
            continue
        for filing in filings.head(max(limit * 3, 20)):
            quarter = filing_quarter_id(filing)
            if not quarter:
                continue
            entry = by_quarter.setdefault(
                quarter,
                {
                    "quarter": quarter,
                    "filingDate": "",
                    "reportDate": "",
                    "hasHr": False,
                    "hasNt": False,
                },
            )
            filing_date = str(getattr(filing, "filing_date", "") or "")[:10]
            report_date = str(
                getattr(filing, "report_date", None)
                or getattr(filing, "period_of_report", None)
                or ""
            )[:10]
            if form == "13F-HR":
                entry["hasHr"] = True
                if filing_date:
                    entry["filingDate"] = filing_date
                if report_date:
                    entry["reportDate"] = report_date
            else:
                entry["hasNt"] = True
                if not entry["filingDate"] and filing_date:
                    entry["filingDate"] = filing_date
                if not entry["reportDate"] and report_date:
                    entry["reportDate"] = report_date

    sorted_quarters = sorted(by_quarter.keys(), key=quarter_sort_key, reverse=True)[:limit]
    options: list[dict[str, Any]] = []
    for index, quarter in enumerate(sorted_quarters):
        entry = by_quarter[quarter]
        options.append(
            {
                "quarter": quarter,
                "filingDate": entry["filingDate"],
                "reportDate": entry["reportDate"],
                "isLatest": index == 0,
                "noticeOnly": entry["hasNt"] and not entry["hasHr"],
            }
        )
    return options


def filing_for_quarter(filings, quarter: str):
    if not filings:
        return None
    for filing in filings:
        if filing_quarter_id(filing) == quarter:
            return filing
    return None


def parse_nt_other_managers(filing) -> list[dict[str, str]]:
    managers: list[dict[str, str]] = []
    try:
        xml_text = filing.xml() if hasattr(filing, "xml") else None
    except Exception:
        xml_text = None
    if not xml_text:
        return managers

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return managers

    for node in root.findall(".//n:otherManager", THIRTEENF_NS):
        cik_text = (node.findtext("n:cik", default="", namespaces=THIRTEENF_NS) or "").strip()
        name = (node.findtext("n:name", default="", namespaces=THIRTEENF_NS) or "").strip()
        if cik_text:
            managers.append({"cik": normalize_cik(cik_text), "name": name})
    return managers


def parse_nt_additional_information(filing) -> str:
    try:
        xml_text = filing.xml() if hasattr(filing, "xml") else None
    except Exception:
        return ""
    if not xml_text:
        return ""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return ""
    return (
        root.findtext(".//n:additionalInformation", default="", namespaces=THIRTEENF_NS) or ""
    ).strip()


@dataclass
class ResolvedHoldingsFiling:
    hr_filing: Any
    holdings_cik: str
    quarter: str
    redirect: dict[str, Any] | None = None


def resolve_holdings_filing(company, normalized_cik: str, quarter: str | None) -> ResolvedHoldingsFiling:
    """Resolve 13F-HR for a quarter, following 13F-NT other-manager pointers when needed."""
    available = list_quarter_options(company, limit=12)
    if not available:
        raise ValueError(f"No 13F filings found for CIK {normalized_cik}")

    target_quarter = quarter
    if target_quarter:
        known = {item["quarter"] for item in available}
        if target_quarter not in known:
            raise ValueError(f"No 13F filing for quarter {target_quarter}")
    else:
        target_quarter = available[0]["quarter"]

    hr_filings = company.get_filings(form="13F-HR")
    hr = filing_for_quarter(hr_filings, target_quarter)
    if hr:
        return ResolvedHoldingsFiling(
            hr_filing=hr,
            holdings_cik=normalized_cik,
            quarter=target_quarter,
            redirect=None,
        )

    nt_filings = company.get_filings(form="13F-NT")
    nt = filing_for_quarter(nt_filings, target_quarter)
    if not nt:
        raise ValueError(f"No 13F-HR or 13F-NT filing found for quarter {target_quarter}")

    other_managers = parse_nt_other_managers(nt)
    if not other_managers:
        raise ValueError(
            f"13F-NT for {normalized_cik} {target_quarter} has no other managers to resolve holdings"
        )

    notice_date = str(getattr(nt, "filing_date", "") or "")[:10]
    additional_info = parse_nt_additional_information(nt)

    for manager in other_managers:
        om_cik = manager["cik"]
        om_company = Company(om_cik)
        om_hr = filing_for_quarter(om_company.get_filings(form="13F-HR"), target_quarter)
        if not om_hr:
            continue
        om_name = manager.get("name") or getattr(om_company, "name", None) or om_cik
        print(
            f"[thirteenFFetch] 13F-NT redirect {normalized_cik} {target_quarter} -> {om_cik} ({om_name})",
            file=sys.stderr,
        )
        return ResolvedHoldingsFiling(
            hr_filing=om_hr,
            holdings_cik=om_cik,
            quarter=target_quarter,
            redirect={
                "type": "13F-NT-redirect",
                "sourceCik": om_cik,
                "sourceInstitutionName": om_name,
                "noticeFilingDate": notice_date,
                "additionalInformation": additional_info or None,
            },
        )

    names = ", ".join(manager.get("name") or manager["cik"] for manager in other_managers)
    raise ValueError(
        f"13F-NT for {normalized_cik} {target_quarter} lists other managers ({names}) "
        f"but none filed 13F-HR for that quarter"
    )


def pick_filing(filings, quarter: str | None):
    if quarter:
        match = filing_for_quarter(filings, quarter)
        if match:
            return match
        print(
            f"[thirteenFFetch] No 13F-HR for quarter {quarter} — using latest filing instead",
            file=sys.stderr,
        )
    return filings.latest()


def holding_aggregate_key(ticker: str, put_call: str = "") -> str:
    put = str(put_call or "").strip().upper()
    if put:
        return f"{ticker}|{put}"
    return ticker


def aggregate_holdings_rows(
    rows: list[dict[str, Any]], total_aum: float, cik: str, quarter: str
) -> list[dict[str, Any]]:
    """Merge duplicate 13F line items (same ticker/CUSIP reported by multiple subsidiaries)."""
    if not rows:
        return rows

    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = holding_aggregate_key(row["ticker"], row.get("_putCall", ""))
        existing = grouped.get(key)
        if existing is None:
            grouped[key] = {
                **row,
                "shares": safe_int(row.get("shares")),
                "marketValueUsd": safe_float(row.get("marketValueUsd")),
                "_lineCount": 1,
            }
            continue

        existing["shares"] = safe_int(existing["shares"]) + safe_int(row.get("shares"))
        existing["marketValueUsd"] = safe_float(existing["marketValueUsd"]) + safe_float(
            row.get("marketValueUsd")
        )
        existing["_lineCount"] = int(existing.get("_lineCount", 1)) + 1
        if safe_float(row.get("marketValueUsd")) > safe_float(existing.get("_primaryLineValue")):
            existing["name"] = row["name"]
            existing["_primaryLineValue"] = safe_float(row.get("marketValueUsd"))

    merged: list[dict[str, Any]] = []
    for row in grouped.values():
        shares = safe_int(row.get("shares"))
        market_value = safe_float(row.get("marketValueUsd"))
        row.pop("_lineCount", None)
        row.pop("_primaryLineValue", None)
        row.pop("_putCall", None)
        row["shares"] = shares
        row["marketValueUsd"] = market_value
        row["portfolioWeightPct"] = (market_value / total_aum * 100) if total_aum > 0 else 0.0
        row["referencePriceUsd"] = (market_value / shares) if shares > 0 else None
        row["id"] = f"{cik}-{quarter}-{row['ticker']}"
        merged.append(row)

    merged.sort(key=lambda item: item["marketValueUsd"], reverse=True)
    for index, row in enumerate(merged):
        row["rank"] = index + 1
    return merged


def infotable_column(df, *candidates: str) -> str:
    for name in candidates:
        if name in df.columns:
            return name
    raise ValueError(
        f"Missing infotable column (expected one of {list(candidates)}); got {list(df.columns)}"
    )


def infotable_total_value(df) -> float:
    if df is None or len(df) == 0:
        return 0.0
    value_col = infotable_column(df, "Value", "value", "MarketValue", "marketValue")
    return safe_float(df[value_col].sum())


def holdings_from_df(df, total_aum: float, cik: str, quarter: str, filing_date: str, report_date: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if df is None or len(df) == 0:
        return rows

    value_col = infotable_column(df, "Value", "value", "MarketValue", "marketValue")
    shares_col = infotable_column(
        df, "SharesPrnAmount", "Shares", "shares", "sshPrnamt", "SharesPrnAmt"
    )
    ticker_col = infotable_column(df, "Ticker", "ticker", "Symbol", "symbol")
    issuer_col = infotable_column(df, "Issuer", "issuer", "NameOfIssuer", "nameOfIssuer")
    put_call_col = "PutCall" if "PutCall" in df.columns else "putCall" if "putCall" in df.columns else None

    sorted_df = df.sort_values(by=value_col, ascending=False)
    for idx, row in sorted_df.iterrows():
        ticker = safe_ticker(row.get(ticker_col))
        if not ticker:
            continue
        shares = safe_float(row.get(shares_col))
        market_value = safe_float(row.get(value_col))
        if market_value <= 0:
            continue
        put_call = str(row.get(put_call_col) or "") if put_call_col else ""
        issuer = str(row.get(issuer_col) or ticker)
        sector = infer_sector(issuer, ticker, put_call)
        rows.append(
            {
                "id": f"{cik}-{quarter}-{ticker}",
                "cik": cik,
                "quarter": quarter,
                "ticker": ticker,
                "name": issuer,
                "sector": sector,
                "_putCall": put_call,
                "shares": safe_int(row.get(shares_col)),
                "marketValueUsd": market_value,
                "portfolioWeightPct": 0.0,
                "rank": 0,
                "filingDate": filing_date,
                "reportDate": report_date,
                "referencePriceUsd": (market_value / shares) if shares > 0 else None,
            }
        )

    return aggregate_holdings_rows(rows, total_aum, cik, quarter)


def json_number(value: Any) -> float | None:
    parsed = safe_float(value, default=float("nan"))
    if parsed != parsed or math.isinf(parsed):
        return None
    return parsed


def sanitize_json(value: Any) -> Any:
    if isinstance(value, float):
        if value != value or math.isinf(value):
            return None
        return value
    if isinstance(value, dict):
        return {key: sanitize_json(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_json(item) for item in value]
    return value


def map_status(status: str) -> str | None:
    mapping = {
        "NEW": "NEW",
        "INCREASED": "ADD",
        "DECREASED": "REDUCE",
        "CLOSED": "CLEAR",
    }
    return mapping.get(str(status or "").upper())


def changes_from_comparison(
    cmp,
    total_aum: float,
    cik: str,
    quarter: str,
    prior_quarter: str,
    max_per_category: int,
) -> tuple[list[dict[str, Any]], dict[str, int], dict[str, int]]:
    counts = {"NEW": 0, "ADD": 0, "REDUCE": 0, "CLEAR": 0}
    if cmp is None or not hasattr(cmp, "data") or cmp.data is None:
        return [], counts, counts

    df = cmp.data
    buckets: dict[str, list[dict[str, Any]]] = {"NEW": [], "ADD": [], "REDUCE": [], "CLEAR": []}

    for _, row in df.iterrows():
        category = map_status(row.get("Status"))
        if not category:
            continue
        counts[category] += 1

        ticker = safe_ticker(row.get("Ticker"))
        if not ticker:
            continue
        issuer = str(row.get("Issuer") or ticker)
        value_change = safe_float(row.get("ValueChange"))
        current_value = safe_float(row.get("Value"))
        prior_value = safe_float(row.get("PrevValue"))
        current_shares = safe_float(row.get("Shares"))
        prior_shares = safe_float(row.get("PrevShares"))
        share_change = safe_float(row.get("ShareChange"))
        value_change_pct = safe_float(row.get("ValueChangePct"))
        current_weight = (current_value / total_aum * 100) if total_aum > 0 and current_value > 0 else None
        prior_weight = (prior_value / total_aum * 100) if total_aum > 0 and prior_value > 0 else None
        weight_delta = None
        if current_weight is not None and prior_weight is not None:
            weight_delta = current_weight - prior_weight
        elif current_weight is not None:
            weight_delta = current_weight
        elif prior_weight is not None:
            weight_delta = -prior_weight

        weight_delta_pct = json_number(weight_delta)

        buckets[category].append(
            {
                "id": f"{cik}-{quarter}-chg-{ticker}-{category}",
                "cik": cik,
                "quarter": quarter,
                "priorQuarter": prior_quarter,
                "ticker": ticker,
                "name": issuer,
                "sector": infer_sector(issuer, ticker),
                "category": category,
                "priorShares": safe_int(prior_shares) if prior_shares > 0 else None,
                "currentShares": safe_int(current_shares) if current_shares > 0 else None,
                "sharesDelta": safe_int(share_change),
                "priorMarketValueUsd": json_number(prior_value),
                "currentMarketValueUsd": json_number(current_value),
                "marketValueDeltaUsd": json_number(value_change) or 0,
                "priorWeightPct": json_number(prior_weight),
                "currentWeightPct": json_number(current_weight),
                "weightDeltaPct": weight_delta_pct,
                "_absDelta": abs(json_number(value_change) or 0),
            }
        )

    changes: list[dict[str, Any]] = []
    for category in ("NEW", "ADD", "REDUCE", "CLEAR"):
        items = sorted(buckets[category], key=lambda item: item["_absDelta"], reverse=True)
        by_ticker: dict[str, dict[str, Any]] = {}
        for item in items:
            ticker = item["ticker"]
            existing = by_ticker.get(ticker)
            if existing is None:
                by_ticker[ticker] = item
                continue
            existing["marketValueDeltaUsd"] = (existing.get("marketValueDeltaUsd") or 0) + (
                item.get("marketValueDeltaUsd") or 0
            )
            existing["sharesDelta"] = (existing.get("sharesDelta") or 0) + (item.get("sharesDelta") or 0)
            if item["_absDelta"] > existing["_absDelta"]:
                existing["_absDelta"] = item["_absDelta"]
                existing["name"] = item.get("name") or existing.get("name")
        items = sorted(by_ticker.values(), key=lambda item: item["_absDelta"], reverse=True)
        # Buy-side changes are included in full for performance backtests; sell-side stays capped.
        limit = len(items) if category in ("NEW", "ADD") else max_per_category
        for item in items[:limit]:
            item.pop("_absDelta", None)
            changes.append(item)

    changes.sort(key=lambda item: abs(item["marketValueDeltaUsd"]), reverse=True)

    displayed_counts = {cat: 0 for cat in counts}
    for change in changes:
        displayed_counts[change["category"]] += 1

    return changes, counts, displayed_counts


def holdings_deltas_from_comparison(cmp, total_aum: float) -> dict[str, dict[str, Any]]:
    deltas: dict[str, dict[str, Any]] = {}
    if cmp is None or not hasattr(cmp, "data") or cmp.data is None:
        return deltas

    for _, row in cmp.data.iterrows():
        ticker = safe_ticker(row.get("Ticker"))
        if not ticker:
            continue

        share_change = safe_float(row.get("ShareChange"))
        value_change = safe_float(row.get("ValueChange"))
        current_value = safe_float(row.get("Value"))
        prior_value = safe_float(row.get("PrevValue"))
        current_weight = (
            (current_value / total_aum * 100) if total_aum > 0 and current_value > 0 else None
        )
        prior_weight = (prior_value / total_aum * 100) if total_aum > 0 and prior_value > 0 else None
        weight_delta = None
        if current_weight is not None and prior_weight is not None:
            weight_delta = current_weight - prior_weight
        elif current_weight is not None:
            weight_delta = current_weight
        elif prior_weight is not None:
            weight_delta = -prior_weight

        deltas[ticker] = {
            "sharesDelta": safe_int(share_change),
            "marketValueDeltaUsd": json_number(value_change) or 0,
            "weightDeltaPct": json_number(weight_delta),
        }

    return deltas


def apply_holdings_deltas(
    holdings: list[dict[str, Any]], deltas: dict[str, dict[str, Any]]
) -> None:
    for row in holdings:
        delta = deltas.get(row["ticker"])
        if not delta:
            continue
        row["sharesDelta"] = delta["sharesDelta"]
        row["marketValueDeltaUsd"] = delta["marketValueDeltaUsd"]
        row["weightDeltaPct"] = delta["weightDeltaPct"]


def distribution_from_holdings(holdings: list[dict[str, Any]], total_aum: float) -> dict[str, list[dict[str, Any]]]:
    sector_map: dict[str, float] = {}
    for row in holdings:
        sector_map[row["sector"]] = sector_map.get(row["sector"], 0.0) + row["marketValueUsd"]

    by_sector = [
        {
            "key": sector,
            "label": sector,
            "marketValueUsd": value,
            "weightPct": (value / total_aum * 100) if total_aum > 0 else 0.0,
        }
        for sector, value in sorted(sector_map.items(), key=lambda item: item[1], reverse=True)
    ]

    by_stock = [
        {
            "key": row["ticker"],
            "label": row["ticker"],
            "marketValueUsd": row["marketValueUsd"],
            "weightPct": row["portfolioWeightPct"],
        }
        for row in holdings[:12]
    ]

    return {"bySector": by_sector, "byStock": by_stock}


def fetch_bundle(cik: str, quarter: str | None, max_changes_per_category: int) -> dict[str, Any]:
    ensure_identity()
    normalized_cik = resolve_primary_cik(cik)
    if normalized_cik != normalize_cik(cik):
        print(
            f"[thirteenFFetch] CIK redirect {normalize_cik(cik)} -> {normalized_cik}",
            file=sys.stderr,
        )
    company = Company(normalized_cik)

    available_quarters = list_quarter_options(company, limit=8)
    if not available_quarters:
        raise ValueError(f"No 13F filings found for CIK {normalized_cik}")

    resolved = resolve_holdings_filing(company, normalized_cik, quarter)
    current_filing = resolved.hr_filing
    current = current_filing.obj()
    current_quarter = resolved.quarter

    filing_date = str(getattr(current_filing, "filing_date", "") or "")[:10]
    report_date = str(
        getattr(current, "report_date", None)
        or getattr(current, "period_of_report", None)
        or getattr(current_filing, "report_date", "")
        or ""
    )[:10]
    total_aum = safe_float(getattr(current, "total_value", 0) or infotable_total_value(current.infotable))
    sec_company_name = fetch_sec_company_name(normalized_cik)
    institution_name = (
        sec_company_name
        or getattr(current, "management_company_name", None)
        or getattr(current, "manager_name", None)
        or getattr(company, "name", None)
        or normalized_cik
    )
    display_institution_name = sec_company_name or getattr(company, "name", None) or institution_name

    holdings = holdings_from_df(
        current.infotable,
        total_aum,
        normalized_cik,
        current_quarter,
        filing_date,
        report_date,
    )
    distribution = distribution_from_holdings(holdings, total_aum)

    prior_quarter = (
        available_quarters[1]["quarter"] if len(available_quarters) > 1 else current_quarter
    )
    changes: list[dict[str, Any]] = []
    counts = {"NEW": 0, "ADD": 0, "REDUCE": 0, "CLEAR": 0}
    displayed_counts = {"NEW": 0, "ADD": 0, "REDUCE": 0, "CLEAR": 0}

    prior_idx = next(
        (i for i, item in enumerate(available_quarters) if item["quarter"] == current_quarter), 0
    )
    if prior_idx + 1 < len(available_quarters):
        prior_quarter = available_quarters[prior_idx + 1]["quarter"]
        try:
            prior_resolved = resolve_holdings_filing(company, normalized_cik, prior_quarter)
            prior_obj = prior_resolved.hr_filing.obj()
            comparison = current.compare_holdings(prior_obj)
            changes, counts, displayed_counts = changes_from_comparison(
                comparison,
                total_aum,
                normalized_cik,
                current_quarter,
                prior_quarter,
                max_changes_per_category,
            )
            apply_holdings_deltas(
                holdings, holdings_deltas_from_comparison(comparison, total_aum)
            )
        except Exception as exc:
            print(f"[thirteenFFetch] compare_holdings failed for {normalized_cik}: {exc}", file=sys.stderr)

    summary: dict[str, Any] = {
        "cik": normalized_cik,
        "institutionName": display_institution_name,
        "quarter": current_quarter,
        "filingDate": filing_date,
        "reportDate": report_date,
        "totalMarketValueUsd": total_aum,
        "holdingCount": len(holdings),
        "topSector": distribution["bySector"][0]["label"] if distribution["bySector"] else None,
    }
    former_names = fetch_sec_former_names(normalized_cik)
    if former_names:
        summary["formerNames"] = former_names
    if resolved.redirect:
        summary["holdingsSource"] = resolved.redirect

    return {
        "summary": summary,
        "holdings": holdings,
        "distribution": distribution,
        "changes": changes,
        "counts": displayed_counts,
        "totalCounts": counts,
        "displayedCounts": displayed_counts,
        "changesLimitPerCategory": max_changes_per_category,
        "priorQuarter": prior_quarter,
        "availableQuarters": available_quarters,
        "dataSource": "sec-edgar",
    }


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        cik = str(payload.get("cik") or "").strip()
        if not cik:
            raise ValueError("cik is required")
        quarter = payload.get("quarter")
        quarter_str = str(quarter).strip() if quarter else None
        max_changes = int(payload.get("maxChangesPerCategory") or 50)
        result = fetch_bundle(cik, quarter_str, max(1, min(max_changes, 200)))
        json.dump(sanitize_json(result), sys.stdout, ensure_ascii=False)
    except Exception as exc:  # pragma: no cover
        json.dump({"error": str(exc)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)


if __name__ == "__main__":
    main()
