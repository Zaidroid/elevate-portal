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
