// Stage 3 edit drawer — replaces the legacy reassign-only flow.
//
// Lets the team edit the cohort distribution per company:
//   - Account Manager (writes Companies.profile_manager_email and
//     propagates to every Intervention Assignment owner_email)
//   - Donor / fund_code (writes Companies.fund_code; can also bulk-set
//     on assignments when toggled)
//   - Per-assignment edits: pillar, sub-intervention, donor, budget,
//     plus add / remove rows
//
// All writes are batched: the drawer queues changes locally and emits a
// single onSave({ companyUpdates, assignmentUpdates, newAssignments,
// removedAssignmentIds }) to the parent, which performs the writes in
// the right order and refreshes the dashboard.

import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Badge, Button, Drawer } from '../../lib/ui';
import { ACCOUNT_MANAGERS, displayName } from '../../config/team';
import { PILLARS } from '../../config/interventions';
import type { Company, Assignment } from '../../data/types';

const DONORS = [
  { code: 'Dutch', label: 'Dutch' },
  { code: 'SIDA',  label: 'SIDA' },
  { code: '',      label: '(no donor)' },
];

export type EditPayload = {
  companyId: string;
  companyUpdates: Partial<Company>;
  assignmentUpdates: { id: string; updates: Partial<Assignment> }[];
  newAssignments: Assignment[];
  removedAssignmentIds: string[];
  /** When true, also propagate the new AM/Donor to every assignment. */
  propagateAmToAssignments: boolean;
  propagateDonorToAssignments: boolean;
};

type EditableAsg = {
  data: Assignment;
  localId: string;
  isNew: boolean;
  removed: boolean;
};

let LOCAL_SEQ = 0;
const newLocalId = () => `_new_${++LOCAL_SEQ}`;

type Props = {
  open: boolean;
  onClose: () => void;
  company: Company | null;
  assignments: Assignment[];
  disabled?: boolean;
  disabledReason?: string;
  onSave: (payload: EditPayload) => Promise<void>;
};

