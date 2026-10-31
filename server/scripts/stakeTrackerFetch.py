#!/usr/bin/env python3
"""JSON stdin/stdout SEC SC 13D / 13G stake tracker for Node.js.

Input:
{
  "ciks": ["0001263508", "0001487705"],
  "limitPerInstitution": 25,
  "limit": 100
}

Output: chronological stake filings (newest first).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any

STAKE_FORMS = frozenset({"SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A"})
INITIAL_FORMS = frozenset({"SC 13D", "SC 13G"})
AMENDMENT_FORMS = frozenset({"SC 13D/A", "SC 13G/A"})
RATE_LIMIT_SEC = 0.15

# SEC submissions use both "SC 13D" and "SCHEDULE 13D" style labels for the same forms.
FORM_TYPE_ALIASES: dict[str, str] = {
    "SC 13D": "SC 13D",
    "SC 13D/A": "SC 13D/A",
    "SC 13G": "SC 13G",
    "SC 13G/A": "SC 13G/A",
    "SCHEDULE 13D": "SC 13D",
    "SCHEDULE 13D/A": "SC 13D/A",
    "SCHEDULE 13G": "SC 13G",
    "SCHEDULE 13G/A": "SC 13G/A",
    "13D": "SC 13D",
    "13D/A": "SC 13D/A",
    "13G": "SC 13G",
    "13G/A": "SC 13G/A",
}

CIK_REDIRECTS: dict[str, str] = {
    "0001006438": "0001656456",
    "0001420793": "0001649339",
    "0001277006": "0001512920",
}


def normalize_cik(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        raise ValueError(f"invalid cik: {raw!r}")
    return digits.zfill(10)


def resolve_cik(cik: str) -> str:
    normalized = normalize_cik(cik)
    return CIK_REDIRECTS.get(normalized, normalized)


def sec_request(url: str, identity: str) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": identity, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def filing_document_url(accession: str, primary_document: str, subject_cik: str | None) -> str:
    accession_compact = accession.replace("-", "")
    if subject_cik and primary_document:
        subject_digits = re.sub(r"\D", "", subject_cik).lstrip("0") or "0"
        return (
            f"https://www.sec.gov/Archives/edgar/data/{subject_digits}/"
            f"{accession_compact}/{primary_document}"
        )
    return edgar_browse_url(accession)


def edgar_browse_url(accession: str) -> str:
    accession_compact = accession.replace("-", "")
    return f"https://www.sec.gov/cgi-bin/viewer?action=view&accession_number={accession_compact}&xbrl_type=v"


def classify_major_event(form_type: str) -> str:
    if form_type in INITIAL_FORMS:
        return "NEW_5PCT_STAKE"
    if form_type in AMENDMENT_FORMS:
        return "POSITION_CHANGE"
    return "OTHER"


def normalize_stake_form_type(form_type: str) -> str | None:
    cleaned = str(form_type or "").strip().upper()
    if not cleaned:
        return None
    if cleaned in FORM_TYPE_ALIASES:
        return FORM_TYPE_ALIASES[cleaned]
    if cleaned.startswith("SCHEDULE 13"):
        return FORM_TYPE_ALIASES.get(cleaned.replace("SCHEDULE ", "SC ", 1), FORM_TYPE_ALIASES.get(cleaned))
    return None


def parse_subject_from_efts(accession: str, identity: str) -> tuple[str | None, str | None]:
    url = f"https://efts.sec.gov/LATEST/search-index?q=%22{accession.replace('-', '')}%22"
    try:
        payload = sec_request(url, identity)
    except Exception:
        return None, None

    hits = payload.get("hits", {}).get("hits") or []
    if not hits:
        return None, None

    source = hits[0].get("_source") or {}
    display_names = source.get("display_names") or []
    ciks = source.get("ciks") or []

    if not display_names:
        return None, None

    target_name = re.sub(r"\s*\(CIK[^)]+\)\s*", "", str(display_names[0])).strip() or None
    target_cik = normalize_cik(str(ciks[0])) if ciks else None
    return target_name, target_cik


def enrich_target_company(
    accession: str,
    primary_document: str,
    identity: str,
    cache: dict[str, tuple[str | None, str | None]],
) -> tuple[str | None, str | None]:
    if accession in cache:
        return cache[accession]

    name, cik = parse_subject_from_efts(accession, identity)
    cache[accession] = (name, cik)
    return name, cik


def filings_for_cik(
    cik: str,
    identity: str,
    limit_per_institution: int,
    target_cache: dict[str, tuple[str | None, str | None]],
) -> list[dict[str, Any]]:
    normalized = resolve_cik(cik)
    url = f"https://data.sec.gov/submissions/CIK{normalized}.json"
    time.sleep(RATE_LIMIT_SEC)
    try:
        payload = sec_request(url, identity)
    except urllib.error.HTTPError as exc:
        print(f"[stakeTracker] submissions failed for {normalized}: HTTP {exc.code}", file=sys.stderr)
        return []
    except Exception as exc:
        print(f"[stakeTracker] submissions failed for {normalized}: {exc}", file=sys.stderr)
        return []

    institution_name = str(payload.get("name") or normalized).strip()
    recent = payload.get("filings", {}).get("recent") or {}
    forms = recent.get("form") or []
    filing_dates = recent.get("filingDate") or []
    accession_numbers = recent.get("accessionNumber") or []
    primary_documents = recent.get("primaryDocument") or []
    file_numbers = recent.get("fileNumber") or []

    rows: list[dict[str, Any]] = []
    for index, raw_form_type in enumerate(forms):
        normalized_form = normalize_stake_form_type(raw_form_type)
        if not normalized_form:
            continue
        if len(rows) >= limit_per_institution:
            break

        accession = str(accession_numbers[index] if index < len(accession_numbers) else "")
        filing_date = str(filing_dates[index] if index < len(filing_dates) else "")
        primary_document = str(primary_documents[index] if index < len(primary_documents) else "")
        file_number = str(file_numbers[index] if index < len(file_numbers) else "")

        if not accession or not filing_date:
            continue

        target_name, target_cik = enrich_target_company(
            accession, primary_document, identity, target_cache
        )
        time.sleep(RATE_LIMIT_SEC)

        document_url = filing_document_url(accession, primary_document, target_cik)

        rows.append(
            {
                "id": f"{normalized}-{accession}",
                "filerCik": normalized,
                "filerName": institution_name,
                "formType": normalized_form,
                "rawFormType": raw_form_type,
                "filingDate": filing_date,
                "accessionNumber": accession,
                "fileNumber": file_number or None,
                "targetCompanyName": target_name,
                "targetCompanyCik": target_cik,
                "documentUrl": document_url,
                "isMajorEvent": classify_major_event(normalized_form),
            }
        )

    return rows


def fetch_stake_feed(
    ciks: list[str],
    limit_per_institution: int = 25,
    limit: int = 100,
) -> dict[str, Any]:
    identity = os.environ.get("EDGAR_IDENTITY", "").strip()
    if not identity:
        raise ValueError("EDGAR_IDENTITY is required (SEC mandates a contact email/name)")

    unique_ciks: list[str] = []
    seen: set[str] = set()
    for raw in ciks:
        resolved = resolve_cik(raw)
        if resolved not in seen:
            seen.add(resolved)
            unique_ciks.append(resolved)

    target_cache: dict[str, tuple[str | None, str | None]] = {}
    all_rows: list[dict[str, Any]] = []
    for cik in unique_ciks:
        all_rows.extend(
            filings_for_cik(cik, identity, limit_per_institution, target_cache)
        )

    all_rows.sort(key=lambda row: row.get("filingDate") or "", reverse=True)
    trimmed = all_rows[: max(1, limit)]

    return {
        "filings": trimmed,
        "totalCount": len(all_rows),
        "institutionCount": len(unique_ciks),
        "dataSource": "sec-edgar-submissions",
    }


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        ciks = payload.get("ciks") or []
        if not isinstance(ciks, list) or len(ciks) == 0:
            raise ValueError("ciks array is required")
        limit_per_institution = int(payload.get("limitPerInstitution") or 25)
        limit = int(payload.get("limit") or 100)
        result = fetch_stake_feed(
            [str(cik) for cik in ciks],
            max(1, min(limit_per_institution, 50)),
            max(1, min(limit, 200)),
        )
        json.dump(result, sys.stdout, ensure_ascii=False)
    except Exception as exc:  # pragma: no cover
        json.dump({"error": str(exc)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)


if __name__ == "__main__":
    main()
