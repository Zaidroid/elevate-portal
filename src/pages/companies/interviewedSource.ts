// Static list of Cohort 3 companies that have an interview scheduled or
// completed. Source: the team's Phase 1–4 interview schedule (West Bank +
// Gaza, April 2026). Pasted in from the team's tracker rather than fetched
// from Drive because the upstream file is an .xlsx (not a native Sheet) and
// the Sheets API rejects those with FAILED_PRECONDITION. The list is small,
// rarely changes, and overriding the master sheet's status to "Interviewed"
// is the only thing the portal needs from it.
//
// To update: just edit the array below and ship a new build.

const RAW_NAMES: string[] = [
  // Phase 1 — West Bank (Online), 6 + 3 companies
  'TechnoGeeks',
  'Bashar Al-Bakri & Partners for Marketing and Technological Solutions',
  'Aipilot',
  'Mobile Telephone System - MTSC',
  'Kidify',
  'HSD – Himam Software Development',
  'IzTechValley',
  'ASAL Technologies',
  'Enbat',

  // Phase 2 — West Bank Old, all online
  'Hesabate',
  'Dotline Marketing and Advertising Agency',
  'National Cyber Security Company',
  'OFFTEC Palestine',
  'Radix Technologies',
  'ULTIMIT Advanced Turnkey Solutions',
  'PITS',
  'Aeliasoft',
  'Orion VLSI Technologies',
  'Pillars For Development and Technology Investment',
  'SAFEDENY for Secure Technologies',
  'Sada Intelligence',
  'Tech 360',
  'Scope Systems',
  'Olivery',
  'Top Mena Talents for Programming and Information Technology',
  'Business Alliance for Services and Investment',
  'Digify Company for Marketing Consultation and Projects Development',

  // Phase 3 — West Bank New, Ramallah on-site
  'Electra Control Systems',
  'Badawi Information Systems',
  'ABA Agency',
  'Togo App',
  'Inspire IT Solutions for Information Technology',
  'Seema Application for digital services',
  'Synergia for Workforce Management',
  'Siraj for Students Services & Career Guidance',

  // Phase 4 — Gaza, all online
  'World Links',
  'Taif',
  'Dash',
  'WE WILL TECH',
  'Haweya',
  'سمارت أبيكس لتكنولوجيا المعلومات',
  'PediaLink',
  'Tweets Tec Company',
  'Shift ICT',
  'Hexa',
  'EvoInsight',
  'ME Group',
  'Tatwer',
  'Dimensions',
  'Polaris',
  'Go Global',
  'Jaffa.Net',
];

function normName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const INTERVIEWED_NAMES: Set<string> = new Set(RAW_NAMES.map(normName));
export const INTERVIEWED_RAW: ReadonlyArray<string> = RAW_NAMES;

export function isInterviewed(companyName: string, names: Set<string> = INTERVIEWED_NAMES): boolean {
  if (!companyName || names.size === 0) return false;
  const k = normName(companyName);
  if (!k) return false;
  if (names.has(k)) return true;
  // Loose substring fall-back to tolerate "Inc.", "Ltd", trailing notes etc.
  for (const n of names) {
    if (n.length < 4) continue;
    if (k.includes(n) || n.includes(k)) return true;
  }
  return false;
}
