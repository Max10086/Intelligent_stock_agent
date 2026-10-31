#!/usr/bin/env python3
"""Parse SC 13D / 13G filing HTML for ownership % (Item 5) and Item 4 text.

JSON stdin/stdout for Node.js spawn bridge.
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any

RATE_LIMIT_SEC = 0.12
MAX_DOCUMENT_CHARS = 1_500_000
MAX_ITEM4_CHARS = 12_000


def sec_request_text(url: str, identity: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": identity,
            "Accept": "text/html,application/xhtml+xml,text/plain,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(MAX_DOCUMENT_CHARS + 1)
    if len(raw) > MAX_DOCUMENT_CHARS:
        raw = raw[:MAX_DOCUMENT_CHARS]
    return raw.decode("utf-8", errors="replace")


def strip_html(source: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", source)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</(?:p|div|tr|td|th|li|h\d)>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_section_key(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text.upper()).strip()
    cleaned = cleaned.replace("SCHEDULE ", "SC ")
    return cleaned


def extract_item_section(text: str, item_number: int) -> str | None:
    upper = text.upper()
    start_patterns = [
        rf"\bITEM\s+{item_number}\b",
        rf"\bITEM\s+{item_number}\.",
        rf"\bITEM\s+{item_number}\s*[\.\)]",
    ]
    start = -1
    for pattern in start_patterns:
        match = re.search(pattern, upper)
        if match:
            start = match.start()
            break
    if start < 0:
        return None

    next_item = item_number + 1
    end_patterns = [
        rf"\bITEM\s+{next_item}\b",
        rf"\bITEM\s+{next_item}\.",
        rf"\bSIGNATURE\b",
        rf"\bSIGNATURES\b",
    ]
    end = len(text)
    for pattern in end_patterns:
        match = re.search(pattern, upper[start + 8 :])
        if match:
            end = start + 8 + match.start()
            break

    chunk = text[start:end].strip()
    return chunk[:MAX_ITEM4_CHARS] if chunk else None


def parse_percent_value(raw: str) -> float | None:
    cleaned = raw.strip().replace(",", "")
    if not cleaned:
        return None
    try:
        value = float(cleaned)
    except ValueError:
        return None
    if value < 0 or value > 100:
        return None
    return round(value, 4)


def extract_ownership_pct(text: str) -> float | None:
    patterns = [
        r"(?is)(?:percent(?:age)?\s+of\s+(?:class|outstanding)|percentage\s+of\s+shares)[^\d]{0,80}(\d{1,2}(?:\.\d+)?)\s*%",
        r"(?is)(?:aggregate\s+amount|amount\s+beneficially\s+owned)[^\n]{0,160}(\d{1,2}(?:\.\d+)?)\s*%",
        r"(?is)item\s+5[^\n]{0,400}(\d{1,2}(?:\.\d+)?)\s*%\s*(?:of\s+(?:the\s+)?class|outstanding)",
        r"(?is)(?:representing|represents)\s+approximately\s+(\d{1,2}(?:\.\d+)?)\s*%\s+of",
        r"(\d{1,2}(?:\.\d+)?)\s*%\s+of\s+(?:the\s+)?(?:class|outstanding\s+shares)",
    ]
    candidates: list[float] = []
    for pattern in patterns:
        for match in re.finditer(pattern, text):
            value = parse_percent_value(match.group(1))
            if value is not None and value >= 0.01:
                candidates.append(value)
    if not candidates:
        return None
    # Prefer values in the 5%+ activist range when multiple percentages appear.
    over_five = [value for value in candidates if value >= 5]
    if over_five:
        return max(over_five)
    return max(candidates)


def extract_shares_owned(text: str) -> float | None:
    patterns = [
        r"(?is)(?:aggregate\s+amount\s+beneficially\s+owned)[^\d]{0,40}([\d,]+)\s+shares",
        r"(?is)(?:number\s+of\s+shares)[^\d]{0,40}([\d,]+)",
        r"(?is)beneficially\s+own[s]?\s+([\d,]+)\s+shares",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        digits = match.group(1).replace(",", "")
        try:
            value = float(digits)
        except ValueError:
            continue
        if value > 0:
            return value
    return None


def parse_filing(document_url: str, form_type: str, identity: str, extract_item4: bool) -> dict[str, Any]:
    time.sleep(RATE_LIMIT_SEC)
    try:
        html_source = sec_request_text(document_url, identity)
    except urllib.error.HTTPError as error:
        return {
            "parseStatus": "failed",
            "error": f"HTTP {error.code}",
        }
    except Exception as error:  # noqa: BLE001
        return {
            "parseStatus": "failed",
            "error": str(error),
        }

    text = strip_html(html_source)
    if not text:
        return {
            "parseStatus": "failed",
            "error": "empty document",
        }

    item5 = extract_item_section(text, 5) or text
    ownership_pct = extract_ownership_pct(item5) or extract_ownership_pct(text)
    shares_owned = extract_shares_owned(item5) or extract_shares_owned(text)

    item4_text: str | None = None
    normalized_form = normalize_section_key(form_type)
    if extract_item4 and "13D" in normalized_form:
        item4_text = extract_item_section(text, 4)
        if item4_text:
            item4_text = item4_text[:MAX_ITEM4_CHARS]

    parse_status = "ok" if ownership_pct is not None else "partial"
    if ownership_pct is None and not item4_text:
        parse_status = "failed"

    return {
        "ownershipPct": ownership_pct,
        "sharesOwned": shares_owned,
        "item4Text": item4_text,
        "parseStatus": parse_status,
    }


def main() -> None:
    identity = (os.environ.get("EDGAR_IDENTITY") or "").strip()
    if not identity:
        print(json.dumps({"error": "EDGAR_IDENTITY is not configured"}))
        sys.exit(1)

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        print(json.dumps({"error": f"invalid json input: {error}"}))
        sys.exit(1)

    filings = payload.get("filings") or []
    if not isinstance(filings, list):
        print(json.dumps({"error": "filings must be an array"}))
        sys.exit(1)

    results: list[dict[str, Any]] = []
    for row in filings:
        if not isinstance(row, dict):
            continue
        accession = str(row.get("accessionNumber") or "").strip()
        document_url = str(row.get("documentUrl") or "").strip()
        form_type = str(row.get("formType") or "").strip()
        extract_item4 = bool(row.get("extractItem4"))
        if not accession or not document_url:
            results.append(
                {
                    "accessionNumber": accession or "unknown",
                    "parseStatus": "failed",
                    "error": "missing accessionNumber or documentUrl",
                }
            )
            continue

        parsed = parse_filing(document_url, form_type, identity, extract_item4)
        parsed["accessionNumber"] = accession
        results.append(parsed)

    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main()
