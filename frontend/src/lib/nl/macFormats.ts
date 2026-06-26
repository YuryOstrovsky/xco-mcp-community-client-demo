// frontend/src/lib/nl/macFormats.ts
//
// Single source of truth for MAC-address format detection. Same regex
// set was previously duplicated between App.tsx's compass NL handler
// and IpMacSearchWidget's auto-classify. #184/3 dedupes both onto
// these constants.
//
// Accepted forms (all case-insensitive):
//   - colon         "aa:bb:cc:dd:ee:ff"
//   - dotted-quad   "0004.96d6.8649"  (Cisco style)
//   - hyphen        "aa-bb-cc-dd-ee-ff"
//   - bare 12-hex   "AABBCCDDEEFF"

/** MAC in colon-separated form, e.g. "aa:bb:cc:dd:ee:ff" */
export const MAC_COLON_RE = /\b([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})\b/;
/** MAC in dotted-quad form (Cisco), e.g. "0004.96d6.8649" */
export const MAC_DOTTED_RE = /\b([0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4})\b/;
/** MAC in hyphen-separated form, e.g. "aa-bb-cc-dd-ee-ff" */
export const MAC_HYPHEN_RE = /\b([0-9A-Fa-f]{2}(?:-[0-9A-Fa-f]{2}){5})\b/;
/** MAC as bare 12-character hex, e.g. "AABBCCDDEEFF" */
export const MAC_BARE_RE = /\b([0-9A-Fa-f]{12})\b/;

/** Extract the first MAC from `text` in any of the four accepted
 *  forms. Order matters — separated forms first, bare-12-hex last so a
 *  colon/dotted form isn't accidentally truncated to its first 12 hex
 *  chars by the .match() returning early. Returns "" if no MAC matches. */
export function extractMac(text: string): string {
  const colon = text.match(MAC_COLON_RE);
  if (colon) return colon[1];
  const dotted = text.match(MAC_DOTTED_RE);
  if (dotted) return dotted[1];
  const hyphen = text.match(MAC_HYPHEN_RE);
  if (hyphen) return hyphen[1];
  const bare = text.match(MAC_BARE_RE);
  return bare ? bare[1] : "";
}

/** True if `text` contains a MAC in any of the four forms. */
export function hasMac(text: string): boolean {
  return MAC_COLON_RE.test(text) || MAC_DOTTED_RE.test(text)
    || MAC_HYPHEN_RE.test(text) || MAC_BARE_RE.test(text);
}

/** True if `text` is ENTIRELY a MAC in any of the four forms — used
 *  by the Compass widget when the operator types the whole value into
 *  the search input. Different from `hasMac`, which scans a larger
 *  prompt; this rejects "where is aa:bb:..." because the verb words
 *  are part of the input. */
export function isExactlyMac(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^[0-9A-Fa-f]{2}([:.\-][0-9A-Fa-f]{2}){5}$/.test(t)) return true;
  if (/^[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}$/.test(t)) return true;
  if (/^[0-9A-Fa-f]{12}$/.test(t)) return true;
  return false;
}
