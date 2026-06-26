// frontend/src/lib/nl/switchNameToIp.ts
//
// Client-side switch NAME → IP substitution for the NL pipeline. The backend's
// deterministic input extractor (backend/nl/extract.py) only pulls switch_ip
// from a LITERAL IP in the text — it can't resolve a name like "DC-Leaf6". So
// the client rewrites every known switch name in the prompt to its mgmt IP
// before sending, using the current site's `switchOptions`. This is what makes
// "check media on DC-Leaf6" work: it becomes "check media on 10.x.x.x".
//
// Because resolution is keyed off the SITE-scoped switchOptions, a stale
// switchOptions (right after an XCO/site switch, before the inventory refresh
// lands) is exactly when a per-switch command fails — the name doesn't match
// any switch, no IP is injected, and the server 400s with missing_switch_ip.
// The caller (App.tsx) auto-heals that by re-fetching the site's inventory and
// retrying this substitution.
//
// Extracted from App.tsx (runNL) so it's unit-testable, added 2026-06-25.

export interface SwitchOption {
  ip: string;
  name?: string | null;
  fabric?: string | null;
}

const IPV4_RE = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;

/** Replace every known switch name in `text` with its IP. No-op when the text
 *  already contains an IP, or no switches are loaded. Longest names first so
 *  "Leaf-10" is replaced before the "Leaf-1" prefix. */
export function substituteSwitchNames(text: string, switches: SwitchOption[]): string {
  if (!text || !switches.length || IPV4_RE.test(text)) return text;
  let out = text;
  const sorted = [...switches]
    .filter((sw) => sw.name && sw.ip)
    .sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0));
  const tLower = text.toLowerCase();
  for (const sw of sorted) {
    if (sw.name && sw.ip && tLower.includes(sw.name.toLowerCase())) {
      out = out.replace(
        new RegExp(sw.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
        sw.ip,
      );
    }
  }
  return out;
}

const SKIP_REF = /^(all|every|each|any|some|this|that|it|switches|devices?|fabric|inventory|xco)$/i;

/** When `text` references a single switch by NAME after on/for/at/from and that
 *  name isn't a known fabric, return it — the signal that we SHOULD have
 *  resolved a switch but (with the given switches) couldn't. Returns null when
 *  there's no such dangling reference (so the caller skips the refetch+retry). */
export function unresolvedSwitchRef(text: string, switches: SwitchOption[]): string | null {
  if (!text || IPV4_RE.test(text)) return null;
  const m = text.match(/\b(?:on|for|at|from)\s+(?:the\s+)?(?:switch\s+)?([A-Za-z][\w-]*)\s*$/i);
  const name = m?.[1];
  if (!name || SKIP_REF.test(name)) return null;
  const lc = name.toLowerCase();
  // A fabric name is not a switch — don't trigger a switch-inventory refetch.
  if (switches.some((s) => s.fabric && s.fabric.toLowerCase() === lc)) return null;
  // Already resolvable with what we have → not "unresolved".
  if (switches.some((s) => s.name && s.name.toLowerCase().includes(lc))) return null;
  return name;
}
