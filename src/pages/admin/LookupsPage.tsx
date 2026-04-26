// /admin/lookups — admin-only management of every workbook's Lookups tab.
// Edit dropdown sources without leaving the portal.
//
// Each Lookups tab in our workbooks is a tall sheet: column 1 is the first
// category, column 2 the next, etc. Each column is a single named range that
// drives the corresponding dropdown across data tabs. We model each category
// as a single-column "tall list" and let admins add / rename / delete entries
// inline. Writes go through the standard sheets client.

import { useEffect, useMemo, useState } from 'react';
import { Lock, Plus, RefreshCw, Save, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../services/auth';
import { isAdmin } from '../../config/team';
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from '../../lib/ui';
import { fetchRange, updateRange } from '../../lib/sheets/client';
import { getSheetId } from '../../config/sheets';
import type { ModuleKey } from '../../config/sheets';

type LookupCategory = {
  module: ModuleKey;
  workbookLabel: string;
  tabName: string;       // sheet tab name (e.g. "Lookups")
  columnLetter: string;  // A, B, C, ...
  category: string;      // header value in row 1
  values: string[];
};

const TARGETS: Array<{ module: ModuleKey; tab: string; label: string }> = [
  { module: 'companies', tab: 'Lookups', label: 'E3 - Companies Master' },
  { module: 'procurement', tab: 'Lookups', label: 'E3 - Procurement Plan' },
  { module: 'payments', tab: 'Lookups', label: 'E3 - Payments Tracker' },
  { module: 'conferences', tab: 'Lookups', label: 'E3 - Conferences and Travel' },
  { module: 'docs', tab: 'Lookups', label: 'E3 - Docs and Agreements' },
  { module: 'freelancers', tab: 'Lookups', label: 'E3 - Freelancers (ElevateBridge)' },
  { module: 'advisors', tab: 'Lookups', label: 'E3 - Non-Technical Advisors' },
  { module: 'teamRoster', tab: 'Lookups', label: 'E3 - Team Roster' },
];

export function LookupsPage() {
  const { user } = useAuth();
  const admin = isAdmin(user?.email || '');
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [categories, setCategories] = useState<LookupCategory[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [draft, setDraft] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const result: LookupCategory[] = [];
      for (const t of TARGETS) {
        const sheetId = getSheetId(t.module);
        if (!sheetId) continue;
        try {
          const data = await fetchRange(sheetId, `${t.tab}!A1:Z1000`);
          if (data.length === 0) continue;
          const headers = data[0];
          for (let c = 0; c < headers.length; c++) {
            const cat = (headers[c] || '').trim();
            if (!cat) continue;
            const colLetter = String.fromCharCode(65 + c);
            const values: string[] = [];
            for (let r = 1; r < data.length; r++) {
              const v = (data[r][c] || '').trim();
              if (v) values.push(v);
            }
            result.push({
              module: t.module,
              workbookLabel: t.label,
              tabName: t.tab,
              columnLetter: colLetter,
              category: cat,
              values,
            });
          }
        } catch (err) {
          console.warn(`[lookups] failed to load ${t.module}/${t.tab}`, err);
        }
      }
      setCategories(result);
      if (result.length > 0 && !selected) {
        setSelected(`${result[0].module}::${result[0].category}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (admin) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin]);

  // Identical category names across workbooks are linked: editing them
  // propagates to every workbook that has the same column header.
  const categoriesByName = useMemo(() => {
    const m = new Map<string, LookupCategory[]>();
    for (const c of categories) {
      if (!m.has(c.category)) m.set(c.category, []);
      m.get(c.category)!.push(c);
    }
    return m;
  }, [categories]);

  const selectedCategory = useMemo(() => {
    const [mod, cat] = selected.split('::');
    return categories.find(c => c.module === mod && c.category === cat) || null;
  }, [selected, categories]);

  // Sync draft when selection changes.
  useEffect(() => {
    if (selectedCategory) setDraft([...selectedCategory.values]);
    else setDraft([]);
  }, [selectedCategory]);

  const peers = selectedCategory ? (categoriesByName.get(selectedCategory.category) || []) : [];
  const willPropagate = peers.length > 1;

  const handleSave = async () => {
    if (!selectedCategory) return;
    setSaving(true);
    try {
      const trimmed = draft.map(v => v.trim()).filter(Boolean);
      const targets = peers; // peers includes selectedCategory itself
      let okCount = 0;
      for (const cat of targets) {
        const sheetId = getSheetId(cat.module);
        if (!sheetId) continue;
        const range = `${cat.tabName}!${cat.columnLetter}2:${cat.columnLetter}1000`;
        // Pad with empty strings to overwrite previously-longer columns.
        const maxLen = Math.max(trimmed.length, cat.values.length);
        const values: (string | number | boolean)[][] = [];
        for (let i = 0; i < maxLen; i++) values.push([trimmed[i] || '']);
        try {
          await updateRange(sheetId, range, values, { valueInput: 'RAW' });
          okCount += 1;
        } catch (err) {
          console.error(`[lookups] save failed for ${cat.module}/${cat.category}`, err);
        }
      }
      toast.success(`Saved ${selectedCategory.category} across ${okCount} workbook${okCount === 1 ? '' : 's'}`);
      await loadAll();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!admin) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <EmptyState
            icon={<Lock className="h-7 w-7" />}
            title="Admin only"
            description="Lookups admin lets admins edit dropdown values across all module sheets. Ask Zaid or Israa to change a value, or edit the Lookups tab in the relevant Drive sheet directly."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold text-navy-500 dark:text-white">Lookups admin</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Edit the dropdown values that drive every module. Categories with the same name across
            workbooks (e.g. <code className="rounded bg-slate-100 px-1 text-xs dark:bg-navy-700">intervention_types</code>)
            are kept in sync automatically.
          </p>
        </div>
        <Button variant="ghost" onClick={loadAll}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </header>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader title="Categories" subtitle={`${categories.length} columns across ${TARGETS.length} workbooks`} />
          {categories.length === 0 && !loading && (
            <p className="text-sm text-slate-500">No Lookups columns found. Make sure your sheet IDs are set in env.</p>
          )}
          <ul className="space-y-1">
            {categories.map(c => {
              const id = `${c.module}::${c.category}`;
              const active = id === selected;
              const linked = (categoriesByName.get(c.category)?.length || 1) > 1;
              return (
                <li key={id}>
                  <button
                    onClick={() => setSelected(id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'border-brand-red bg-brand-red/10 text-navy-500 dark:text-white'
                        : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-navy-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">{c.category}</span>
                      {linked && <Badge tone="teal">linked</Badge>}
                    </div>
                    <div className="text-2xs text-slate-500">{c.workbookLabel.replace('E3 - ', '')} · {c.values.length} value{c.values.length === 1 ? '' : 's'}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <div>
          {!selectedCategory && (
            <Card>
              <EmptyState
                icon={<RefreshCw className="h-6 w-6" />}
                title="Pick a category"
                description="Select a lookup category from the left to edit its values."
              />
            </Card>
          )}

          {selectedCategory && (
            <Card>
              <CardHeader
                title={selectedCategory.category}
                subtitle={`${selectedCategory.workbookLabel} · column ${selectedCategory.columnLetter}`}
                action={
                  <Button onClick={handleSave} disabled={saving}>
                    <Save className="h-4 w-4" />
                    {saving ? 'Saving…' : (willPropagate ? `Save (${peers.length} workbooks)` : 'Save')}
                  </Button>
                }
              />

              {willPropagate && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                  This category exists in {peers.length} workbooks: {peers.map(p => p.workbookLabel.replace('E3 - ', '')).join(', ')}.
                  Saving updates all of them.
                </div>
              )}

              <ul className="space-y-1.5">
                {draft.map((v, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-6 text-right font-mono text-2xs text-slate-400">{i + 1}.</span>
                    <input
                      value={v}
                      onChange={e => {
                        const next = [...draft];
                        next[i] = e.target.value;
                        setDraft(next);
                      }}
                      className="flex-1 rounded-lg border border-slate-200 bg-brand-editable/40 px-3 py-1.5 text-sm outline-none focus:border-brand-teal dark:border-navy-700 dark:bg-navy-700 dark:text-white"
                    />
                    <button
                      onClick={() => setDraft(draft.filter((_, j) => j !== i))}
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-brand-red dark:hover:bg-red-950"
                      title="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                variant="ghost"
                onClick={() => setDraft([...draft, ''])}
                className="mt-2"
              >
                <Plus className="h-4 w-4" /> Add value
              </Button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
