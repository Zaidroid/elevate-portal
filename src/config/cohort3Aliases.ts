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
  /** Authoritative cohort metadata from the final allocation xlsx. The
   *  Backfill admin tool uses these to repair master rows whose data
   *  was lost during dedupe / merge. Optional so older entries don't
   *  need to be touched. */
  city?: string;
  am?: string;             // profile_manager_email
  donor?: string;          // 'Dutch' | 'SIDA' | ''
  budgetUsd?: number;      // total estimated budget from xlsx
  regDocUrl?: string;      // Drive link to registration document
};

export const COHORT3_ALIASES: CohortAlias[] = [
  { canonical: 'AI Pilot',                                                            aliases: ['Aipilot'],          city: 'Nablus',    am: 'ayesh@gazaskygeeks.com', donor: '' },
  { canonical: 'National Cyber Security Company',                                     aliases: ['NCS'],              city: 'Ramallah',  am: 'ayesh@gazaskygeeks.com', donor: 'SIDA',  budgetUsd: 6300, regDocUrl: 'https://drive.google.com/file/d/1e2wz6W_X-Mqnq_61nxIQY-SfsRQWdqnX/view?usp=sharing' },
  { canonical: 'Dimensions',                                                          aliases: [],                   city: 'Ramallah',  am: 'ayesh@gazaskygeeks.com', donor: 'SIDA',  regDocUrl: 'https://drive.google.com/file/d/1-VMoRnT1YKW7m5hpv9St5an1jpcsAVCW/view?usp=sharing' },
  { canonical: 'Dotline Marketing and Advertising Agency',                            aliases: ['Dotline'],          city: 'Nablus',    am: 'muna@gazaskygeeks.com',  donor: '' },
  { canonical: 'ASAL Technologies',                                                   aliases: ['Asal Technologies'],city: 'Ramallah',  am: 'doaa@gazaskygeeks.com',  donor: '' },
  { canonical: 'Enbat',                                                               aliases: [],                   city: 'Ramallah',  am: 'muna@gazaskygeeks.com',  donor: 'Dutch', regDocUrl: 'https://drive.google.com/file/d/12s_Q7KyDzb36ubqdMZTkQXkCakixYkkn/view?usp=sharing' },
  { canonical: 'Digify Company for Marketing Consultation and Projects Development',  aliases: ['Digify'],           city: 'Ramallah',  am: 'doaa@gazaskygeeks.com',  donor: '' },
  { canonical: 'Top Mena Talents for Programming and Information Technology',         aliases: ['Top Mena'],         city: 'Ramallah',  am: 'muna@gazaskygeeks.com',  donor: '' },
  { canonical: 'Hexa',                                                                aliases: [],                   city: 'Gaza',      am: 'ayesh@gazaskygeeks.com', donor: 'Dutch' },
  { canonical: 'Electra Control Systems',                                             aliases: ['Electra'],          city: 'Ramallah',  am: 'ayesh@gazaskygeeks.com', donor: 'SIDA',  budgetUsd: 6300, regDocUrl: 'https://drive.google.com/file/d/1OjkrL03DGhu9gfH-91-Rr70GyXqb7lU3/view?usp=drive_link' },
  { canonical: 'Synergia for Workforce Management',                                   aliases: ['Synergia'],         city: 'Ramallah',  am: 'ayesh@gazaskygeeks.com', donor: 'SIDA',  budgetUsd: 1500, regDocUrl: 'https://drive.google.com/file/d/1HQBLocBnUkTjsslWzFRnQ6kpTci2HHal/view?usp=drive_link' },
  { canonical: 'Bashar Al-Bakri & Partners for Marketing and Technological Solutions',aliases: ['Bashar Albakri'],   city: 'Hebron',    am: 'muna@gazaskygeeks.com',  donor: 'SIDA',  budgetUsd: 9600, regDocUrl: 'https://drive.google.com/file/d/1PlJ4_HYa9nljqNMNd46yzXntXwQ5yFlB/view?usp=sharing' },
  { canonical: 'Togo App',                                                            aliases: ['To-go', 'Togo'],    city: 'Ramallah',  am: 'doaa@gazaskygeeks.com',  donor: 'SIDA',  budgetUsd: 3000, regDocUrl: 'https://drive.google.com/file/d/1ggwOTfdA7S4EDfhOs57AsWuvQh-hmkML/view?usp=drive_link' },
  { canonical: 'Hesabate',                                                            aliases: [],                   city: 'Nablus',    am: 'muna@gazaskygeeks.com',  donor: 'SIDA',  budgetUsd: 1500, regDocUrl: 'https://drive.google.com/file/d/1-VMoRnT1YKW7m5hpv9St5an1jpcsAVCW/view?usp=sharing' },
  // Per Zaid: Sellenvo is the same company as Inspire IT Solutions for Information Technology
  { canonical: 'Inspire IT Solutions for Information Technology',                     aliases: ['Sellenvo'],         city: 'Ramallah',  am: 'doaa@gazaskygeeks.com',  donor: 'SIDA',  budgetUsd: 1500, regDocUrl: 'https://drive.google.com/file/d/1BWOaof_T8afsudoBs18VdyHSH2hKWeyx/view?usp=drive_link' },
  { canonical: 'IzTechValley',                                                        aliases: ['Iztech Valley'],    city: 'Hebron',    am: 'doaa@gazaskygeeks.com',  donor: 'SIDA',  budgetUsd: 9600, regDocUrl: 'https://drive.google.com/file/d/10AdDtC6FnfLNPP3qTeDxQEQ5SudljKDn/view?usp=drive_link' },
  { canonical: 'Tweets Tec Company',                                                  aliases: ['Tweets'],           city: 'Gaza',      am: 'muna@gazaskygeeks.com',  donor: 'Dutch', budgetUsd: 6300, regDocUrl: 'https://drive.google.com/file/d/1et1BrVlWTnWVTIryByQ0FHQO8j1gompl/view?usp=drive_link' },
  { canonical: 'WE WILL TECH',                                                        aliases: ['We Will Tech'],     city: 'Gaza',      am: 'muna@gazaskygeeks.com',  donor: 'Dutch', budgetUsd: 1500, regDocUrl: 'https://drive.google.com/file/d/170J3g6u9rCOlurRnJTcDYzKj4rPp2U-T/view?usp=drive_link' },
  { canonical: 'Scope Systems',                                                       aliases: ['Scope system'],     city: 'Ramallah',  am: 'ayesh@gazaskygeeks.com', donor: 'SIDA',  budgetUsd: 4000 },
  { canonical: 'OFFTEC Palestine',                                                    aliases: ['Offtec'],           city: 'Ramallah',  am: 'ayesh@gazaskygeeks.com', donor: 'SIDA',  budgetUsd: 1690 },
  { canonical: 'ME Group',                                                            aliases: [],                   city: 'Gaza',      am: 'doaa@gazaskygeeks.com',  donor: 'Dutch', budgetUsd: 2000 },
  { canonical: 'PITS',                                                                aliases: [],                   city: 'Nablus',    am: 'muna@gazaskygeeks.com',  donor: 'SIDA',  budgetUsd: 2000 },
  { canonical: 'EvoInsight',                                                          aliases: ['Evoinsight'],       city: 'Gaza',      am: 'doaa@gazaskygeeks.com',  donor: 'Dutch', budgetUsd: 5000 },
  { canonical: 'Olivery',                                                             aliases: [],                   city: 'Ramallah',  am: 'muna@gazaskygeeks.com',  donor: 'SIDA',  budgetUsd: 5000 },
  { canonical: 'Siraj for Students Services & Career Guidance',                       aliases: ['Siraj'],            city: 'Ramallah',  am: 'doaa@gazaskygeeks.com',  donor: 'SIDA',  budgetUsd: 5000 },
  { canonical: 'Go Global',                                                           aliases: [],                   city: 'Ramallah',  am: 'muna@gazaskygeeks.com',  donor: 'SIDA',  regDocUrl: 'https://drive.google.com/file/d/15vs2ZHY_4WdrPnUiTxmOIy6b8b6aFeQS/view?usp=sharing' },
  { canonical: 'SAFEDENY for Secure Technologies',                                    aliases: ['Safedeny'],         city: 'Hebron',    am: 'ayesh@gazaskygeeks.com', donor: 'SIDA',  regDocUrl: 'https://drive.google.com/file/d/1_idrKX-cKZhpss5NeFtv0gu33bvodK3Z/view?usp=sharing' },
  { canonical: 'ULTIMIT Advanced Turnkey Solutions',                                  aliases: ['Ultimit'],          city: 'Ramallah',  am: 'doaa@gazaskygeeks.com',  donor: 'SIDA',  regDocUrl: 'https://drive.google.com/file/d/1Qsql_SgJ_lobbbpW96J-qJKtB8ThxETA/view?usp=sharing' },
  { canonical: 'World Links',                                                         aliases: [],                   city: 'Gaza',      am: 'doaa@gazaskygeeks.com',  donor: 'Dutch', regDocUrl: 'https://drive.google.com/file/d/1uc1F-3wW7qYEBYvr78RgUDBpbV2C4piL/view?usp=sharing' },
  { canonical: 'Tech 360',                                                            aliases: ['Tech360'],          city: 'Hebron',    am: 'ayesh@gazaskygeeks.com', donor: 'Dutch' },
  { canonical: 'Kidify',                                                              aliases: [],                   city: 'Salfeet',   am: 'muna@gazaskygeeks.com',  donor: 'Dutch' },
  { canonical: 'Shift ICT',                                                           aliases: [],                   city: 'Gaza',      am: 'doaa@gazaskygeeks.com',  donor: 'Dutch' },
  { canonical: 'Badawi Information Systems',                                          aliases: ['Badawi'],           city: 'Ramallah',  am: 'doaa@gazaskygeeks.com',  donor: 'Dutch' },
  { canonical: 'Radix Technologies',                                                  aliases: ['Radix'],            city: 'Nablus',    am: 'doaa@gazaskygeeks.com',  donor: 'Dutch' },
  { canonical: 'Polaris',                                                             aliases: ['Pollaris'],         city: 'Ramallah',  am: 'ayesh@gazaskygeeks.com', donor: 'Dutch' },
  { canonical: 'TechnoGeeks',                                                         aliases: ['Technogeeks'],      city: 'Ramallah',  am: 'ayesh@gazaskygeeks.com', donor: 'Dutch' },
  { canonical: 'Taif',                                                                aliases: ['Tayf'],             city: 'Gaza',      am: 'ayesh@gazaskygeeks.com', donor: 'Dutch' },
  { canonical: 'Haweya',                                                              aliases: ['Hawaye'],           city: 'Gaza',      am: 'muna@gazaskygeeks.com',  donor: 'Dutch' },
  { canonical: 'Jaffa.Net',                                                           aliases: ['Jaffa'],            city: 'Ramallah',  am: 'doaa@gazaskygeeks.com',  donor: 'Dutch' },
  { canonical: 'Sada Intelligence',                                                   aliases: ['SADA'],             city: 'Hebron',    am: 'muna@gazaskygeeks.com',  donor: 'Dutch' },
  { canonical: 'Pillars For Development and Technology Investment',                   aliases: ['Pillars'],          city: 'Nablus',    am: 'muna@gazaskygeeks.com',  donor: 'Dutch' },
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

const byCanonical = new Map<string, CohortAlias>();
for (const e of COHORT3_ALIASES) byCanonical.set(e.canonical, e);

/** Look up the full alias entry (incl. city / am / donor / budget) by any name variant. */
export function cohortEntryFor(name: string): CohortAlias | null {
  const canon = canonicalCohortName(name);
  if (!canon) return null;
  return byCanonical.get(canon) || null;
}

/** True if this row's company name resolves to a Cohort 3 canonical entry.
 *  This is the canonical "is in cohort?" check — every page that needs to
 *  filter to the 41 cohort companies should call this. */
export function isCohort3<T extends { company_name?: string }>(row: T): boolean {
  return canonicalCohortName(row.company_name || '') !== null;
}

/** Filter to just the Cohort 3 rows. */
export function filterCohort3<T extends { company_name?: string }>(rows: T[]): T[] {
  return rows.filter(isCohort3);
}
