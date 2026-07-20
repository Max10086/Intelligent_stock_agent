#!/usr/bin/env python3
"""JSON stdin/stdout SEC EDGAR fetcher for Node.js callers (edgartools).

Input:
{
  "ticker": "AAPL",
  "force": false,
  "fetches": [{"form": "10-K"}, {"form": "10-Q"}]
}
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

try:
    from edgar import Company, set_identity
except ImportError:  # pragma: no cover
    Company = None  # type: ignore
    set_identity = None  # type: ignore


def cache_root() -> Path:
    raw = os.environ.get("EDGAR_CACHE_DIR", "").strip()
    return Path(raw) if raw else Path.home() / ".cache" / "edgar"


def ensure_identity() -> None:
    identity = os.environ.get("EDGAR_IDENTITY", "").strip()
    if not identity:
        raise ValueError("EDGAR_IDENTITY is required (SEC mandates a contact email/name)")
    if set_identity is None:
        raise RuntimeError("edgartools is not installed — run: pip install -r requirements-edgar.txt")
    set_identity(identity)


def normalize_ticker(raw: str) -> str:
    ticker = (raw or "").strip().upper().split(".")[0]
    if not ticker or not ticker.replace("-", "").isalnum():
        raise ValueError(f"invalid ticker: {raw!r}")
    return ticker


def statement_to_text(stmt) -> str:
    if stmt is None:
        return ""
    for attr in ("to_dataframe", "render", "to_string"):
        fn = getattr(stmt, attr, None)
        if callable(fn):
            try:
                if attr == "to_dataframe":
                    df = fn()
                    return df.to_string(max_rows=40)
                if attr == "to_string":
                    return fn(max_rows=40)
                rendered = fn()
                return str(rendered)
            except Exception:
                continue
    return str(stmt)


def append_financials(parts: list[str], financials) -> None:
    if financials is None:
        return
    for label, accessor in (
        ("Income Statement", "income_statement"),
        ("Balance Sheet", "balance_sheet"),
        ("Cash Flow Statement", "cashflow_statement"),
    ):
        try:
            fn = getattr(financials, accessor, None)
            if not callable(fn):
                continue
            stmt = fn()
            text = statement_to_text(stmt).strip()
            if text:
                parts.append(f"## {label}\n{text}")
        except Exception:
            continue


def build_body_from_filing(filing) -> str:
    parts: list[str] = []
    form = str(getattr(filing, "form", "") or "")

    try:
        obj = filing.obj()
    except Exception:
        obj = None

    if obj is not None:
        if form == "10-K":
            business = getattr(obj, "business", "") or ""
            if business.strip():
                parts.append(f"## Item 1 Business\n{business.strip()}")
            risk = getattr(obj, "risk_factors", "") or ""
            if risk.strip():
                parts.append(f"## Item 1A Risk Factors\n{risk.strip()}")
            mda = getattr(obj, "management_discussion", "") or ""
            if not mda.strip():
                try:
                    mda = str(obj["7"])
                except Exception:
                    mda = ""
            if mda.strip():
                parts.append(f"## Item 7 MD&A\n{mda.strip()}")
        elif form == "10-Q":
            try:
                mda = str(obj["2"])
                if mda.strip():
                    parts.append(f"## Part I Item 2 MD&A\n{mda.strip()}")
            except Exception:
                pass
        elif form == "20-F":
            for key, heading in (
                ("1", "Item 1 Identity of Directors"),
                ("4", "Item 4 Information on the Company"),
                ("5", "Item 5 Operating and Financial Review"),
            ):
                try:
                    chunk = str(obj[key]).strip()
                    if chunk:
                        parts.append(f"## {heading}\n{chunk}")
                except Exception:
                    continue

        append_financials(parts, getattr(obj, "financials", None))

    if not parts:
        try:
            text = filing.text() or ""
        except Exception:
            text = ""
        if text.strip():
            parts.append(text.strip())

    return "\n\n".join(parts).strip()


def cache_paths(ticker: str, form: str, filing_date: str, accession: str) -> tuple[Path, Path]:
    root = cache_root() / ticker.upper()
    root.mkdir(parents=True, exist_ok=True)
    safe_accession = accession.replace("/", "-")
    md = root / f"{form}__{filing_date}__{safe_accession}.md"
    meta = root / f"{form}__{filing_date}__{safe_accession}.meta.json"
    return md, meta


def read_cached(md_path: Path, meta_path: Path) -> tuple[str, dict] | None:
    if not md_path.exists() or not meta_path.exists():
        return None
    try:
        body = md_path.read_text(encoding="utf-8", errors="replace").strip()
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        return body, meta
    except Exception:
        return None


def write_cache(md_path: Path, meta_path: Path, body: str, meta: dict) -> None:
    md_path.write_text(body, encoding="utf-8")
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def infer_fiscal_period(filing) -> str:
    for attr in ("period_of_report", "report_date", "fiscal_period"):
        value = getattr(filing, attr, None)
        if value:
            return str(value)
    return ""


def fetch_one(company: Company, ticker: str, form: str, *, force: bool) -> dict:
    filings = company.get_filings(form=form)
    filing = filings.latest()
    if filing is None:
        raise ValueError(f"no {form} filing found")

    filing_date = str(getattr(filing, "filing_date", "") or "")
    accession = str(getattr(filing, "accession_number", "") or getattr(filing, "accession_no", "") or "")
    title = str(getattr(filing, "company", "") or getattr(filing, "description", "") or f"{form} filing")
    fiscal_period = infer_fiscal_period(filing)
    ticker = normalize_ticker(ticker)

    md_path, meta_path = cache_paths(ticker, form, filing_date, accession or "unknown")
    if not force:
        cached = read_cached(md_path, meta_path)
        if cached:
            body, meta = cached
            return {
                "form": form,
                "title": meta.get("title", title),
                "filingDate": meta.get("filingDate", filing_date),
                "accessionNumber": meta.get("accessionNumber", accession),
                "fiscalPeriod": meta.get("fiscalPeriod", fiscal_period),
                "textChars": len(body),
                "cacheHit": True,
                "body": body,
            }

    body = build_body_from_filing(filing)
    if not body:
        raise ValueError(f"{form} filing parsed to empty body")

    meta = {
        "form": form,
        "title": title,
        "filingDate": filing_date,
        "accessionNumber": accession,
        "fiscalPeriod": fiscal_period,
        "textChars": len(body),
    }
    write_cache(md_path, meta_path, body, meta)

    return {
        "form": form,
        "title": title,
        "filingDate": filing_date,
        "accessionNumber": accession,
        "fiscalPeriod": fiscal_period,
        "textChars": len(body),
        "cacheHit": False,
        "body": body,
    }


def fetch_reports(params: dict) -> dict:
    ensure_identity()
    ticker = normalize_ticker(str(params.get("ticker") or ""))
    force = bool(params.get("force"))
    fetches = params.get("fetches") or []
    if not isinstance(fetches, list) or not fetches:
        raise ValueError("fetches must be a non-empty array")

    company = Company(ticker)
    reports: list[dict] = []
    errors: list[dict] = []

    for spec in fetches:
        form = str(spec.get("form") or "").strip().upper()
        if form not in {"10-K", "10-Q", "20-F"}:
            errors.append({"form": form or "?", "message": f"unsupported form: {form!r}"})
            continue
        try:
            reports.append(fetch_one(company, ticker, form, force=force))
        except Exception as exc:  # noqa: BLE001
            errors.append({"form": form, "message": str(exc)})

    # If no 10-K, try 20-F (foreign issuers / ADRs)
    if not any(r["form"] == "10-K" for r in reports):
        has_10k_error = any(e["form"] == "10-K" for e in errors)
        if has_10k_error and not any(r["form"] == "20-F" for r in reports):
            try:
                reports.append(fetch_one(company, ticker, "20-F", force=force))
            except Exception as exc:  # noqa: BLE001
                errors.append({"form": "20-F", "message": str(exc)})

    return {"reports": reports, "errors": errors}


def main() -> int:
    try:
        raw = sys.stdin.read()
        params = json.loads(raw) if raw.strip() else {}
        payload = fetch_reports(params)
        json.dump(payload, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:  # noqa: BLE001
        json.dump({"error": str(exc), "reports": [], "errors": []}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
