// Canonical intervention taxonomy for GSG Elevate Cohort 3.
//
// Three top-level pillars, each with its own sub-interventions. The
// previous taxonomy (TTH/Upskilling/MKG/MA/EB/C-Suite/Conferences as 7
// peer pillars) was wrong; those are sub-interventions inside the
// proper 3 pillars. `pillarFor()` accepts both new and legacy codes so
// existing reviews + assignments still resolve.

export type Pillar = {
  code: string;
  label: string;
  shortLabel: string;
  color: string;          // Tailwind token for accents (border/bg)
  description: string;
  subInterventions: string[];
};

export const PILLARS: Pillar[] = [
  {
    code: 'CB',
    label: 'Capacity Building',
    shortLabel: 'Capacity',
    color: 'teal',
    description: 'Talent supply for the company — Upskilling existing staff or Train-To-Hire to bring on new hires.',
    subInterventions: ['Upskilling', 'Train To Hire'],
  },
  {
    code: 'MKG',
    label: 'Marketing & Branding',
    shortLabel: 'M&B',
    color: 'red',
    description: 'Brand identity + go-to-market support via a Marketing Agency or Marketing Resources placed inside the company.',
    subInterventions: ['Marketing Agency', 'Marketing Resources'],
  },
  {
    code: 'MA',
    label: 'Market Access',
    shortLabel: 'MA',
    color: 'navy',
    description: 'Helping companies reach new markets — legal/registration (Assessment + 2 tiers), conferences, C-Suite coaching, ElevateBridge sales support.',
    // Legal is a 3-step pipeline: every cohort company starts at "Legal
    // Assessment" (~9 currently) then graduates to Tier 1 OR Tier 2 based
    // on need. Tracking them as separate subs lets the dashboard count
    // each step (and budget allocations are per-tier).
    subInterventions: ['Legal Assessment', 'Legal Tier 1', 'Legal Tier 2', 'Conferences', 'C-Suite', 'ElevateBridge'],
  },
];

export const PILLAR_BY_CODE = Object.fromEntries(PILLARS.map(p => [p.code, p] as const));

// Flat list of every intervention type (pillar codes + sub-intervention codes).
export const INTERVENTION_TYPES: string[] = PILLARS.flatMap(p => [p.code, ...p.subInterventions]);

// Legacy-code → (pillar, sub, optional flavor) migration. Old data in
// Reviews / Intervention Assignments / Pre-decision Recommendations may
// carry the obsolete 7-pillar codes; this maps them so older rows still
// render correctly. The optional `flavor` field captures cases where the
// xlsx allocation distinguishes a sub-flavor inside a single canonical
// sub-intervention (e.g. MA-Technical is a flavor of C-Suite, per Zaid).
const LEGACY: Record<string, { pillar: string; sub: string; flavor?: string }> = {
  // Capacity Building children (formerly top-level pillars)
  'TTH': { pillar: 'CB', sub: 'Train To Hire' },
  'Train To Hire': { pillar: 'CB', sub: 'Train To Hire' },
  'Train-To-Hire': { pillar: 'CB', sub: 'Train To Hire' },
  'CB-TTH': { pillar: 'CB', sub: 'Train To Hire' },
  'Upskilling': { pillar: 'CB', sub: 'Upskilling' },
  'CB-Upskilling': { pillar: 'CB', sub: 'Upskilling' },
  // Marketing & Branding children — old taxonomy had MKG with no subs;
  // also some Israa CSV rows landed under MA-MKG Agency.
  'MA-MKG Agency': { pillar: 'MKG', sub: 'Marketing Agency' },
  'MA-Resource Placement': { pillar: 'MKG', sub: 'Marketing Resources' },
  // Market Access children (formerly top-level pillars)
  'C-Suite': { pillar: 'MA', sub: 'C-Suite' },
  'C-suite': { pillar: 'MA', sub: 'C-Suite' },
  'MA-C-Suite': { pillar: 'MA', sub: 'C-Suite' },
  // MA-Technical is a flavor of C-Suite per Zaid — same canonical sub,
  // but the assignment row carries flavor='Technical' so views can
  // separate it back out (e.g. the Stage 3 sub-intervention spread bar).
  'MA-Technical': { pillar: 'MA', sub: 'C-Suite', flavor: 'Technical' },
  'ElevateBridge': { pillar: 'MA', sub: 'ElevateBridge' },
  'Bridge': { pillar: 'MA', sub: 'ElevateBridge' },
  'MA- Bridge': { pillar: 'MA', sub: 'ElevateBridge' },  // xlsx had trailing space
  'MA-Bridge': { pillar: 'MA', sub: 'ElevateBridge' },
  'Conferences': { pillar: 'MA', sub: 'Conferences' },
  'Conference': { pillar: 'MA', sub: 'Conferences' },
  // Legal — pre-2026 rows used a single 'Legal Support' sub. The team
  // has since split that into a 3-step pipeline (Assessment → Tier 1 OR
  // Tier 2). Old rows resolve to "Legal Assessment" as the entry stage;
  // explicit tier rows resolve to their tier. Keep both spellings in
  // case some sheets use "Legal Tier1" without a space.
  'MA-Legal': { pillar: 'MA', sub: 'Legal Assessment' },
  'Legal': { pillar: 'MA', sub: 'Legal Assessment' },
  'Legal Support': { pillar: 'MA', sub: 'Legal Assessment' },
  'MA-Market Registration': { pillar: 'MA', sub: 'Legal Assessment' },
  'Legal Assessment': { pillar: 'MA', sub: 'Legal Assessment' },
  'Legal Tier 1': { pillar: 'MA', sub: 'Legal Tier 1' },
  'Legal Tier1': { pillar: 'MA', sub: 'Legal Tier 1' },
  'Legal Tier 2': { pillar: 'MA', sub: 'Legal Tier 2' },
  'Legal Tier2': { pillar: 'MA', sub: 'Legal Tier 2' },
};

