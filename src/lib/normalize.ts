// Shared normalization helpers.
//
// `fuzzyNorm` is used by:
//   - the cohort allocation seed (matches xlsx names against the
//     Companies master tab, even with punctuation / suffix variants)
//   - the admin "Find &amp; merge duplicates" tool (clusters companies by
//     normalized name)
// Keeping one implementation guarantees the seed never silently
// creates a row the dedupe tool would later flag as a duplicate.

const COMPANY_SUFFIX_RX =
  /\b(ltd|inc|llc|co|corp|company|solutions|tech|technologies|systems|group|holdings)\b/g;

export function fuzzyNorm(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(COMPANY_SUFFIX_RX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
