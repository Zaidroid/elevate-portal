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

// Arabic letter range (basic + supplement + presentation forms A/B).
// We strip diacritics (tashkeel) and the tatweel before matching, and
// fold a couple of common letter variants (alef forms → ا, ya → ي,
// ta marbuta → ه) so spellings written one way match the other.
const ARABIC_DIACRITICS_RX = /[ً-ٰٟـ]/g;
function foldArabic(s: string): string {
  return s
    .replace(ARABIC_DIACRITICS_RX, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

export function fuzzyNorm(name: string): string {
  return foldArabic((name || '').toLowerCase())
    // Preserve Latin, digits, AND Arabic letters (U+0600–U+06FF). Without
    // the Arabic range here, applicants whose Source Data name is purely
    // Arabic collapse to '' and can't match anything.
    .replace(/[^a-z0-9؀-ۿ\s]/g, ' ')
    .replace(COMPANY_SUFFIX_RX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
