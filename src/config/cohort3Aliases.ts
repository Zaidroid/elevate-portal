// Explicit alias map for the 41 Cohort 3 companies.
//
// Cross-referenced once, by hand, between:
//   - the final allocation xlsx (41 names — short, brand-style)
//   - the interviewed-list (52 names from
//     src/pages/companies/interviewedSource.ts — full registered names)
//
// `canonical` is the human-readable name we standardise on (the
// interviewed-list version where applicable). `aliases` covers every
// other variant we've seen in the system: the xlsx short name, the
// interviewed-list full name, plus any obvious misspellings (e.g.
// "Pollaris" / "Polaris").
//
// Used by:
//   - cohortAllocationPreset.ts → match xlsx rows against existing master
//     rows so we never create a duplicate at seed time
//   - admin AutoMergeCohortCard → in one click, merge every existing
//     master row that resolves to a cohort canonical into the canonical
//     row, repointing assignments / comments / activity
//
// To extend: add one entry per company. Aliases are matched case- and
// punctuation-insensitively via fuzzyNorm.

import { fuzzyNorm } from '../lib/normalize';

export type CohortAlias = {
  canonical: string;
  aliases: string[];
};

export const COHORT3_ALIASES: CohortAlias[] = [
  { canonical: 'AI Pilot',                                                                          aliases: ['Aipilot'] },
  { canonical: 'National Cyber Security Company',                                                   aliases: ['NCS'] },
  { canonical: 'Dimensions',                                                                        aliases: [] },
  { canonical: 'Dotline Marketing and Advertising Agency',                                          aliases: ['Dotline'] },
  { canonical: 'ASAL Technologies',                                                                 aliases: ['Asal Technologies'] },
  { canonical: 'Enbat',                                                                             aliases: [] },
  { canonical: 'Digify Company for Marketing Consultation and Projects Development',               aliases: ['Digify'] },
  { canonical: 'Top Mena Talents for Programming and Information Technology',                       aliases: ['Top Mena'] },
  { canonical: 'Hexa',                                                                              aliases: [] },
  { canonical: 'Electra Control Systems',                                                           aliases: ['Electra'] },
  { canonical: 'Synergia for Workforce Management',                                                 aliases: ['Synergia'] },
  { canonical: 'Bashar Al-Bakri & Partners for Marketing and Technological Solutions',              aliases: ['Bashar Albakri'] },
  { canonical: 'Togo App',                                                                          aliases: ['To-go', 'Togo'] },
  { canonical: 'Hesabate',                                                                          aliases: [] },
  // Per Zaid: Sellenvo is the same company as Inspire IT Solutions for
  // Information Technology (interviewed under that name in Phase 3).
  { canonical: 'Inspire IT Solutions for Information Technology',                                   aliases: ['Sellenvo'] },
  { canonical: 'IzTechValley',                                                                      aliases: ['Iztech Valley'] },
  { canonical: 'Tweets Tec Company',                                                                aliases: ['Tweets'] },
  { canonical: 'WE WILL TECH',                                                                      aliases: ['We Will Tech'] },
  { canonical: 'Scope Systems',                                                                     aliases: ['Scope system'] },
  { canonical: 'OFFTEC Palestine',                                                                  aliases: ['Offtec'] },
  { canonical: 'ME Group',                                                                          aliases: [] },
  { canonical: 'PITS',                                                                              aliases: [] },
  { canonical: 'EvoInsight',                                                                        aliases: ['Evoinsight'] },
  { canonical: 'Olivery',                                                                           aliases: [] },
  { canonical: 'Siraj for Students Services & Career Guidance',                                     aliases: ['Siraj'] },
  { canonical: 'Go Global',                                                                         aliases: [] },
  { canonical: 'SAFEDENY for Secure Technologies',                                                  aliases: ['Safedeny'] },
  { canonical: 'ULTIMIT Advanced Turnkey Solutions',                                                aliases: ['Ultimit'] },
  { canonical: 'World Links',                                                                       aliases: [] },
  { canonical: 'Tech 360',                                                                          aliases: ['Tech360'] },
  { canonical: 'Kidify',                                                                            aliases: [] },
  { canonical: 'Shift ICT',                                                                         aliases: [] },
  { canonical: 'Badawi Information Systems',                                                        aliases: ['Badawi'] },
  { canonical: 'Radix Technologies',                                                                aliases: ['Radix'] },
  { canonical: 'Polaris',                                                                           aliases: ['Pollaris'] },
  { canonical: 'TechnoGeeks',                                                                       aliases: ['Technogeeks'] },
  { canonical: 'Taif',                                                                              aliases: ['Tayf'] },
  { canonical: 'Haweya',                                                                            aliases: ['Hawaye'] },
  { canonical: 'Jaffa.Net',                                                                         aliases: ['Jaffa'] },
  { canonical: 'Sada Intelligence',                                                                 aliases: ['SADA'] },
  { canonical: 'Pillars For Development and Technology Investment',                                 aliases: ['Pillars'] },
];

// Build a fuzzy lookup: any known name (canonical or alias) → canonical.
const lookup = new Map<string, string>();
for (const entry of COHORT3_ALIASES) {
  lookup.set(fuzzyNorm(entry.canonical), entry.canonical);
  for (const a of entry.aliases) lookup.set(fuzzyNorm(a), entry.canonical);
}

/** Returns the canonical Cohort 3 name for any xlsx / interviewed-list / master variant, or null. */
export function canonicalCohortName(name: string): string | null {
  return lookup.get(fuzzyNorm(name)) || null;
}
