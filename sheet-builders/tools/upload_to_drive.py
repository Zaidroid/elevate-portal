"""Push the generated xlsx files to a Google Drive folder, converting each to
a Google Sheets document on upload.

Usage:
    python3 -m tools.upload_to_drive --folder-id <DRIVE_FOLDER_ID>

Auth: uses Application Default Credentials. Run `gcloud auth application-default
login` once with the correct scopes, or set GOOGLE_APPLICATION_CREDENTIALS to a
service account JSON with Drive access. Scopes required:
  https://www.googleapis.com/auth/drive.file
  https://www.googleapis.com/auth/drive

The tool is idempotent: if a Sheet with the same name exists in the target
folder, it REPLACES the content by uploading a new revision (preserving the
existing fileId and share permissions). Pass --new to force a new file.
"""

import argparse
import os
import sys
from pathlib import Path


OUT_DIR = Path(__file__).resolve().parents[1] / "out"

MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MIME_GSHEET = "application/vnd.google-apps.spreadsheet"


def _build_service():
    try:
        from google.auth import default
        from googleapiclient.discovery import build
    except ImportError:
        print(
            "Missing dependencies. Install with:\n"
            "  pip install google-api-python-client google-auth google-auth-httplib2",
            file=sys.stderr,
        )
        raise SystemExit(1)

    creds, _ = default(scopes=["https://www.googleapis.com/auth/drive"])
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _find_existing(service, folder_id: str, name: str):
    # Query strips the .xlsx extension because uploaded Sheets names do not
    # include it.
    sheet_name = name[:-5] if name.lower().endswith(".xlsx") else name
    q = (
        f"'{folder_id}' in parents and name = '{sheet_name}' "
        f"and mimeType = '{MIME_GSHEET}' and trashed = false"
    )
    resp = service.files().list(q=q, fields="files(id, name)", pageSize=10).execute()
    files = resp.get("files", [])
    return files[0] if files else None


def _upload(service, folder_id: str, xlsx_path: Path, new: bool):
    from googleapiclient.http import MediaFileUpload

    sheet_name = xlsx_path.stem  # drop .xlsx
    existing = None if new else _find_existing(service, folder_id, xlsx_path.name)

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
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder-id", required=True, help="Drive folder id to upload into")
    parser.add_argument("--new", action="store_true", help="Always create new files; do not update existing")
    parser.add_argument("--only", help="Comma-separated filename stems to include (e.g. 'E3 - Companies Master')")
    args = parser.parse_args()

    service = _build_service()
    only = set(s.strip() for s in args.only.split(",")) if args.only else None

    files = sorted(OUT_DIR.glob("*.xlsx"))
    if not files:
        print(f"No xlsx files in {OUT_DIR}. Run tools/build_all.py first.", file=sys.stderr)
        raise SystemExit(1)

    for xlsx in files:
        stem = xlsx.stem
        if only and stem not in only:
            continue
        try:
            file_id, action = _upload(service, args.folder_id, xlsx, args.new)
            print(f"{action:>8}: {stem:40s}  id={file_id}")
        except Exception as exc:
            print(f"   FAIL: {stem}: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
