// Import external comments + pre-decision recommendations into the
// Companies workbook so they're available for tomorrow's final
// selection session. Sources: Israa's voting CSV + Raouf's notes docx.
//
// The seed JSON is produced by
//   sheet-builders/tools/import_external_comments.py
// and shipped as /external-comments-seed.json (a static asset). This
// module fetches it, fuzzy-matches each entry to a live company in the
// portal's joined view, and upserts:
//   - one row in `Company Comments` per (company, author, source)
//   - one row in `Pre-decision Recommendations` per
//     (company, author, pillar, sub, source)
// Both writes are idempotent — re-running adds nothing for entries
// that already exist on the sheet.

import { aliasIdFor } from '../companies/reviewTypes';
import type { CompanyComment, PreDecisionRecommendation } from '../companies/reviewTypes';
import { preDecisionIdFor } from '../companies/reviewTypes';

export type SeedComment = {
  company_match: string;
  author_email: string;
  body: string;
  source: string;
};

export type SeedRecommendation = {
  company_match: string;
  author_email: string;
  pillar: string;
  sub: string;
  fund_hint: string;
  note: string;
  source: string;
};

export type SeedPayload = {
  comments: SeedComment[];
  recommendations: SeedRecommendation[];
  stats?: Record<string, number>;
};

export type ImportInputs = {
  // Lookup: try to resolve a free-text company name to a real
  // company_id + canonical name on the master/applicants index.
  // Returns null when no plausible match exists.
  resolve: (rawName: string) => { company_id: string; company_name: string } | null;

  // Existing rows so we can dedupe.
  existingComments: CompanyComment[];
  existingRecs: PreDecisionRecommendation[];

  // CRUD adapters bound to the right sheet doc.
  createComment: (row: CompanyComment) => Promise<void>;
  createRecommendation: (row: PreDecisionRecommendation) => Promise<void>;
};

export type ImportResult = {
  commentsAdded: number;
  commentsSkipped: number;
  commentsUnmatched: string[];          // company_match values that didn't resolve
  recsAdded: number;
  recsSkipped: number;
  recsUnmatched: string[];
  errors: string[];
};

// Normalise a free-text name for fuzzy comparison.
export function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Loose contains-match against a candidate set; returns the first
// matching candidate or null. Required for Israa's informal short names
// ('Tayf', 'AI Pilot', 'Pollaris') vs the canonical
// ('Taif', 'Aipilot', 'Polaris').
export function fuzzyResolve(rawName: string, candidates: Array<{ company_id: string; company_name: string }>): { company_id: string; company_name: string } | null {
  const target = normName(rawName);
  if (!target) return null;
  // Exact normalised match.
  for (const c of candidates) if (normName(c.company_name) === target) return c;
  // Substring fallback — accept either direction; require >= 4 chars to avoid 'me' matching everything.
  for (const c of candidates) {
    const n = normName(c.company_name);
    if (n.length < 4 || target.length < 4) continue;
    if (n.includes(target) || target.includes(n)) return c;
  }
  // Character-overlap heuristic for spelling drift like 'Pollaris' vs 'Polaris'.
  const targetTokens = target.split(' ').filter(t => t.length >= 4);
  for (const c of candidates) {
    const n = normName(c.company_name);
    const tokens = n.split(' ').filter(t => t.length >= 4);
    for (const tt of targetTokens) {
      for (const ct of tokens) {
        if (tt === ct) return c;
        if (tt.length >= 5 && ct.length >= 5 && (tt.startsWith(ct) || ct.startsWith(tt))) return c;
      }
    }
  }
  return null;
}

export async function loadSeed(): Promise<SeedPayload | null> {
  try {
    const res = await fetch('/external-comments-seed.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as SeedPayload;
  } catch {
    return null;
  }
}

// Stable id for a seeded comment so re-runs don't add duplicates.
export function seedCommentIdFor(companyId: string, author: string, source: string): string {
  return ['cmt-seed', companyId, author, source]
    .map(s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .join('-')
    .slice(0, 100);
}

// Hash a comment body to detect content changes between seed runs. We
// don't want to re-add the comment when content matches; if Israa
// tweaks her CSV we DO want to update.
function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 8);
}

export async function importExternalSeed(seed: SeedPayload, inputs: ImportInputs): Promise<ImportResult> {
  const result: ImportResult = {
    commentsAdded: 0,
    commentsSkipped: 0,
    commentsUnmatched: [],
    recsAdded: 0,
    recsSkipped: 0,
    recsUnmatched: [],
    errors: [],
  };

  const now = new Date().toISOString();

  // --- Comments ---
  const seenComment = new Set<string>(inputs.existingComments.map(c => c.comment_id));
  for (const c of seed.comments) {
    const match = inputs.resolve(c.company_match);
    if (!match) {
      result.commentsUnmatched.push(c.company_match);
      continue;
    }
    const id = `${seedCommentIdFor(match.company_id, c.author_email, c.source)}-${shortHash(c.body)}`;
    if (seenComment.has(id)) {
      result.commentsSkipped += 1;
      continue;
    }
    try {
      await inputs.createComment({
        comment_id: id,
        company_id: match.company_id,
        author_email: c.author_email,
        body: c.body,
        created_at: now,
        updated_at: now,
      });
      seenComment.add(id);
      result.commentsAdded += 1;
    } catch (err) {
      result.errors.push(`comment for ${match.company_name}: ${(err as Error).message}`);
    }
  }

  // --- Recommendations ---
  const seenRec = new Set<string>(inputs.existingRecs.map(r => r.recommendation_id));
  for (const r of seed.recommendations) {
    const match = inputs.resolve(r.company_match);
    if (!match) {
      result.recsUnmatched.push(r.company_match);
      continue;
    }
    const id = preDecisionIdFor(match.company_id, r.author_email, r.pillar, r.sub, r.source);
    if (seenRec.has(id)) {
      result.recsSkipped += 1;
      continue;
    }
    try {
      await inputs.createRecommendation({
        recommendation_id: id,
        company_id: match.company_id,
        company_name: match.company_name,
        author_email: r.author_email,
        pillar: r.pillar,
        sub_intervention: r.sub,
        fund_hint: r.fund_hint,
        note: r.note,
        source: r.source,
        created_at: now,
      });
      seenRec.add(id);
      result.recsAdded += 1;
    } catch (err) {
      result.errors.push(`rec for ${match.company_name} (${r.pillar}): ${(err as Error).message}`);
    }
  }

  return result;
}

// Helper kept exported for completeness (not used internally).
export { aliasIdFor };