// Map any intervention type (new code, sub code, OR legacy code) to its
// parent pillar. Returns undefined for genuinely unknown types.
export function pillarFor(type: string): Pillar | undefined {
  if (!type) return undefined;
  const trimmed = type.trim();
  if (PILLAR_BY_CODE[trimmed]) return PILLAR_BY_CODE[trimmed];
  for (const p of PILLARS) if (p.subInterventions.includes(trimmed)) return p;
  const legacy = LEGACY[trimmed];
  if (legacy) return PILLAR_BY_CODE[legacy.pillar];
  console.warn(`[interventions] Unknown intervention type: "${type}"`);
  return undefined;
}

// Resolve a code (new sub, new pillar, OR legacy code) to a canonical
// {pillar, sub} pair, plus an optional `flavor` for cases like
// MA-Technical where the xlsx distinguishes a sub-flavor of an existing
// sub-intervention. Returns null if the code can't be mapped.
export function resolveIntervention(
  code: string,
): { pillar: string; sub: string; flavor?: string } | null {
  if (!code) return null;
  const trimmed = code.trim();
  // New top-level pillar code
  if (PILLAR_BY_CODE[trimmed]) return { pillar: trimmed, sub: '' };
  // New sub-intervention
  for (const p of PILLARS) {
    if (p.subInterventions.includes(trimmed)) return { pillar: p.code, sub: trimmed };
  }
  // Legacy code (may carry a flavor field)
  const legacy = LEGACY[trimmed];
  if (legacy) return { pillar: legacy.pillar, sub: legacy.sub, flavor: legacy.flavor };
  return null;
}

export const CORE_PILLARS: Pillar[] = PILLARS;

// ─── 2026 budget capacity per pillar / sub ───────────────────────────
//
// Numbers come straight from the Logframes workbook's "Program Budget"
// + "Planned Budget Per ActivityDono" tabs (sheet ID
// 107aYeRTV9o4kf3FeYnJzYjDpYCfR3Mu63Hl_FpaGWzk). Update annually when
// donors confirm next year's allocation.
//
// `slots` = number of company slots the budget covers for that
// pillar/sub. `usd` = total planned 2026 spend in USD. Sub-level
// entries roll up into pillar totals; the pillar-level entry is the
// authoritative budget cap shown in LiveInsightsPanel.

export type BudgetEntry = {
  /** Number of company slots budgeted for this pillar/sub. */
  slots: { dutch: number; sida: number };
  /** Planned 2026 USD allocation per donor. */
  usd: { dutch: number; sida: number };
};

