"""One-shot: build the canonical Companies Master template, seed it
from local Drive exports, and (optionally) upload to Drive as a new
sheet.

Pipeline:
  1. Run the canonical builder.
  2. Run the operational seeder (reads inputs/*.xlsx).
  3. Upload to a target Drive folder, converting xlsx → Google Sheets.
  4. Print the new sheet id formatted for .env.

Auth (only required for the upload step): `gcloud auth application-default
login` with Drive scope. If auth or the upload step fails, the seeded
xlsx is still produced — you can upload it manually via Drive's File >
Import > Replace spreadsheet.

Usage:
    python3 -m tools.create_cohort3_master                 # build + seed only
    python3 -m tools.create_cohort3_master --upload --folder-id <FOLDER>
    python3 -m tools.create_cohort3_master --upload        # auto-discover folder
"""

import argparse
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parents[1]
OUT_XLSX = HERE / "out" / "E3 - Companies Master.xlsx"

MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MIME_GSHEET = "application/vnd.google-apps.spreadsheet"

DEFAULT_PORTAL_ENV = HERE.parent.parent / "elevate-portal" / ".env"

# Sheet IDs we'll query to auto-discover the cohort's Drive folder.
DISCOVERY_VARS = [
    "VITE_SHEET_COMPANIES",
    "VITE_SHEET_FREELANCERS",
    "VITE_SHEET_ADVISORS",
]


def main():
    parser = argparse.ArgumentParser(description="Build + seed + upload the fresh Cohort 3 Companies Master")
    parser.add_argument("--upload", action="store_true", help="Upload the seeded xlsx to Drive")
    parser.add_argument("--folder-id", help="Drive folder id (skips auto-discovery)")
    parser.add_argument("--new", action="store_true", help="Always create a new file; do not update an existing one with the same name")
    parser.add_argument("--portal-env", default=str(DEFAULT_PORTAL_ENV), help="Path to elevate-portal/.env for folder auto-discovery")
    parser.add_argument("--skip-seed", action="store_true", help="Build canonical template only; skip the operational seeder")
    args = parser.parse_args()

    print("Step 1: building canonical Companies Master template...")
    from builders.companies_master import build as build_template
    build_template()
    print(f"  -> {OUT_XLSX}")

    if not args.skip_seed:
        print("Step 2: running operational seeder...")
        from migrators.cohort3_operational_seed import run as seed_run
        seed_run()
    else:
        print("Step 2: skipped (--skip-seed)")

    if not args.upload:
        print()
        print("=" * 70)
        print("Build complete. Re-run with --upload to push to Drive, or import")
        print(f"manually: open the existing Drive Companies sheet, File > Import,")
        print(f"upload {OUT_XLSX}, choose 'Replace spreadsheet'.")
        print("=" * 70)
        return

    print("Step 3: uploading to Drive...")
    file_id = _upload_to_drive(args)
    print()
    print("=" * 70)
    print("Upload complete. Update your .env (and Netlify build settings):")
    print()
    print(f"  VITE_SHEET_COMPANIES={file_id}")
    print()
    print("Then restart `npm run dev`, open /admin/schema, confirm all tabs")
    print("are green, then smoke-test 10 random company profiles.")
    print("=" * 70)


def _build_service():
    try:
        from google.auth import default
        from googleapiclient.discovery import build
    except ImportError:
        print("Missing deps. Install: pip3 install google-api-python-client google-auth google-auth-httplib2", file=sys.stderr)
        sys.exit(1)
    try:
        creds, _ = default(scopes=["https://www.googleapis.com/auth/drive"])
    except Exception as exc:
        print(f"Could not load default credentials: {exc}", file=sys.stderr)
        print("Run: gcloud auth application-default login --scopes=openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/drive", file=sys.stderr)
        sys.exit(1)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _read_env(path: Path) -> dict:
    if not path.exists():
        return {}
    out = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def _discover_folder(service, env: dict) -> str:
    for var in DISCOVERY_VARS:
        sid = env.get(var, "").strip()
        if not sid:
            continue
        try:
            meta = service.files().get(fileId=sid, fields="id, name, parents").execute()
        except Exception as exc:
            print(f"  [discovery] {var}={sid[:8]}... not accessible: {exc}", file=sys.stderr)
            continue
        parents = meta.get("parents") or []
        if parents:
            print(f"  [discovery] Using folder from {var} ({meta['name'][:40]}): {parents[0]}")
            return parents[0]
    raise SystemExit("Could not auto-discover Drive folder. Pass --folder-id <id>.")


def _upload_to_drive(args) -> str:
    from googleapiclient.http import MediaFileUpload
    service = _build_service()

    folder_id = args.folder_id
    if not folder_id:
        env = _read_env(Path(args.portal_env))
        folder_id = _discover_folder(service, env)

    sheet_name = OUT_XLSX.stem  # "E3 - Companies Master"
    media = MediaFileUpload(str(OUT_XLSX), mimetype=MIME_XLSX, resumable=False)

    # Find existing (same name + folder + Google Sheet).
    existing = None
    if not args.new:
        safe = sheet_name.replace("'", "\\'")
        q = f"'{folder_id}' in parents and name = '{safe}' and mimeType = '{MIME_GSHEET}' and trashed = false"
        resp = service.files().list(q=q, fields="files(id, name)", pageSize=5).execute()
        files = resp.get("files", [])
        existing = files[0] if files else None

    if existing:
        print(f"  -> updating existing sheet {existing['id']}")
        file = service.files().update(
            fileId=existing["id"],
            media_body=media,
            body={"name": sheet_name},
        ).execute()
    else:
        print(f"  -> creating new sheet in folder {folder_id}")
        file = service.files().create(
            body={"name": sheet_name, "parents": [folder_id], "mimeType": MIME_GSHEET},
            media_body=media,
            fields="id, name",
        ).execute()

    return file["id"]


if __name__ == "__main__":
    main()
