// Single source of truth for minting assignment_ids.
//
// Multiple writers create assignments (SelectionPage finalize, Stage 3
// edit drawer, BackfillInterventionsCard, the manual "Assign
// Intervention" drawer on CompanyDetailPage). Without one canonical
// minter, each can choose its own shape — and if two concurrent
// callers produce the same id in the same millisecond, the
// SheetDataProvider's id-based write resolver silently overwrites one
// row's data onto the other.
//
// The pattern:
//   asn-<companyId>-<PILLAR>-<sub>-<timestamp>-<entropy>
//
// PILLAR is upper-case and entropy is a 4-char random tail so two
// browser tabs / two pages / two users can never collide even on the
// same millisecond.

import { resolveIntervention } from '../../config/interventions';

function entropy(): string {
  return Math.random().toString(36).slice(2, 6);
}

function slug(s: string): string {
  return (s || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    || 'x';
}

export function mintAssignmentId(opts: {
  companyId: string;
  intervention_type?: string;
  sub_intervention?: string;
}): string {
  const cid = slug(opts.companyId);
  // Resolve to canonical pillar/sub so the id reflects what the row
  // ACTUALLY represents, not whatever spelling the caller passed.
  const r = resolveIntervention(opts.sub_intervention || opts.intervention_type || '');
  const pillar = (r?.pillar || opts.intervention_type || 'X').toString().toUpperCase().slice(0, 6);
  const sub = slug(r?.sub || opts.sub_intervention || 'all');
  return `asn-${cid}-${pillar}-${sub}-${Date.now()}-${entropy()}`;
}
