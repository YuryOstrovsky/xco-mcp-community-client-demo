// frontend/src/lib/nl/compass.ts
//
// Compass widget NL parsing. Extracted from App.tsx in #184/2 — the
// ~70-line block at the top of runNL used to live inline, with its
// MAC regex set duplicated from IpMacSearchWidget. Both now consume
// MAC patterns from lib/nl/macFormats.ts and call into here.
//
// The Compass widget is the "where is this?" search panel. Triggers
// covered:
//   - bare "compass"     → opens empty widget
//   - "where is X" / "find X" / "locate X" / "what's on port X"
//     / "show MACs in VLAN N"
//
// Search-value priority: MAC > Port > VLAN > IP. (Most distinctive
// wins; IP last because it's the bait shape that originally caused
// the host-IP-as-scope bug #182.)
//
// Scope handling: ONLY accept "on <X>" matches where X is a known
// switch name or IP AND X is not the search needle. Otherwise the
// widget probes all known switches.

import { extractMac } from "./macFormats";

/** Switch inventory shape from App.tsx switchOptions. We only need
 *  these three fields, so accept any object with them. */
export interface CompassSwitchOption {
  ip: string;
  name?: string | null;
}

/** What the compass parser hands back to App.tsx. */
export type CompassParseResult =
  | { kind: "open_empty" }                                             // bare "compass"
  | { kind: "open_with_query"; query: string; scopeIps: string[] }     // verb + recognized token
  | { kind: "no_match" };                                              // nothing here

/**
 * Parse a user prompt and decide whether it should open the Compass
 * widget — and with what initial query + scope.
 *
 * Pure function. Caller (App.tsx) handles state setters + closing
 * other tier-3 widgets if the result is non-no_match.
 */
export function parseCompassPrompt(
  text: string,
  switchOptions: CompassSwitchOption[],
): CompassParseResult {
  const t = text.trim();

  // Bare "compass" keyword.
  if (/^\s*compass\s*$/i.test(t)) {
    return { kind: "open_empty" };
  }

  // Need an explicit verb to mean "search". Without one, "10.10.10.111
  // is unreachable" should NOT open Compass.
  const verb = /\b(where(?:'?s| is)?\b|find\b|locate\b|what(?:'?s| is)\s+(?:plugged|on)|show\s+(?:all\s+)?macs?)\b/i.test(t);
  if (!verb) return { kind: "no_match" };

  // Tokens — extract each kind separately. Order doesn't matter here;
  // priority is applied below.
  const ipM = t.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  const macNeedle = extractMac(t);
  const vlanM = t.match(/\bvlan\s*(\d{1,4})\b/i);
  const portM = (/\b(port|interface|plugged)\b/i.test(t))
    ? t.match(/\b(\d{1,3}\/\d{1,3})\b/)
    : null;

  // Search value picked by priority: MAC > Port > VLAN > IP. Most
  // distinctive wins; IP last because it's the bait shape for the
  // old scope-confusion bug (where `where is 10.10.10.111` mis-routed
  // the host IP as a switch scope).
  let needle = "";
  if (macNeedle) needle = macNeedle;
  else if (portM) needle = portM[1];
  else if (vlanM) needle = vlanM[1];
  else if (ipM) needle = ipM[1];

  if (!needle) return { kind: "no_match" };

  // Scope extraction. Walks every "on <token>" pair in the prompt.
  // Rejects:
  //   - the search needle itself (host IP isn't the switch)
  //   - common-noun tokens (port, interface, the, this, that)
  //   - IP-shaped candidates not present in inventory
  //   - switch-name candidates not present in inventory (case-insensitive)
  const scopeIps: string[] = [];
  const onMatches = Array.from(t.matchAll(/\bon\s+([A-Za-z0-9][A-Za-z0-9_.\-]{0,40})\b/gi));
  for (const m of onMatches) {
    const cand = m[1];
    if (cand === needle) continue;
    if (/^(port|interface|the|this|that)$/i.test(cand)) continue;
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cand)) {
      if (switchOptions.some((s) => s.ip === cand)) scopeIps.push(cand);
      continue;
    }
    const sw = switchOptions.find(
      (s) => s.name && s.name.toLowerCase() === cand.toLowerCase(),
    );
    if (sw) scopeIps.push(sw.ip);
  }

  return { kind: "open_with_query", query: needle, scopeIps };
}
