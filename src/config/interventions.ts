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
    description: 'Helping companies reach new markets — legal/registration, conferences, C-Suite coaching, ElevateBridge sales support.',
    subInterventions: ['Legal Support', 'Conferences', 'C-Suite', 'ElevateBridge'],
  },
];

export const PILLAR_BY_CODE = Object.fromEntries(PILLARS.map(p => [p.code, p] as const));

// Flat list of every intervention type (pillar codes + sub-intervention codes).
export const INTERVENTION_TYPES: string[] = PILLARS.flatMap(p => [p.code, ...p.subInterventions]);

// Legacy-code → (pillar, sub) migration. Old data in Reviews / Intervention
// Assignments / Pre-decision Recommendations may carry the obsolete
// 7-pillar codes; this maps them so older rows still render correctly.
const LEGACY: Record<string, { pillar: string; sub: string }> = {
  // Capacity Building children (formerly top-level pillars)
  'TTH': { pillar: 'CB', sub: 'Train To Hire' },
  'Train To Hire': { pillar: 'CB', sub: 'Train To Hire' },
  'Train-To-Hire': { pillar: 'CB', sub: 'Train To Hire' },
  'Upskilling': { pillar: 'CB', sub: 'Upskilling' },
  // Marketing & Branding children — old taxonomy had MKG with no subs;
  // also some Israa CSV rows landed under MA-MKG Agency.
  'MA-MKG Agency': { pillar: 'MKG', sub: 'Marketing Agency' },
  'MA-Resource Placement': { pillar: 'MKG', sub: 'Marketing Resources' },
  // Market Access children (formerly top-level pillars)
  'C-Suite': { pillar: 'MA', sub: 'C-Suite' },
  'C-suite': { pillar: 'MA', sub: 'C-Suite' },
  'ElevateBridge': { pillar: 'MA', sub: 'ElevateBridge' },
  'Bridge': { pillar: 'MA', sub: 'ElevateBridge' },
  'Conferences': { pillar: 'MA', sub: 'Conferences' },
  'Conference': { pillar: 'MA', sub: 'Conferences' },
  'MA-Legal': { pillar: 'MA', sub: 'Legal Support' },
  'Legal': { pillar: 'MA', sub: 'Legal Support' },
  'MA-Market Registration': { pillar: 'MA', sub: 'Legal Support' },
};

// Map any intervention type (new code, sub code, OR legacy code) to its
// parent pillar. Returns undefined for genuinely unknown types.
export function pillarFor(type: string): Pillar | undefined {
  if (!type) return undefined;
  if (PILLAR_BY_CODE[type]) return PILLAR_BY_CODE[type];
  for (const p of PILLARS) if (p.subInterventions.includes(type)) return p;
  const legacy = LEGACY[type];
  if (legacy) return PILLAR_BY_CODE[legacy.pillar];
  console.warn(`[interventions] Unknown intervention type: "${type}"`);
  return undefined;
}

// Resolve a code (new sub, new pillar, OR legacy code) to a canonical
// {pillar, sub} pair. Returns null if the code can't be mapped.
export function resolveIntervention(code: string): { pillar: string; sub: string } | null {
  if (!code) return null;
  // New top-level pillar code
  if (PILLAR_BY_CODE[code]) return { pillar: code, sub: '' };
  // New sub-intervention
  for (const p of PILLARS) {
    if (p.subInterventions.includes(code)) return { pillar: p.code, sub: code };
  }
  // Legacy code
  const legacy = LEGACY[code];
  if (legacy) return legacy;
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
  'Legal Support': {
    slots: { dutch: 3, sida: 3 },
    usd: { dutch: 18000, sida: 18000 }, // 3 registrations + Legal Firm + Local Legal Advisors
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