export const COHORT3_BUDGET_2026: Record<string, BudgetEntry> = {
  // ── Capacity Building (rolls up TTH + Upskilling) ──
  CB: {
    slots: { dutch: 5, sida: 14 },
    usd: { dutch: 37200, sida: 92200 },
  },
  'Train To Hire': {
    slots: { dutch: 2, sida: 7 },
    usd: { dutch: 25200, sida: 67200 },
  },
  'Upskilling': {
    slots: { dutch: 3, sida: 7 },
    usd: { dutch: 12000, sida: 25000 },
  },

  // ── Marketing & Branding ──
  MKG: {
    slots: { dutch: 2, sida: 5 },
    usd: { dutch: 10000, sida: 25000 },
  },
  'Marketing Agency': {
    slots: { dutch: 1, sida: 3 },
    usd: { dutch: 9000, sida: 21000 },
  },
  'Marketing Resources': {
    slots: { dutch: 1, sida: 2 },
    usd: { dutch: 1000, sida: 4000 },
  },

  // ── Market Access (rolls up Legal + Conferences + C-Suite + ElevateBridge) ──
  MA: {
    slots: { dutch: 6, sida: 10 },
    usd: { dutch: 33600, sida: 42400 },
  },
  // Legal split — placeholder allocation. The team's master plan has
  // 3 Dutch + 3 SIDA legal slots at $18k each side; until the per-tier
  // breakdown is confirmed, split the slots and budget evenly across
  // Assessment + Tier 1 + Tier 2. Adjust here when the team locks in
  // the actual split.
  'Legal Assessment': {
    slots: { dutch: 1, sida: 1 },
    usd: { dutch: 3000, sida: 3000 },
  },
  'Legal Tier 1': {
    slots: { dutch: 1, sida: 1 },
    usd: { dutch: 6000, sida: 6000 },
  },
  'Legal Tier 2': {
    slots: { dutch: 1, sida: 1 },
    usd: { dutch: 9000, sida: 9000 },
  },
  // Legacy bucket kept for backwards compat with anything still
  // reading 'Legal Support'.
  'Legal Support': {
    slots: { dutch: 3, sida: 3 },
    usd: { dutch: 18000, sida: 18000 },
  },
  'Conferences': {
    slots: { dutch: 0, sida: 8 },
    usd: { dutch: 0, sida: 16000 },
  },
  'C-Suite': {
    slots: { dutch: 1, sida: 0 },
    usd: { dutch: 3000, sida: 0 }, // Marketing-and-Sales workshop only
  },
  'ElevateBridge': {
    slots: { dutch: 3, sida: 2 },
    usd: { dutch: 12600, sida: 8400 }, // 5 freelancer slots × $4,200/each over 6 months
  },
};

export const COHORT3_BUDGET_TOTAL_USD = { dutch: 80800, sida: 165600, combined: 246400 };

// ─── Per-sub-intervention "load" weights ─────────────────────────────
//
// Used by Stage 3's per-AM workload view. These reflect the *operational
// effort* an Account Manager has to put in for one engagement of that
// sub-intervention — NOT the budget. Train To Hire is the heaviest:
// month-long candidate sourcing + hiring + first-90-days follow-up.
// Conferences are lightest: a one-off booking / commitment letter.
//
// Tweak these as the team's experience evolves; the dashboard re-reads
// from this config on every render. Anything not listed defaults to 1.
export const SUB_INTERVENTION_LOAD_WEIGHT: Record<string, number> = {
  'Train To Hire':       5,
  'Upskilling':          3,
  'Marketing Agency':    3,
  'Marketing Resources': 2,
  'C-Suite':             2,
  'ElevateBridge':       2,
  // Legal — Assessment is a quick screen (1), Tier 1 is full registration
  // / IP work (3), Tier 2 is bigger overseas / litigation engagements (4).
  'Legal Support':       2, // legacy alias, kept for old rows
  'Legal Assessment':    1,
  'Legal Tier 1':        3,
  'Legal Tier 2':        4,
  'Conferences':         1,
};

export function loadWeightFor(sub: string): number {
  return SUB_INTERVENTION_LOAD_WEIGHT[sub] ?? 1;
}

