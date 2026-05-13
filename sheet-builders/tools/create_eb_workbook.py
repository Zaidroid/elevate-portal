"""One-shot tool: create the ElevateBridge Programme workbook in Drive
and seed it with data from the four ElevateBridge xlsx files.

What it does (in order):
  1. Run the builder to (re)generate sheet-builders/out/E3 - Elevate Bridge Programme.xlsx
  2. Seed it from the four source xlsx files in /Elevate 3.0/ElevateBridge/
  3. Read the portal's .env to find an existing Drive sheet ID (defaults to
     VITE_SHEET_COMPANIES) so we can discover which Drive FOLDER to create
     the new sheet in. Override with --folder-id <id> if you want to target
     a specific folder.
  4. If a sheet with the same name already exists in that folder, REPLACE
     its content (preserves the existing file id and share permissions).
     Otherwise create a fresh Google Sheet in that folder.
  5. Print the new sheet id, formatted as a one-line .env addition.

Usage:
    # From the sheet-builders/ directory
    python3 -m tools.create_eb_workbook
    python3 -m tools.create_eb_workbook --folder-id <DRIVE_FOLDER_ID>
    python3 -m tools.create_eb_workbook --new           # force-create new file
    python3 -m tools.create_eb_workbook --no-seed       # skip seeding step
    python3 -m tools.create_eb_workbook --portal-env /path/to/elevate-portal/.env

Auth: uses Application Default Credentials. Run once:
    gcloud auth application-default login

Scopes required: https://www.googleapis.com/auth/drive
"""

import argparse
import os
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parents[1]
OUT_XLSX_NAME = "E3 - Elevate Bridge Programme.xlsx"
OUT_XLSX_PATH = HERE / "out" / OUT_XLSX_NAME
DEFAULT_PORTAL_ENV = HERE.parent / "elevate-portal" / ".env"  # /Users/.../Zlab/elevate-portal/.env
DEFAULT_FALLBACK_PORTAL_ENV = Path.home() / "Zlab" / "elevate-portal" / ".env"

MIME_XLSX   = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MIME_GSHEET = "application/vnd.google-apps.spreadsheet"

# Env var in portal .env we'll use to discover the parent folder.
DISCOVERY_VARS = [
    "VITE_SHEET_COMPANIES",
    "VITE_SHEET_FREELANCERS",
    "VITE_SHEET_ADVISORS",
    "VITE_SHEET_PROCUREMENT",
]


def _build_service():
    try:
        from google.auth import default
        from googleapiclient.discovery import build
    except ImportError:
        print(
            "Missing Python deps. Install with:\n"
            "  pip3 install google-api-python-client google-auth google-auth-httplib2",
            file=sys.stderr,
        )
        raise SystemExit(1)
    try:
        creds, _ = default(scopes=["https://www.googleapis.com/auth/drive"])
    except Exception as exc:
        print(f"Could not load default credentials: {exc}", file=sys.stderr)
        print("Run: gcloud auth application-default login", file=sys.stderr)
        raise SystemExit(1)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _read_portal_env(portal_env: Path) -> dict:
    """Parse the portal .env file into a {key: value} dict (lenient)."""
    if not portal_env.exists():
        return {}
    out = {}
    for raw in portal_env.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def _discover_folder_id(service, env_values: dict) -> str:
    """Look up the parent folder of an existing portal sheet to find the
    Drive folder where the cohort's workbooks live."""
    for var in DISCOVERY_VARS:
        sheet_id = env_values.get(var, "").strip()
        if not sheet_id:
            continue
        try:
            meta = service.files().get(fileId=sheet_id, fields="id, name, parents").execute()
        except Exception as exc:
            print(f"  [discovery] {var}={sheet_id[:8]}... not accessible: {exc}", file=sys.stderr)
            continue
        parents = meta.get("parents") or []
        if parents:
            folder_id = parents[0]
            print(f"  [discovery] Using folder from {var} ({meta['name'][:40]}): {folder_id}")
            return folder_id
    raise SystemExit(
        "Could not auto-discover the Drive folder. Pass --folder-id <id> explicitly.\n"
        "Tip: open one of the existing workbooks in Drive, copy the parent folder id\n"
        "from the URL (the part after /folders/)."
    )


