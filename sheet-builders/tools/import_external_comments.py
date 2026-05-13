"""Parse Israa's voting CSV + Raouf's notes docx into a JSON seed the portal
can consume to populate the Companies workbook's `Company Comments` tab and
a new `Pre-decision Recommendations` tab before tomorrow's final-selection
session.

Output: writes `elevate-portal/public/external-comments-seed.json` with two
arrays:
  - `comments`: [{ company_match, author_email, body, source }]
  - `recommendations`: [{ company_match, author_email, pillar, sub, fund_hint, note, source }]

The portal's `importExternalComments.ts` action reads this JSON, fuzzy-
matches each `company_match` against the live Companies Master + the
static interviewed list, and upserts comment + recommendation rows.

Run: python -m sheet_builders.tools.import_external_comments
or:  python sheet-builders/tools/import_external_comments.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
import zipfile
from pathlib import Path
from typing import Optional


# Inputs (downloaded copies on Zaid's machine).
ISRAA_CSV = Path("/Users/zaidsalem/Downloads/Elevate 2026 Voting.csv")
RAOUF_DOCX = Path("/Users/zaidsalem/Downloads/Notes Companies.docx")

# Output goes into the portal's public/ so it ships as a static asset.
OUTPUT_JSON = Path("/Users/zaidsalem/Zlab/elevate-portal/public/external-comments-seed.json")

ISRAA_EMAIL = "israa@gazaskygeeks.com"
RAOUF_EMAIL = "raouf@gazaskygeeks.com"


# ---------- Pillar mapping ---------------------------------------------

# Israa's CSV uses informal column labels. Map each to the canonical
# pillar code used everywhere else in the system. None means: this column
# captures something other than a single pillar (e.g., budget estimate).
ISRAA_COLUMN_TO_PILLAR: dict[str, Optional[str]] = {
    "CB-TTH": "TTH",
    "CB-Upskilling": "Upskilling",
    "Talent Recovery": "TTH",          # Recovery is a TTH variant
    "MKG": "MKG",
    "Legal": "MA",                     # MA-Legal sub-intervention
    "Technical": "Upskilling",         # Israa uses "Technical" for upskilling-tech
    "C-Suite": "C-Suite",
    "Bridge": "ElevateBridge",
    "Conference": "Conferences",
}

# Sub-intervention hints for the pillars that have them.
ISRAA_COLUMN_TO_SUB: dict[str, Optional[str]] = {
    "Legal": "MA-Legal",
}


# Raouf's narrative tends to use these phrases — when we see them in a
# section we add a corresponding Pre-decision Recommendation row. Order
# matters: most specific phrases first.
RAOUF_PHRASE_TO_PILLAR: list[tuple[re.Pattern, str, Optional[str]]] = [
    (re.compile(r"train.to.hire|TTH", re.I), "TTH", None),
    (re.compile(r"upskill", re.I), "Upskilling", None),
    (re.compile(r"market(?:ing)?\s*(?:&|and)\s*branding|m\s*&\s*b\b|MKG", re.I), "MKG", None),
    (re.compile(r"market\s+access|MA-Bridge|MA[-/\s]?Bridge|market\s+expansion", re.I), "MA", None),
    (re.compile(r"legal\s+registration|registration\s+in\s+(jordan|ksa|saudi)", re.I), "MA", "MA-Legal"),
    (re.compile(r"c-?suite|domain\s+coaching|coaching", re.I), "C-Suite", None),
    (re.compile(r"conference|biban", re.I), "Conferences", None),
    (re.compile(r"elevate\s*bridge|bridge", re.I), "ElevateBridge", None),
]


# ---------- Israa CSV parser -------------------------------------------

def parse_israa_csv(path: Path):
    """Returns (comments, recommendations).

    Each Israa row becomes one comment + one recommendation per picked
    pillar. Cells of value 'Y' / 'WL' / non-empty count as picked; 'N'
    or empty are skipped. The 'Note' and 'Estimate Budget' cells are
    folded into the comment body."""
    if not path.exists():
        print(f"WARN: Israa CSV not found at {path}", file=sys.stderr)
        return [], []

    comments = []
    recs = []
    with path.open("r", encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)
    if not rows:
        return comments, recs

    header = [h.strip() for h in rows[0]]
    pillar_columns = [c for c in header if c in ISRAA_COLUMN_TO_PILLAR]

    # Find the column indexes for Note + Estimate Budget. Note can be
    # in column 10 or in the trailing free-text column 14 if Israa
    # filled the budget elsewhere.
    name_col = 0
    note_col = next((i for i, h in enumerate(header) if h.strip().lower() == "note"), None)
    budget_col = next((i for i, h in enumerate(header) if "estimate" in h.lower() and "budget" in h.lower()), None)

    for r in rows[1:]:
        if not r or not r[name_col].strip():
            continue
        name = r[name_col].strip()
        # Skip rows where the name is a placeholder (Arabic question marks
        # in the source mean the company name didn't survive the encoding;
        # those rows can't be matched to anything).
        if not re.search(r"[A-Za-z0-9]", name):
            continue

        picked: list[tuple[str, Optional[str]]] = []  # (pillar, sub)
        for col_label, pillar in ISRAA_COLUMN_TO_PILLAR.items():
            if pillar is None:
                continue
            try:
                idx = header.index(col_label)
            except ValueError:
                continue
            if idx >= len(r):
                continue
            val = r[idx].strip().upper()
            if val and val not in ("N", "NO"):
                # 'Y', 'WL' (waitlist), or any non-empty truthy mark.
                sub = ISRAA_COLUMN_TO_SUB.get(col_label)
                # Capture the WL marker so the portal can show it.
                marker = "Waitlist" if val == "WL" else "Recommended"
                picked.append((pillar, sub))
                recs.append({
                    "company_match": name,
                    "author_email": ISRAA_EMAIL,
                    "pillar": pillar,
                    "sub": sub or "",
                    "fund_hint": "",
                    "note": f"{marker} ({col_label})",
                    "source": "israa-csv",
                })

        note_text = r[note_col].strip() if (note_col is not None and note_col < len(r)) else ""
        budget_text = r[budget_col].strip() if (budget_col is not None and budget_col < len(r)) else ""
        # Trailing free-text columns sometimes carry the actual note.
        trailing = " ".join(c.strip() for c in r[max(note_col or 0, 0) + 1:] if c.strip())
        if not note_text and trailing:
            note_text = trailing

        body_lines = []
        if picked:
            picked_labels = ", ".join(
                f"{p}{f' ({s})' if s else ''}" for p, s in picked
            )
            body_lines.append(f"Vote: {picked_labels}")
        if note_text:
            body_lines.append(f"Note: {note_text}")
        if budget_text:
            body_lines.append(f"Estimated budget: {budget_text}")
        if not body_lines:
            continue

        comments.append({
            "company_match": name,
            "author_email": ISRAA_EMAIL,
            "body": "\n".join(body_lines),
            "source": "israa-csv",
        })

    return comments, recs


# ---------- Raouf docx parser ------------------------------------------

def _docx_paragraphs(path: Path) -> list[str]:
    """Extract paragraphs from a .docx, preserving paragraph boundaries."""
    if not path.exists():
        print(f"WARN: Raouf docx not found at {path}", file=sys.stderr)
        return []
    out: list[str] = []
    with zipfile.ZipFile(path, "r") as z:
        try:
            xml = z.read("word/document.xml").decode("utf-8")
        except KeyError:
            return []
    # Walk the XML, accumulating <w:t> text and emitting on </w:p>.
    buf = ""
    i = 0
    while i < len(xml):
        m = re.search(r"<w:t[^>]*>([^<]*)</w:t>", xml[i:])
        p = re.search(r"</w:p>", xml[i:])
        if m is None and p is None:
            break
        if m and (p is None or m.start() < p.start()):
            buf += m.group(1)
            i += m.end()
        else:
            out.append(buf)
            buf = ""
            i += p.end()
    if buf:
        out.append(buf)
    # HTML-decode common entities.
    out = [
        s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
        for s in out
    ]
    return out


def _looks_like_company_heading(line: str) -> bool:
    """A heading line is short, has letters, no trailing colon, no digits.

    Matches Raouf's pattern in 'Notes Companies.docx': company names sit
    on their own line, then the body follows."""
    s = line.strip()
    if not s or len(s) > 35:
        return False
    if s.endswith(":"):
        return False
    if any(c.isdigit() for c in s):
        return False
    # Must contain a letter and not be a sub-bullet.
    if not re.search(r"[A-Za-z]", s):
        return False
    # Sub-bullet noise: lines starting with lowercase or beginning with bullets.
    if s[0].islower():
        return False
    # Avoid common non-company short lines from Raouf's content.
    NOISE = {
        "consulting", "national bank", "aziza", "cartoon factory",
        "saudi arabia", "qatar", "europe", "content creation", "branding support",
        "project management", "market access / expansion", "marketing & branding",
        "enterprise sector", "sme sector", "furniture factories/companies",
        "upskilling", "train-to-hire (tth)", "big data product", "erp saas product",
        "market access", "legal registration", "business and accounting",
        "mechanical engineering", "project-based clients", "yearly contract-based clients",
        "istishari hospital group", "it and digital transformation",
        "africa (especially angola)",
    }
    if s.lower() in NOISE:
        return False
    return True


def parse_raouf_docx(path: Path):
    """Returns (comments, recommendations).

    Each company-section becomes one comment authored as Raouf with the
    full narrative body. We also scan the body for known phrases and emit
    Pre-decision Recommendations rows."""
    paragraphs = _docx_paragraphs(path)
    comments = []
    recs = []
    if not paragraphs:
        return comments, recs

    # Walk paragraphs, accumulate body until we hit the next heading.
    sections: list[tuple[str, list[str]]] = []  # (heading, body_lines)
    current_heading: Optional[str] = None
    current_body: list[str] = []
    for line in paragraphs:
        if _looks_like_company_heading(line):
            if current_heading and current_body:
                sections.append((current_heading.strip(), current_body))
            current_heading = line.strip()
            current_body = []
        else:
            if current_heading is not None:
                current_body.append(line)
    if current_heading and current_body:
        sections.append((current_heading.strip(), current_body))

    for heading, body in sections:
        body_text = "\n".join(b for b in body if b.strip())
        if not body_text:
            continue
        comments.append({
            "company_match": heading,
            "author_email": RAOUF_EMAIL,
            "body": body_text,
            "source": "raouf-docx",
        })
        # Phrase-based recommendation extraction. Dedupe per (pillar, sub).
        seen: set[tuple[str, Optional[str]]] = set()
        for rx, pillar, sub in RAOUF_PHRASE_TO_PILLAR:
            if rx.search(body_text):
                key = (pillar, sub)
                if key in seen:
                    continue
                seen.add(key)
                recs.append({
                    "company_match": heading,
                    "author_email": RAOUF_EMAIL,
                    "pillar": pillar,
                    "sub": sub or "",
                    "fund_hint": "",
                    "note": f"Inferred from notes: matched '{rx.pattern[:40]}…'",
                    "source": "raouf-docx",
                })
    return comments, recs


# ---------- Main -------------------------------------------------------

def main():
    israa_comments, israa_recs = parse_israa_csv(ISRAA_CSV)
    raouf_comments, raouf_recs = parse_raouf_docx(RAOUF_DOCX)

    OUTPUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "comments": israa_comments + raouf_comments,
        "recommendations": israa_recs + raouf_recs,
        "stats": {
            "israa_comments": len(israa_comments),
            "raouf_comments": len(raouf_comments),
            "israa_recs": len(israa_recs),
            "raouf_recs": len(raouf_recs),
        },
    }
    OUTPUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUTPUT_JSON}")
    print(f"  Comments: {len(payload['comments'])}  (Israa {len(israa_comments)} + Raouf {len(raouf_comments)})")
    print(f"  Recommendations: {len(payload['recommendations'])}  (Israa {len(israa_recs)} + Raouf {len(raouf_recs)})")


if __name__ == "__main__":
    main()
