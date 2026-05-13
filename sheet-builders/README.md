# Elevate Cohort 3 — Sheet Builders

Programmatic builders that generate the Cohort 3 master Google Sheets with consistent GSG brand formatting, data validation, and formulas.

## Workflow

1. Run a builder (e.g. `python3 -m builders.companies_master`).
2. Output lands in `./out/` as an `.xlsx` file.
3. Review locally, then upload to Google Drive (it auto-converts to Google Sheets format on open) or use `tools/upload_to_drive.py` to push programmatically.

Every builder imports shared style and layout helpers from the `gsg_sheets` package so brand colors, fonts, and editable-cell markings stay consistent across workbooks.

## Brand rules enforced

- Navy header rows, white text, Source Sans Pro where supported.
- User-editable cells filled `#DCE8F4` (blue).
- Red CTAs, Teal links, Orange accents.
- Data validation (dropdowns) driven from a `Lookups` tab in each workbook.
- No em dashes, no emojis anywhere in generated content.

## Structure

```
sheet-builders/
  gsg_sheets/           shared styles, validation helpers, formula helpers
  builders/             one module per master workbook
  migrators/            port existing legacy .xlsx content into new schema
  tools/                drive upload, xlsx diff, schema validator
  out/                  generated xlsx output (gitignored)
```
