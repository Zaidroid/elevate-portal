"""Dump every builder's *_HEADERS constants into one TypeScript file the
portal can use to validate live sheet headers against canonical schemas.

Output: ../elevate-portal/src/data/canonicalHeaders.ts

Usage:
    python3 -m tools.dump_headers_to_ts

The script introspects each Python builder module under builders/, finds
module-level `*_HEADERS` constants (lists of strings), and writes them
keyed by their tab name. Mapping `<HEADERS_CONST>` -> `<module>::<tabKey>`
is hand-maintained here because Python builders don't expose that.

Re-run whenever a builder's headers change. There's no CI step yet — drift
is caught by the Schema Doctor at runtime via the registry comparison.
"""

import importlib
import json
import os
import re
from pathlib import Path


HERE = Path(__file__).resolve().parents[1]
# sheet-builders/ now lives inside the elevate-portal repo, so the
# canonical-headers TS file is one level up.
OUT_TS = HERE.parent / "src" / "data" / "canonicalHeaders.ts"


# Map: (builder module, HEADERS const name) -> portal DataKey 'module::tab'.
# Keep aligned with src/config/sheets.ts.
MAPPING = [
    # Companies workbook
    ("builders.companies_master", "COMPANIES_HEADERS",       "companies::companies"),
    ("builders.companies_master", "CONTACTS_HEADERS",        "companies::contacts"),
    ("builders.companies_master", "ASSIGNMENTS_HEADERS",     "companies::assignments"),
    ("builders.companies_master", "STATUS_LOG_HEADERS",      "companies::statusLog"),
    ("builders.companies_master", "REVIEWS_HEADERS",         "companies::reviews"),
    ("builders.companies_master", "COMMENTS_HEADERS",        "companies::comments"),
    ("builders.companies_master", "ACTIVITY_HEADERS",        "companies::activity"),
    # Payments
    ("builders.payments", "PAYMENTS_HEADERS",                "payments::payments"),
    # Procurement (Q1-Q4 share the same headers)
    ("builders.procurement_plan", "PR_HEADERS",              "procurement::q1"),
    ("builders.procurement_plan", "PR_HEADERS",              "procurement::q2"),
    ("builders.procurement_plan", "PR_HEADERS",              "procurement::q3"),
    ("builders.procurement_plan", "PR_HEADERS",              "procurement::q4"),
    # Conferences
    ("builders.conferences", "CONFERENCES_HEADERS",          "conferences::catalogue"),
    ("builders.conferences", "TRACKER_HEADERS",              "conferences::tracker"),
    # Docs
    ("builders.docs_agreements", "AGREEMENTS_HEADERS",       "docs::agreements"),
    # Advisors
    ("builders.advisors", "ADVISORS_HEADERS",                "advisors::advisors"),
    ("builders.advisors", "FOLLOWUPS_HEADERS",               "advisors::followups"),
    ("builders.advisors", "ACTIVITY_HEADERS",                "advisors::activity"),
    ("builders.advisors", "COMMENTS_HEADERS",                "advisors::comments"),
    # Freelancers (legacy matching pool)
    ("builders.freelancers", "FREELANCERS_HEADERS",          "freelancers::freelancers"),
    ("builders.freelancers", "FOLLOWUPS_HEADERS",            "freelancers::followups"),
    ("builders.freelancers", "ACTIVITY_HEADERS",             "freelancers::activity"),
    ("builders.freelancers", "COMMENTS_HEADERS",             "freelancers::comments"),
    ("builders.freelancers", "TRACK_ASSIGNMENTS_HEADERS",    "freelancers::tracks"),
    ("builders.freelancers", "INCOME_HEADERS",               "freelancers::income"),
    ("builders.freelancers", "ASSESSMENTS_HEADERS",          "freelancers::assessments"),
    # ElevateBridge programme
    ("builders.elevate_bridge_portal", "APPLICANTS_HEADERS",      "elevateBridge::applicants"),
    ("builders.elevate_bridge_portal", "RESPONSES_HEADERS",       "elevateBridge::responses"),
    ("builders.elevate_bridge_portal", "STAGE1_HEADERS",          "elevateBridge::stage1"),
    ("builders.elevate_bridge_portal", "STAGE2_HEADERS",          "elevateBridge::stage2"),
    ("builders.elevate_bridge_portal", "STAGE3_SSI_HEADERS",      "elevateBridge::stage3Ssi"),
    ("builders.elevate_bridge_portal", "STAGE3_RESPONSE_HEADERS", "elevateBridge::stage3Resp"),
    ("builders.elevate_bridge_portal", "INTERVIEW_HEADERS",       "elevateBridge::interviews"),
    ("builders.elevate_bridge_portal", "DECISIONS_HEADERS",       "elevateBridge::decisions"),
    ("builders.elevate_bridge_portal", "RUBRICS_HEADERS",         "elevateBridge::rubrics"),
    ("builders.elevate_bridge_portal", "MENTORS_HEADERS",         "elevateBridge::mentors"),
    ("builders.elevate_bridge_portal", "SESSIONS_HEADERS",        "elevateBridge::sessions"),
    ("builders.elevate_bridge_portal", "ATTENDANCE_HEADERS",      "elevateBridge::attendance"),
    ("builders.elevate_bridge_portal", "TOP_PERFORMERS_HEADERS",  "elevateBridge::topPerformers"),
    ("builders.elevate_bridge_portal", "MATCHES_HEADERS",         "elevateBridge::matches"),
    ("builders.elevate_bridge_portal", "ACTIVITY_HEADERS",        "elevateBridge::activity"),
    # Team roster
    ("builders.team_roster", "ROSTER_HEADERS",               "teamRoster::roster"),
]


def main():
    os.chdir(HERE)  # so `from builders import ...` works
    canonical: dict[str, list[str]] = {}
    missed = []
    for mod_name, const_name, data_key in MAPPING:
        try:
            mod = importlib.import_module(mod_name)
        except Exception as exc:
            missed.append(f"  {data_key}: cannot import {mod_name}: {exc}")
            continue
        if not hasattr(mod, const_name):
            missed.append(f"  {data_key}: {mod_name}.{const_name} not found")
            continue
        headers = getattr(mod, const_name)
        if not isinstance(headers, (list, tuple)):
            missed.append(f"  {data_key}: {mod_name}.{const_name} is {type(headers).__name__}, expected list")
            continue
        canonical[data_key] = list(headers)

    OUT_TS.parent.mkdir(parents=True, exist_ok=True)
    body_entries = []
    for data_key, headers in sorted(canonical.items()):
        cols = ", ".join(json.dumps(h) for h in headers)
        body_entries.append(f"  {json.dumps(data_key)}: [{cols}],")
    body = "\n".join(body_entries)

    ts = f"""// AUTO-GENERATED by sheet-builders/tools/dump_headers_to_ts.py.
// Do not edit by hand. Re-run the dumper whenever a builder's
// *_HEADERS constant changes.
//
// Source of truth: sheet-builders/builders/*.py
// Used by: src/pages/admin/SchemaDoctorPage.tsx (header drift check)

import type {{ DataKey }} from './registry';

export const CANONICAL_HEADERS: Readonly<Record<DataKey, readonly string[]>> = {{
{body}
}} as const;
"""
    OUT_TS.write_text(ts)
    print(f"Wrote {OUT_TS}")
    print(f"  {len(canonical)} canonical header lists captured.")
    if missed:
        print("  Skipped:")
        for line in missed:
            print(line)


if __name__ == "__main__":
    main()
