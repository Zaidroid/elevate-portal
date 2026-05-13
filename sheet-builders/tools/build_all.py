"""Regenerate every Cohort 3 workbook in one pass.

Runs all builders, then the migrators that depend on legacy files. Output
lands in sheet-builders/out/. Safe to re-run; overwrites in place.
"""

from builders import (
    advisors,
    companies_master,
    conferences,
    docs_agreements,
    freelancers,
    payments,
    procurement_plan,
    team_roster,
)
from migrators import elevatebridge, logframes, non_technical_advisors, selection_data


STEPS = [
    ("Companies Master", companies_master.build),
    ("Procurement Plan", procurement_plan.build),
    ("Payments Tracker", payments.build),
    ("Conferences and Travel", conferences.build),
    ("Docs and Agreements", docs_agreements.build),
    ("Team Roster", team_roster.build),
    ("Freelancers (template)", freelancers.build),
    ("Non-Technical Advisors (template)", advisors.build),
    ("Freelancers (migrated from legacy)", elevatebridge.run),
    ("Selection Data (migrated)", selection_data.run),
    ("Logframes (consolidated)", logframes.run),
    ("Non-Technical Advisors (migrated)", non_technical_advisors.run),
]


def main():
    results = []
    for label, fn in STEPS:
        try:
            path = fn()
            results.append((label, path, None))
            print(f"OK  {label}: {path}")
        except Exception as exc:
            results.append((label, None, str(exc)))
            print(f"FAIL {label}: {exc}")
    failures = [r for r in results if r[2]]
    print()
    print(f"{len(results) - len(failures)}/{len(results)} workbooks built.")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
