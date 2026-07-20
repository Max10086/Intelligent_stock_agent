#!/usr/bin/env python3
"""JSON stdin/stdout cninfo periodic report fetcher for Node.js callers.

Minimal self-contained implementation (requests + PyMuPDF) — no external cninfo-cli install required.

Input:
{
  "secCode": "600519",
  "plate": "sh",
  "force": false,
  "fetches": [{"year": 2024, "kind": "annual"}, {"year": 2024, "kind": "q3"}]
}
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    fitz = None

CNINFO_QUERY = "http://www.cninfo.com.cn/new/hisAnnouncement/query"
PDF_BASE = "http://static.cninfo.com.cn/"
ORGID_SEARCH = "http://www.cninfo.com.cn/new/information/topSearch/query"
BEIJING = timezone(timedelta(hours=8))

KIND_TO_CATEGORY = {
    "annual": "category_ndbg_szsh",
    "q1": "category_yjdbg_szsh",
    "h1": "category_bndbg_szsh",
    "q3": "category_sjdbg_szsh",
}

KIND_TO_TITLE_TAIL = {
    "annual": "年年度报告",
    "q1": "年第一季度报告",
    "h1": "年半年度报告",
    "q3": "年第三季度报告",
}

DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15"
    ),
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
}

_NOT_BODY_KW = ("审计报告", "内部控制", "提示性公告", "披露", "鉴证报告")


def cache_root() -> Path:
    raw = os.environ.get("CNINFO_CACHE_DIR", "").strip()
    return Path(raw) if raw else Path.home() / ".cache" / "cninfo"


def guess_plate(sec_code: str) -> str:
    head = sec_code[0]
    if head in ("0", "3"):
        return "sz"
    if head == "6":
        return "sh"
    if head in ("4", "8", "9"):
        return "bj"
    raise ValueError(f"cannot infer plate from sec_code: {sec_code!r}")


def clean_title(raw: str | None) -> str:
    return re.sub(r"</?em>", "", raw or "").strip()


def epoch_ms_to_ann_date(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=BEIJING).strftime("%Y%m%d")


def is_kind_report_body(title: str, year: int, kind: str) -> bool:
    t = clean_title(title)
    if t.endswith("摘要"):
        return False
    if any(kw in t for kw in _NOT_BODY_KW):
        return False
    tail = KIND_TO_TITLE_TAIL.get(kind)
    if not tail:
        return False
    return t.endswith(f"{year}{tail}")


def lookup_orgid(sec_code: str, session: requests.Session) -> str:
    orgid_path = cache_root() / "orgid_map.json"
    orgid_path.parent.mkdir(parents=True, exist_ok=True)
    mapping: dict[str, str] = {}
    if orgid_path.exists():
        try:
            mapping = json.loads(orgid_path.read_text(encoding="utf-8"))
        except Exception:
            mapping = {}
    if sec_code in mapping and mapping[sec_code]:
        return mapping[sec_code]

    resp = session.post(
        ORGID_SEARCH,
        headers=DEFAULT_HEADERS,
        data={"keyWord": sec_code},
        timeout=15,
    )
    resp.raise_for_status()
    payload = resp.json()
    for item in payload if isinstance(payload, list) else []:
        code = str(item.get("code") or item.get("secCode") or "")
        org_id = str(item.get("orgId") or "")
        if code == sec_code and org_id:
            mapping[sec_code] = org_id
            orgid_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
            return org_id
    raise ValueError(f"orgId not found for sec_code={sec_code}")


def query_page(
    *,
    plate: str,
    category: str,
    se_date: str,
    stock: str,
    column: str,
    page_num: int,
    session: requests.Session,
) -> dict:
    body = {
        "tabName": "fulltext",
        "pageSize": "30",
        "pageNum": str(page_num),
        "column": column,
        "category": category,
        "plate": plate,
        "searchkey": "",
        "secid": "",
        "trade": "",
        "seDate": se_date,
        "stock": stock,
        "sortName": "",
        "sortType": "",
        "isHLtitle": "true",
    }
    resp = session.post(CNINFO_QUERY, headers=DEFAULT_HEADERS, data=body, timeout=20)
    resp.raise_for_status()
    return resp.json()


def iter_stock_announcements(
    sec_code: str,
    *,
    since: str,
    until: str,
    plate: str,
    category: str,
    session: requests.Session,
):
    org_id = lookup_orgid(sec_code, session)
    stock = f"{sec_code},{org_id}"
    se_date = f"{since}~{until}"
    column = "szse" if plate in {"sz", "bj"} else "sse"
    page = 1
    while page <= 100:
        payload = query_page(
            plate=plate,
            category=category,
            se_date=se_date,
            stock=stock,
            column=column,
            page_num=page,
            session=session,
        )
        items = payload.get("announcements") or []
        if not items:
            return
        yield from items
        if not payload.get("hasMore"):
            return
        page += 1
        time.sleep(0.35)


def find_periodic_report(sec_code: str, *, year: int, kind: str, plate: str, session: requests.Session):
    windows = {
        "annual": f"{year + 1}-01-01~{year + 1}-05-31",
        "q1": f"{year + 1}-04-01~{year + 1}-05-31",
        "h1": f"{year}-07-01~{year}-09-30",
        "q3": f"{year}-09-01~{year}-11-30",
    }
    since, until = windows[kind].split("~")
    category = KIND_TO_CATEGORY[kind]
    for item in iter_stock_announcements(
        sec_code,
        since=since,
        until=until,
        plate=plate,
        category=category,
        session=session,
    ):
        if item.get("secCode") != sec_code:
            continue
        title = clean_title(item.get("announcementTitle"))
        if is_kind_report_body(title, year, kind):
            return item
    return None


def parse_pdf_bytes(data: bytes) -> tuple[str, int, int]:
    if fitz is None:
        raise RuntimeError("PyMuPDF (pymupdf) is not installed")
    doc = fitz.open(stream=data, filetype="pdf")
    chunks: list[str] = []
    extracted = 0
    for page in doc:
        text = page.get_text("text").strip()
        if text:
            extracted += 1
            chunks.append(text)
    total = doc.page_count
    doc.close()
    return "\n\n".join(chunks).strip(), total, extracted


def cache_paths(ts_code: str, ann_date: str, ann_id: str) -> tuple[Path, Path]:
    root = cache_root()
    pdf = root / "pdf" / ts_code / f"{ann_date}__{ann_id}.pdf"
    md = root / "md" / ts_code / f"{ann_date}__{ann_id}.md"
    pdf.parent.mkdir(parents=True, exist_ok=True)
    md.parent.mkdir(parents=True, exist_ok=True)
    return pdf, md


def to_ts_code(sec_code: str, plate: str) -> str:
    suffix = {"sz": "SZ", "sh": "SH", "bj": "BJ"}[plate]
    return f"{sec_code}.{suffix}"


def read_cached_md(md_path: Path) -> str:
    text = md_path.read_text(encoding="utf-8", errors="replace")
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            return parts[2].strip()
    return text.strip()


@dataclass
class FetchResult:
    title: str
    ann_date: str
    ts_code: str
    text_chars: int
    extracted_pages: int
    cache_hit: bool
    body: str


def fetch_announcement(item: dict, plate: str, *, force: bool, session: requests.Session) -> FetchResult:
    ann_id = str(item.get("announcementId") or "")
    sec_code = str(item.get("secCode") or "")
    ts_ms = int(item.get("announcementTime") or 0)
    ann_date = epoch_ms_to_ann_date(ts_ms) if ts_ms else ""
    title = clean_title(item.get("announcementTitle"))
    ts_code = to_ts_code(sec_code, plate)
    adjunct = str(item.get("adjunctUrl") or "").lstrip("/")
    if not ann_id or not adjunct:
        raise ValueError("announcement missing id or adjunctUrl")

    pdf_path, md_path = cache_paths(ts_code, ann_date, ann_id)
    if not force and pdf_path.exists() and md_path.exists():
        body = read_cached_md(md_path)
        return FetchResult(title, ann_date, ts_code, len(body), 0, True, body)

    pdf_url = PDF_BASE + adjunct
    resp = session.get(pdf_url, headers={"User-Agent": DEFAULT_HEADERS["User-Agent"]}, timeout=60)
    resp.raise_for_status()
    pdf_bytes = resp.content
    body, total_pages, extracted_pages = parse_pdf_bytes(pdf_bytes)

    pdf_path.write_bytes(pdf_bytes)
    frontmatter = (
        "---\n"
        f"ann_id: {ann_id}\n"
        f"ts_code: {ts_code}\n"
        f"sec_code: {sec_code}\n"
        f"ann_date: {ann_date}\n"
        f"title: {title}\n"
        f"source: {pdf_url}\n"
        f"total_pages: {total_pages}\n"
        f"extracted_pages: {extracted_pages}\n"
        f"text_chars: {len(body)}\n"
        "---\n\n"
    )
    md_path.write_text(frontmatter + body, encoding="utf-8")

    return FetchResult(title, ann_date, ts_code, len(body), extracted_pages, False, body)


def fetch_reports(params: dict) -> dict:
    sec_code = str(params.get("secCode") or "").strip()
    if len(sec_code) != 6 or not sec_code.isdigit():
        raise ValueError(f"invalid secCode: {sec_code!r}")

    plate = params.get("plate") or guess_plate(sec_code)
    force = bool(params.get("force"))
    fetches = params.get("fetches") or []
    if not isinstance(fetches, list) or not fetches:
        raise ValueError("fetches must be a non-empty array")

    session = requests.Session()
    reports: list[dict] = []
    errors: list[dict] = []

    for spec in fetches:
        year = int(spec["year"])
        kind = str(spec["kind"])
        try:
            item = find_periodic_report(sec_code, year=year, kind=kind, plate=plate, session=session)
            if item is None:
                errors.append(
                    {
                        "year": year,
                        "kind": kind,
                        "message": f"no {kind} report body found for {sec_code} year={year}",
                    }
                )
                continue
            result = fetch_announcement(item, plate, force=force, session=session)
            reports.append(
                {
                    "year": year,
                    "kind": kind,
                    "title": result.title,
                    "annDate": result.ann_date,
                    "tsCode": result.ts_code,
                    "textChars": result.text_chars,
                    "extractedPages": result.extracted_pages,
                    "cacheHit": result.cache_hit,
                    "body": result.body,
                }
            )
        except Exception as exc:  # noqa: BLE001
            errors.append({"year": year, "kind": kind, "message": str(exc)})

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
