// Canonical intervention taxonomy for GSG Elevate Cohort 3.
// The four program pillars are weighted equally in the UI, with sub-interventions
// hanging off each pillar rather than inflating Market Access with many siblings.

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
    code: 'TTH',
    label: 'Tech Talent Hub',
    shortLabel: 'TTH',
    color: 'teal',
    description: 'Placement of tech talent into Elevate companies.',
    subInterventions: [],
  },
  {
    code: 'Upskilling',
    label: 'Upskilling',
    shortLabel: 'Upskill',
    color: 'orange',
    description: 'Targeted training for existing company staff.',
    subInterventions: [],
  },
  {
    code: 'MKG',
    label: 'Market and Branding',
    shortLabel: 'M&B',
    color: 'red',
    description: 'Brand identity, marketing collateral, content pipelines.',
    subInterventions: [],
  },
  {
    code: 'MA',
    label: 'Market Access',
    shortLabel: 'MA',
    color: 'navy',
    description: 'Entry into new markets, freelancer pipelines, legal.',
    subInterventions: [
      'MA-ElevateBridge',
      'MA-Market Registration',
      'MA-MKG Agency',
      'MA-Resource Placement',
      'MA-Legal',
    ],
  },
  {
    code: 'C-Suite',
    label: 'C-Suite Coaching',
    shortLabel: 'CB',
    color: 'teal',
    description: 'Domain expert coaching for C-level leaders.',
    subInterventions: [],
  },
  {
    code: 'Conferences',
    label: 'Conferences',
    shortLabel: 'Conf',
    color: 'orange',
    description: 'International conference attendance and Commitment Letters.',
    subInterventions: [],
  },
];

export const PILLAR_BY_CODE = Object.fromEntries(PILLARS.map(p => [p.code, p] as const));

// Flat list of every intervention type (pillar codes + sub-intervention codes),
// suitable for dropdowns and filtering.
export const INTERVENTION_TYPES: string[] = PILLARS.flatMap(p => [p.code, ...p.subInterventions]);

// Map any intervention type back to its parent pillar.
export function pillarFor(type: string): Pillar | undefined {
  if (!type) return undefined;
  if (PILLAR_BY_CODE[type]) return PILLAR_BY_CODE[type];
  return PILLARS.find(p => p.subInterventions.includes(type));
}

// Default presence array for the 4 core pillars — used to render balanced cards
// on CompanyDetailPage so TTH/Upskill/M&B/MA each get equal real estate.
export const CORE_PILLARS: Pillar[] = PILLARS.filter(p =>
  ['TTH', 'Upskilling', 'MKG', 'MA'].includes(p.code)
);