export function Stage3EditCompanyDrawer({
  open,
  onClose,
  company,
  assignments,
  disabled,
  disabledReason,
  onSave,
}: Props) {
  const initialAm = (company?.profile_manager_email || '').toLowerCase();
  const initialDonor = (company?.fund_code || '').trim();
  const [amEmail, setAmEmail] = useState<string>(initialAm);
  const [donor, setDonor] = useState<string>(initialDonor);
  const [propagateAm, setPropagateAm] = useState(true);
  const [propagateDonor, setPropagateDonor] = useState(false);
  const [editable, setEditable] = useState<EditableAsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setAmEmail((company?.profile_manager_email || '').toLowerCase());
    setDonor((company?.fund_code || '').trim());
    setPropagateAm(true);
    setPropagateDonor(false);
    setError('');
    setEditable(
      assignments
        .filter(a => a.company_id === company?.company_id)
        .map<EditableAsg>(a => ({
          data: a,
          localId: a.assignment_id || newLocalId(),
          isNew: false,
          removed: false,
        })),
    );
  }, [open, company, assignments]);

  const visible = useMemo(() => editable.filter(a => !a.removed), [editable]);

  if (!company) return null;

  const setRow = (localId: string, patch: Partial<Assignment>) => {
    setEditable(prev => prev.map(a =>
      a.localId === localId ? { ...a, data: { ...a.data, ...patch } } : a,
    ));
  };

  const removeRow = (localId: string) => {
    setEditable(prev => prev.map(a => a.localId === localId ? { ...a, removed: true } : a));
  };

  const addRow = () => {
    const localId = newLocalId();
    const draft: EditableAsg = {
      data: {
        assignment_id: '',
        company_id: company.company_id,
        intervention_type: 'CB',
        sub_intervention: 'Train To Hire',
        fund_code: donor,
        start_date: '',
        end_date: '',
        owner_email: amEmail,
        status: 'Planned',
        budget_usd: '',
        notes: '',
      },
      localId,
      isNew: true,
      removed: false,
    };
    setEditable(prev => [...prev, draft]);
  };

  const handleSave = async () => {
    setBusy(true);
    setError('');

    const companyUpdates: Partial<Company> = {};
    if (amEmail !== initialAm) companyUpdates.profile_manager_email = amEmail;
    if (donor !== initialDonor) companyUpdates.fund_code = donor;

    const assignmentUpdates: { id: string; updates: Partial<Assignment> }[] = [];
    const newAssignments: Assignment[] = [];
    const removedAssignmentIds: string[] = [];

    for (const a of editable) {
      if (a.isNew && !a.removed) {
        const id = `asg-${company.company_id}-${(a.data.sub_intervention || a.data.intervention_type || 'na').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`;
        newAssignments.push({ ...a.data, assignment_id: id, owner_email: amEmail || a.data.owner_email });
        continue;
      }
      if (!a.isNew && a.removed && a.data.assignment_id) {
        removedAssignmentIds.push(a.data.assignment_id);
        continue;
      }
      if (!a.isNew && !a.removed && a.data.assignment_id) {
        const original = assignments.find(x => x.assignment_id === a.data.assignment_id);
        if (!original) continue;
        const updates: Partial<Assignment> = {};
        for (const k of ['intervention_type', 'sub_intervention', 'fund_code', 'budget_usd', 'status', 'notes', 'start_date', 'end_date'] as const) {
          if ((original[k] || '') !== (a.data[k] || '')) updates[k] = a.data[k];
        }
        if (Object.keys(updates).length > 0) {
          assignmentUpdates.push({ id: a.data.assignment_id, updates });
        }
      }
    }

    try {
      await onSave({
        companyId: company.company_id,
        companyUpdates,
        assignmentUpdates,
        newAssignments,
        removedAssignmentIds,
        propagateAmToAssignments: propagateAm && !!companyUpdates.profile_manager_email,
        propagateDonorToAssignments: propagateDonor && !!companyUpdates.fund_code,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const counts = {
    edits: editable.filter(a => !a.isNew && !a.removed && a.data.assignment_id).length,
    added: editable.filter(a => a.isNew && !a.removed).length,
    removed: editable.filter(a => !a.isNew && a.removed).length,
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Edit ${company.company_name}`}
      subtitle={`${visible.length} intervention${visible.length === 1 ? '' : 's'} · ${company.city || ''}`}
      width="max-w-3xl"
      footer={
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {counts.added > 0 && <Badge tone="teal">{counts.added} added</Badge>}{' '}
            {counts.removed > 0 && <Badge tone="red">{counts.removed} removed</Badge>}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={busy || disabled}>
              <Save className="h-4 w-4" /> {busy ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {disabled && disabledReason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {disabledReason}
          </div>
        )}

        {/* AM + Donor */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Account Manager</label>
            <select
              value={amEmail}
              onChange={e => setAmEmail(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-900 dark:text-white"
            >
              <option value="">(unassigned)</option>
              {ACCOUNT_MANAGERS.map(am => (
                <option key={am.email} value={am.email}>{displayName(am.email)}</option>
              ))}
            </select>
            <label className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={propagateAm}
                onChange={e => setPropagateAm(e.target.checked)}
                className="h-3.5 w-3.5 accent-brand-teal"
              />
              Propagate to all interventions
            </label>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">Donor</label>
            <select
              value={donor}
              onChange={e => setDonor(e.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-navy-700 dark:bg-navy-900 dark:text-white"
            >
              {DONORS.map(d => (
                <option key={d.code || 'none'} value={d.code}>{d.label}</option>
              ))}
            </select>
            <label className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={propagateDonor}
                onChange={e => setPropagateDonor(e.target.checked)}
                className="h-3.5 w-3.5 accent-brand-teal"
              />
              Apply donor to all interventions
            </label>
          </div>
        </div>

        {/* Assignments */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-bold text-navy-500 dark:text-white">Interventions</h4>
            <Button variant="ghost" onClick={addRow} disabled={disabled}>
              <Plus className="h-3.5 w-3.5" /> Add intervention
            </Button>
          </div>
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-navy-700">
              No interventions yet. Click "Add intervention" to start.
            </p>
          ) : (
            <ul className="space-y-2">
              {visible.map(a => (
                <li key={a.localId} className="rounded-lg border border-slate-200 p-3 dark:border-navy-700">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_120px_140px_auto]">
                    <select
                      value={a.data.intervention_type}
                      onChange={e => {
                        const next = e.target.value;
                        const pillar = PILLARS.find(p => p.code === next);
                        const firstSub = pillar?.subInterventions[0] ?? '';
                        setRow(a.localId, { intervention_type: next, sub_intervention: firstSub });
                      }}
                      disabled={disabled}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    >
                      {PILLARS.map(p => (
                        <option key={p.code} value={p.code}>{p.label} ({p.code})</option>
                      ))}
                    </select>
                    <select
                      value={a.data.sub_intervention}
                      onChange={e => setRow(a.localId, { sub_intervention: e.target.value })}
                      disabled={disabled}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    >
                      <option value="">(none)</option>
                      {(PILLARS.find(p => p.code === a.data.intervention_type)?.subInterventions ?? []).map(sub => (
                        <option key={sub} value={sub}>{sub}</option>
                      ))}
                    </select>
                    <select
                      value={a.data.fund_code || ''}
                      onChange={e => setRow(a.localId, { fund_code: e.target.value })}
                      disabled={disabled}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    >
                      {DONORS.map(d => (
                        <option key={d.code || 'none'} value={d.code}>{d.label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={a.data.budget_usd || ''}
                      onChange={e => setRow(a.localId, { budget_usd: e.target.value })}
                      placeholder="Budget USD"
                      disabled={disabled}
                      className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-navy-700 dark:bg-navy-900 dark:text-white"
                    />
                    <Button variant="ghost" onClick={() => removeRow(a.localId)} disabled={disabled} title="Remove">
                      <Trash2 className="h-3.5 w-3.5 text-red-500" />
                    </Button>
                  </div>
                  {a.isNew && (
                    <div className="mt-1 text-2xs uppercase tracking-wider text-emerald-600">New</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {error}
          </div>
        )}
      </div>
    </Drawer>
  );
}
