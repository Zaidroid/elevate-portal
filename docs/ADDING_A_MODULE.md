# Adding a new module or tab

The portal reads and writes Google Sheets via a centralised data layer (one batched poll per workbook every 2 minutes). Adding a new module or tab is safe **only if every step below is completed**. Skipping any one of them produces a silent failure — the kind that wiped Contacts off every company profile in May 2026.

The Schema Doctor at `/admin/schema` (admin-only) will flag any drift introduced by half-finished wiring.

## Checklist

### 1. Declare the tab in `src/config/sheets.ts`

Pick a module key (existing or new). Add the tab name as it appears in Google Sheets.

```ts
companies: {
  // ...
  tabs: {
    // ...
    contacts: 'Contacts',         // <— logical key : actual sheet tab name
  },
},
```

### 2. Register the ID column in `src/data/registry.ts`

Every tab MUST have an `ID_COLUMNS` entry — even read-only ones. Without it, `updateRow()` silently fails (no column to locate the row by) and the Schema Doctor lights up amber.

```ts
const ID_COLUMNS: Record<string, string> = {
  // ...
  'companies::contacts': 'contact_id',
};
```

### 3. Add canonical headers to the Python builder

`/Users/zaidsalem/Zlab/Elevate 3.0/sheet-builders/builders/<module>.py` is the source of truth for column order, dropdowns, conditional formatting, and brand styling. Add or update the `*_HEADERS` constant for the new tab.

```python
CONTACTS_HEADERS = [
    "contact_id",
    "company_id",
    "full_name",
    # ...
]
```

### 4. Refresh canonical headers in the portal

```sh
cd /Users/zaidsalem/Zlab/Elevate\ 3.0/sheet-builders
python3 -m tools.dump_headers_to_ts
```

This regenerates `src/data/canonicalHeaders.ts`, which the Schema Doctor uses to detect column drift in the live sheet.

### 5. Add TypeScript types

`src/types/<module>.ts` or `src/data/types.ts` — every row's shape. Must include the ID column.

```ts
export type Contact = {
  contact_id: string;
  company_id: string;
  full_name: string;
  // ...
};
```

### 6. Read via `useModuleData`

```ts
const contacts = useModuleData<Contact>('companies', 'contacts');
// contacts.rows · contacts.headers · contacts.loading · contacts.error
// contacts.updateRow(id, updates) · contacts.createRow(row) · contacts.deleteRow(id)
```

Never call `useSheetDoc` (deleted) or open the workbook directly with `lib/sheets/client.ts` from a page — those bypass the central batched poller and burn quota.

### 7. Mint stable IDs before any write

If your new tab supports `createRow`, every new row must carry the ID column **before** the write. Blank IDs are refused at the SheetDataProvider layer (the May 2026 fix that prevented one company's edit from overwriting another's row).

```ts
const id = `CONTACT-${Date.now()}`;
await contacts.createRow({ contact_id: id, company_id: cid, /* ... */ });
```

### 8. Verify

1. `npm run lint && npm run build` — clean.
2. Open `/admin/schema` as an admin. Find your new module/tab — three traffic lights:
   - **Registry**: green = entry exists in registry.ts.
   - **Headers**: green = sheet headers match the canonical list. Amber = sheet has extra columns (usually fine). Red = canonical columns missing.
   - **Intervention taxonomy**: irrelevant unless the tab carries intervention_type / sub_intervention values.
3. Make a test write from the UI. If you get "ID column 'X' not found in headers", step 2 or 3 is wrong.

## Background: why each step matters

| Step skipped | What breaks |
|---|---|
| 1 | Tab unknown to the portal. `useModuleData` throws or returns empty. |
| 2 | Reads work (falls back to `idColumn:'id'`), but writes fail with a header-validation error. Schema Doctor flags it. |
| 3 | Production sheet has whatever ad-hoc headers the team typed. Future onboarding rebuilds drift from current state. |
| 4 | Canonical headers in `canonicalHeaders.ts` are stale; Schema Doctor reports false drift on subsequent runs. |
| 5 | Row objects are stringly-typed; consumers crash on `.toFixed()` etc. |
| 6 | Independent poll loop burns quota; cache is bypassed. |
| 7 | Blank-ID rows can overwrite siblings on update. |

## Removing a tab

Reverse the checklist:
1. Delete the `useModuleData` call sites.
2. Delete the registry entry.
3. Delete from `sheets.ts`.
4. Delete the canonical header entry (re-run the dumper).
5. Keep the Python builder so an old workbook can still be opened — only remove if every workbook in production has dropped the tab.

Leave the tab in the live Google Sheet for at least one quarter; the portal won't read it but the team can still inspect it.