def _find_existing(service, folder_id: str, sheet_name: str):
    safe = sheet_name.replace("'", "\\'")
    q = (
        f"'{folder_id}' in parents and name = '{safe}' "
        f"and mimeType = '{MIME_GSHEET}' and trashed = false"
    )
    resp = service.files().list(q=q, fields="files(id, name)", pageSize=10).execute()
    files = resp.get("files", [])
    return files[0] if files else None


def _upload(service, folder_id: str, xlsx_path: Path, new: bool):
    from googleapiclient.http import MediaFileUpload

    sheet_name = xlsx_path.stem  # drop .xlsx
    existing = None if new else _find_existing(service, folder_id, sheet_name)
    media = MediaFileUpload(str(xlsx_path), mimetype=MIME_XLSX, resumable=False)

    if existing:
        file = service.files().update(
            fileId=existing["id"],
            media_body=media,
            body={"name": sheet_name},
        ).execute()
        return file["id"], "updated"
    file = service.files().create(
        body={
            "name": sheet_name,
            "parents": [folder_id],
            "mimeType": MIME_GSHEET,
        },
        media_body=media,
        fields="id, name",
    ).execute()
    return file["id"], "created"


def main():
    parser = argparse.ArgumentParser(description="Create + seed the ElevateBridge Programme workbook in Drive")
    parser.add_argument("--folder-id", help="Drive folder id (skips auto-discovery)")
    parser.add_argument("--new", action="store_true", help="Always create a new file; do not update existing")
    parser.add_argument("--no-build", action="store_true", help="Skip the builder step (use existing xlsx)")
    parser.add_argument("--no-seed", action="store_true", help="Skip the seeding step (use empty template)")
    parser.add_argument(
        "--portal-env",
        default=str(DEFAULT_PORTAL_ENV if DEFAULT_PORTAL_ENV.exists() else DEFAULT_FALLBACK_PORTAL_ENV),
        help="Path to the elevate-portal .env (used to auto-discover Drive folder)",
    )
    args = parser.parse_args()

    if not args.no_build:
        print("Step 1: building xlsx template...")
        from builders.elevate_bridge_portal import build as build_template
        build_template()
        print(f"  -> {OUT_XLSX_PATH}")

    if not args.no_seed:
        print("Step 2: seeding from source xlsx files...")
        from migrators.elevate_bridge_seed import run as seed_run
        seed_run()
    else:
        print("Step 2: skipped (--no-seed)")

    if not OUT_XLSX_PATH.exists():
        raise SystemExit(f"Expected {OUT_XLSX_PATH} but it doesn't exist.")

    print("Step 3: connecting to Drive...")
    service = _build_service()

    folder_id = args.folder_id
    if not folder_id:
        env_values = _read_portal_env(Path(args.portal_env))
        if not env_values:
            raise SystemExit(
                f"No portal .env at {args.portal_env}. Pass --folder-id <id> explicitly, "
                f"or use --portal-env to point at the correct .env."
            )
        folder_id = _discover_folder_id(service, env_values)

    print(f"Step 4: uploading to folder {folder_id}...")
    file_id, action = _upload(service, folder_id, OUT_XLSX_PATH, args.new)
    print(f"  -> {action}: file id = {file_id}")
    print()
    print("=" * 70)
    print("Done. Add this line to your portal .env (and Netlify build settings):")
    print()
    print(f"  VITE_SHEET_ELEVATE_BRIDGE={file_id}")
    print()
    print("Then restart `npm run dev` and visit /elevatebridge.")
    print("=" * 70)


if __name__ == "__main__":
    main()
