// frontend/src/lib/nl/detectors.ts
//
// Client-side NL intent detectors. Each function is a pure
// regex-driven classifier that runs BEFORE we ship the prompt to the
// server's NL endpoint, so common operator phrasings open the right
// widget deterministically (no LLM round-trip, no race with the
// server's own deterministic router).
//
// Each detector is mirrored on the backend in nl/deterministic.py:
// NL routing has TWO layers. If a regex changes here, the matching
// server rule has to change too.
//
// Detectors exported:
//   - detectLldpIntent           — show lldp on/at/seed/perspective
//   - detectSwVersionIntent      — firmware version mismatch / drift
//   - detectFleetMediaInventoryIntent — fleet-wide transceiver query
//   - detectSerialSearchIntent   — find switch with serial X
//   - detectFleetInventoryIntent — fleet/chassis/hardware inventory
//   - detectXcoHealthIntent      — xco health / probe / wedge
//   - detectDirectToolCall       — user typed a known tool name verbatim
//
// Shared helpers:
//   - _extractScope              — "for/of/on/in <X>" → {scopeFabric|scopeIp|scopeName}
//   - DIRECT_TOOL_NAMES          — names detectDirectToolCall checks for

export type LldpIntent =
  | { kind: "neighbor_detail"; ip: string }
  | { kind: "topology"; seedIp: string | null; depth: 1 | 2 | null };

// ── LLDP client-side intent detector ─────────────────────────────────
// Runs before the NL backend so common LLDP phrasings are handled
// deterministically.
export function detectLldpIntent(text: string): LldpIntent | null {
  const t = text.trim();
  // Must contain "lldp" to qualify
  if (!/\blldp\b/i.test(t)) return null;

  // Extract first IPv4 address present in the text
  const ipMatch = t.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
  const ip = ipMatch?.[1] ?? null;

  // Depth: look for "2 hop(s)", "two hop(s)", "depth 2", etc.
  const depth: 1 | 2 | null =
    /\b(2|two)\s*-?\s*(hop|hops)\b|\bdepth\s*[=:]?\s*2\b/i.test(t) ? 2 :
    /\b(1|one)\s*-?\s*(hop|hops)\b|\bdepth\s*[=:]?\s*1\b/i.test(t) ? 1 :
    null;

  // Perspective / seed phrasing → topology map with different seed
  if (
    /\b(perspective|point\s+of\s+view|pov|angle)\b/i.test(t) ||
    /\bseen?\s+from\b/i.test(t) ||
    /\bfrom\s+(the\s+)?(switch\s+)?\d{1,3}\.\d/i.test(t) ||
    /\bwith\s+(the\s+)?seed\s+(ip\s+)?\d{1,3}\.\d/i.test(t) ||
    /\bseed(ed)?\s+(at\s+|ip\s+)?\d{1,3}\.\d/i.test(t)
  ) {
    return { kind: "topology", seedIp: ip, depth };
  }

  // Single-switch neighbor detail
  if (
    ip &&
    (
      /\b(on|at)\s+(the\s+)?(switch\s+)?\d{1,3}\.\d/i.test(t) ||
      /\bfor\s+(the\s+)?switch\s+\d{1,3}\.\d/i.test(t) ||
      /\bneighbo(u?)rs?\s+(of|on|at|from)\s+(the\s+)?(switch\s+)?\d{1,3}\.\d/i.test(t)
    )
  ) {
    if (depth !== null) {
      return { kind: "topology", seedIp: ip, depth };
    }
    return { kind: "neighbor_detail", ip };
  }

  // Everything else (generic "show lldp", "lldp topology", depth-only, etc.)
  return { kind: "topology", seedIp: null, depth };
}

// ── Direct-tool-name bypass ──────────────────────────────────────────
// If the user types a known tool name verbatim, force that tool
// deterministically. Bypasses the LLM tier.
export const DIRECT_TOOL_NAMES = [
  "tenant_get_service_epg_historical_report_stub",
  "tenant_get_tenants",
  "tenant_get_all_endpoint_groups",
  "fabric_get_fabric_health_summary",
  "fabric_get_fabrics_health",
  "monitor_get_health",
  "fault_get_alarm_details_with_context",
  "inventory_get_software_version_mismatch",
];

export function detectDirectToolCall(text: string): { tool: string; tenantName?: string } | null {
  const t = text.trim();
  for (const tool of DIRECT_TOOL_NAMES) {
    if (new RegExp(`\\b${tool}\\b`, "i").test(t)) {
      // Extract "for <TenantName>" and strip any trailing punctuation
      const m = t.match(/\bfor\s+([A-Za-z0-9_\-]+)/i);
      return { tool, tenantName: m?.[1] };
    }
  }
  return null;
}

// ── Software version mismatch intent ─────────────────────────────────
// Catches natural-language questions about software/firmware version
// consistency so they route to inventory_get_software_version_mismatch
// instead of the LLM. Covers: mismatch language, "same version" checks,
// update/outdated queries, firmware/sw health checks, version audit/
// compliance, etc.
export function detectSwVersionIntent(text: string): boolean {
  const t = text.trim().toLowerCase();

  // Short-circuit: don't steal queries that already contain the exact
  // tool name (detectDirectToolCall handles those) or LLDP queries.
  if (/inventory_get_software_version_mismatch/.test(t)) return false;
  if (/\blldp\b/.test(t)) return false;

  // ── 0: fast two-keyword AND catch ─────────────────────────────────
  // Subject word + qualifier word = match. Primary catch; the specific
  // patterns below are belt-and-suspenders.
  const swSubject  = /\b(software|firmware|sw|os|version|release)\b/.test(t);
  const swAction   = /\b(audit|check|scan|review|report|compliance|health|status|mismatch|drift|inconsisten|uniformity|consistency|update|upgrade|patch|outdated|behind|stale)\b/.test(t);
  const swSame     = /\b(same|identical|matching|consistent|uniform|equal)\b/.test(t);
  const swQuality  = /\b(ok|okay|good|fine|healthy|bad|wrong|issue|problem|current|latest|up.to.date)\b/.test(t);
  if (swSubject && (swAction || swSame || swQuality)) return true;

  // ── A: explicit mismatch / drift / inconsistency language ─────────
  if (/\b(version|sw|software|firmware|os|release)\s*(mismatch|drift|inconsisten|conflict|discrepan)\b/.test(t)) return true;
  if (/\bmixed\s*(version|firmware|software|os|release)\b/.test(t)) return true;
  if (/\bdrift\b/.test(t) && /\b(version|firmware|software|sw|release|os)\b/.test(t)) return true;

  // ── B: "same / consistent / matching version" checks ──────────────
  if (/\b(same|identical|matching|consistent|uniform)\s+(version|firmware|software|release|os)\b/.test(t)) return true;
  if (/\b(version|firmware|software|release|os)\s+.{0,25}\b(same|identical|matching|consistent|uniform)\b/.test(t)) return true;
  if (/\ball\s+.{0,30}\b(same|consistent|uniform)\b/.test(t) && /\b(version|firmware|software|sw|release|os|build)\b/.test(t)) return true;

  // ── C: updates / upgrades / patches ───────────────────────────────
  if (/\b(update|upgrade|patch)(es)?\s*(needed|required|available|pending|outstanding)\b/.test(t)) return true;
  if (/\b(need|require).{0,15}(update|upgrade|patch)\b/.test(t)) return true;
  if (/\b(any|are\s+there|check\s+for)\s+(firmware|software|sw|os|version)\s*(update|upgrade)\b/.test(t)) return true;
  if (/\b(outdated|out.of.date|stale|behind|old)\s*(firmware|software|sw|version|switch(es)?|device)\b/.test(t)) return true;
  if (/\b(firmware|software|sw|version|switch(es)?|device)\s+.{0,15}\b(outdated|out.of.date|stale|behind|old)\b/.test(t)) return true;

  // ── D: health / status / check / audit on software or firmware ────
  if (/\b(firmware|software|sw)\s+(health|status|report|audit|compliance|scan|check)\b/.test(t)) return true;
  if (/\b(check|scan|verify|validate|audit|review)\s+(the\s+)?(firmware|software|sw|version|os|release)\b/.test(t)) return true;
  if (/\b(is|are)\s+(my|our|the)\s+(sw|software|firmware|version(s)?|switch(es)?)\s+(ok|good|fine|consistent|healthy|up.to.date|current|same)\b/.test(t)) return true;
  if (/\bversion\s+(check|compliance|uniformity|audit|report|scan|summary|health)\b/.test(t)) return true;
  if (/\bany\s+(software|firmware|sw|version|os)\s+(issue|problem|mismatch|inconsisten)\b/.test(t)) return true;

  // ── E: loose but unambiguous combos ───────────────────────────────
  if (/\b(switch(es)?|device(s)?|node(s)?)\b.{0,40}\b(same|consistent|matching|uniform|identical)\b.{0,20}\b(version|firmware|software|os|release)\b/.test(t)) return true;
  if (/\b(version|firmware|software|os|release)\b.{0,30}\b(switch(es)?|device(s)?|network)\b.{0,30}\b(same|ok|good|consistent|uniform|match)\b/.test(t)) return true;
  if (/\b(software|firmware)\s+(compliance|uniformity|consistency)\b/.test(t)) return true;

  return false;
}

// ── Scope extractor ──────────────────────────────────────────────────
// Helper — extract a scope from NL text so widgets can pre-populate
// their filter. Three kinds:
//   • scopeFabric: "in fabric lab-b-alex" / "of fabric DC-A"
//   • scopeIp:     "for 10.9.140.31"
//   • scopeName:   "for Spine-1" / "of Leaf-2"
// Fabric scope wins over name/IP because operators usually mean
// "the switches in THIS fabric" when they name a fabric.
//
// Leading underscore is convention only — it's exported and consumed
// by App.tsx + other detectors here. Underscores don't enforce
// anything; treat them as documentation.
export function _extractScope(text: string): { scopeName?: string; scopeIp?: string; scopeFabric?: string } {
  // Fabric scope first — explicit "fabric <name>" keyword.
  const fabricMatch = text.match(/\bfabric\s+([A-Za-z][A-Za-z0-9_-]{1,40})\b/i);
  if (fabricMatch) return { scopeFabric: fabricMatch[1] };
  // IPv4 scope.
  const ipMatch = text.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  if (ipMatch) return { scopeIp: ipMatch[1] };
  // Switch-name scope — "for/of/on/in <candidate>".
  //
  // Two filters here, learned from operator-reported bug where
  // "show serial numbers of optics" was wrongly scoped to a switch
  // named "optics":
  //  1) Common-noun blacklist — words that appear in NL phrases like
  //     "of optics" / "of switches" / "of fabric" but are never real
  //     switch names.
  //  2) Switch-name shape — real SLX switch names virtually always
  //     contain a digit or dash (Spine-1, Leaf-2, BorderLeaf-3,
  //     dc-spine-01). Plain dictionary words don't. Requiring this
  //     pattern catches future bait words that aren't in our
  //     blacklist.
  //
  // Scan ALL "for/of/on/in <X>" matches, not just the first. Prompts
  // like "what's on port 0/50 on leaf-3" have TWO "on" candidates —
  // "port" (common-noun reject) and "leaf-3" (valid). Stopping at the
  // first match would reject "port" and return empty, so the widget
  // would probe every switch instead of just leaf-3.
  const commonNouns = /^(optics?|media|transceivers?|sfp|qsfp|switches?|fabric|fleet|inventory|serials?|parts?|numbers?|the|all|every|each|chassis|hardware|devices?|ports?|interfaces?|details?)$/i;
  const nameRe = /\b(?:for|of|on|in)\s+([A-Za-z][A-Za-z0-9_-]{1,40})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(text)) !== null) {
    const candidate = m[1];
    if (commonNouns.test(candidate)) continue;
    if (!/[0-9-]/.test(candidate)) continue;
    return { scopeName: candidate };
  }
  return {};
}

// ── Fleet MEDIA inventory intent ─────────────────────────────────────
// Matches NL asking for transceiver serial / part numbers across the
// fleet. This is what "list serial numbers" and "give me part numbers"
// mean in operator vocabulary: the per-port optic data, aggregated
// across every switch. Mirrors the existing single-switch media widget
// but fleet-wide.
//
// Examples that HIT this:
//   "list all serial numbers"
//   "give me part numbers"
//   "all media serials"
//   "show transceiver inventory"
//   "media inventory across fabric"
//   "serial numbers for Spine-1"    ← scope pre-fills the filter
//
// Examples that do NOT hit (they fall through to chassis intent):
//   "list switches"
//   "fleet inventory"
//   "switch inventory"
//   "chassis inventory"
export function detectFleetMediaInventoryIntent(text: string): {
  matched: boolean; scopeName?: string; scopeIp?: string; scopeFabric?: string;
} {
  const t = text.trim().toLowerCase();
  if (!t) return { matched: false };
  // Strong signals — direct mentions of transceiver / media / optic
  // plus the "list / show" verb context. These win regardless of
  // chassis-style phrases below.
  // Include plural forms — "transceivers" / "optics". Without
  // `transceivers?` the plural slips past the detector and the server's
  // LLM fallback picks inventory_get_switches_widget_table (closest name
  // match in the catalog). Both layers mirror.
  const mediaSignal = /\b(media|transceivers?|optics?|sfp|qsfp)\b/.test(t);
  // "serial" / "part number" without an explicit "switch"/"chassis"
  // qualifier — operators mean the per-port data when they say this
  // in a network context.
  const serialPartSignal = (
    /\b(serial|s\/n|sn)\s*(number|numbers|#)?\b/.test(t) ||
    /\bpart\s*(number|numbers|#)\b/.test(t)
  );
  // Explicit chassis-qualifier suppresses media match so
  // "chassis serial" / "serial for switches" routes to the chassis
  // widget instead.
  //
  // Also catch reverse word order — "serial number(s) for/of/across
  // switch(es)" / "part numbers for chassis". Without it, "show serial
  // numbers for switches" routes to media (the per-port transceiver
  // widget), which is the wrong altitude.
  const chassisQualifier = (
    // Forward order: "chassis serial", "switch serials" (plural — s?),
    // "hardware inventory".
    /\b(chassis|switch(?:es)?|hardware)\s+(serial|part|inventory)s?\b/.test(t) ||
    // Reverse order: "serial number(s) for switches", "part for all
    // chassis". `number(?:s|\(s\))?` tolerates literal "(s)"
    // parenthesized plural some operators type; harmless when absent.
    // `serial|part` also takes `s?` suffix so "serials for switches"
    // works.
    /\b(serial|part)s?\s*(?:number(?:s|\(s\))?|#)?\s+(?:for|of|across|in)\s+(?:all\s+|every\s+)?(switch(?:es)?|chassis|hardware|fleet)\b/.test(t)
  );
  if (chassisQualifier) return { matched: false };
  if (!mediaSignal && !serialPartSignal) return { matched: false };
  // Quality gate — require either a verb or a fleet-scope hint to
  // avoid matching unrelated mentions of the word "serial".
  const verb = /\b(list|give|show|provide|export|fetch|get|display|dump)\b/.test(t);
  const fleetHint = /\b(all|every|each|across|fleet|fabric|switches)\b/.test(t);
  if (!verb && !fleetHint) return { matched: false };
  return { matched: true, ..._extractScope(text) };
}

// ── Search-by-serial intent ──────────────────────────────────────────
// Catches operator prompts like "find switch with serial 1950Q-30014"
// / "which switch has sn FLN4318Q001" / "where is serial EXG3650A123".
// Field requested this because support tickets often arrive with just
// a serial — operator needs to map it back to hostname/IP/fabric to
// start triage.
//
// Returns matched + the extracted serial token. Caller opens the
// FleetInventoryWidget with initialFilter set — the widget's existing
// free-text filter already searches the serial column (line ~88 of
// FleetInventoryWidget.tsx), so the row falls right out.
//
// Token shape: SLX/9540 serials are typically [A-Z0-9]+ with an
// optional `-NNNN` suffix (e.g. "1950Q-30014", "FLN4318Q001",
// "EXG3650A123"). Conservative regex: at least 4 alphanumeric chars,
// optional dash + more alphanumeric. Lowercase too (operators paste
// in any case).
export function detectSerialSearchIntent(text: string): { matched: boolean; serial?: string } {
  const t = text.trim();
  if (!t) return { matched: false };
  // Verb signal: "find / where / which / locate" + "switch / device"
  // optional.
  const verbSignal = /\b(find|where(?:'?s| is)?|which|locate|identify|lookup|search)\b/i.test(t);
  if (!verbSignal) return { matched: false };
  // Serial keyword + value. Accept `serial`, `s/n`, `sn`. Match the
  // token after the keyword (allow optional `=` / `:` / whitespace).
  const m = t.match(/\b(?:serial(?:\s*number)?|s\/n|sn)\s*[:=#]?\s*([A-Za-z0-9][A-Za-z0-9\-_.]{3,})\b/i);
  if (!m) return { matched: false };
  // Reject pure numeric-only tokens (likely "all 8 sn 0" noise) and
  // common-noun follow-ups ("serial number for" — caller will route
  // via detectFleetInventoryIntent / media detector instead).
  const value = m[1];
  if (/^\d+$/.test(value)) return { matched: false };
  if (/^(number|numbers|for|of|in|across|the|all|every|fleet|switch|switches)$/i.test(value)) {
    return { matched: false };
  }
  return { matched: true, serial: value };
}

// ── Fleet chassis inventory intent ───────────────────────────────────
// Explicit "fleet inventory" / "switch listing" / "list switches" /
// "chassis inventory" phrases route here. The MEDIA detector above
// runs FIRST, so any query that smells like serial / part numbers
// goes to media (correct operator interpretation).
export function detectFleetInventoryIntent(text: string): {
  matched: boolean; scopeName?: string; scopeIp?: string; scopeFabric?: string;
} {
  const t = text.trim().toLowerCase();
  if (!t) return { matched: false };
  // "list switches" / "show switches" intentionally NOT matched here
  // — those route to the existing donut + small-table viz block (a
  // nicer visual representation than the table widget here). Reserve
  // this detector for explicit "fleet inventory" / "chassis
  // inventory" phrases that operators use when they want the full
  // sortable + exportable table.
  // Serial/part number for switch(es) — explicit chassis context.
  // The media detector above already rejects these via its
  // chassisQualifier gate, so they fall through to this detector.
  // Catches "show serial numbers for switches" / "serial for all
  // switches" / "part numbers for chassis" — chassis serials are
  // operator's intent here, not transceiver serials. Mirrored on
  // the server (deterministic.py).
  const serialForSwitches = (
    /\b(chassis|switch(?:es)?|hardware)\s+(serial|part)s?\b/.test(t) ||
    /\b(serial|part)s?\s*(?:number(?:s|\(s\))?|#)?\s+(?:for|of|across|in)\s+(?:all\s+|every\s+)?(switch(?:es)?|chassis|hardware|fleet)\b/.test(t)
  );
  const subject = (
    /\b(fleet|chassis|hardware)\s+inventory\b/.test(t) ||
    // Reverse word order — "inventory chassis info" / "inventory
    // fleet" / "inventory hardware report".
    // Without this, the server falls through to LLM and picks
    // inventory_get_chassis_info_bulk (which 400s without
    // device_ids). Mirrors the deterministic.py rule.
    /\binventory\s+(fleet|chassis|hardware)(?:\s+(info|information|report|export))?\b/.test(t) ||
    /\binventory\s+(of\s+switches|report|export)\b/.test(t) ||
    serialForSwitches
  );
  if (!subject) return { matched: false };
  return { matched: true, ..._extractScope(text) };
}

// ── XCO Health intent ────────────────────────────────────────────────
// Matches NL queries that should open the XCO Health admin panel and
// auto-fire the firmware_orchestration probe. Short-circuits the NL
// chain so the LLM router can't misinterpret "xco" as a VRF query
// (which happened during Phase 1 testing).
//
// Mirrored on the server in nl/deterministic.py as a defence-in-depth
// route — both layers must stay in sync (see MEMORY: NL routing two
// layers).
export function detectXcoHealthIntent(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  // "xco" + health/healthy/status/probe/service
  if (/\bxco\b/.test(t) && /\b(health|healthy|status|probe|service|services|wedge|stuck)\b/.test(t)) return true;
  // "probe xco" / "check xco" / "test xco"
  if (/\b(probe|check|test|verify)\b.*\bxco\b/.test(t)) return true;
  // Firmware-orchestration probe specifically
  if (/\b(probe|check|test)\b.*\bfirmware[\s_-]?orchestration\b/.test(t)) return true;
  if (/\bfirmware[\s_-]?orchestration\s+probe\b/.test(t)) return true;
  return false;
}

/**
 * Detect "edit tenant X" / "modify tenant X" / "configure tenant X" /
 * "update tenant X" intents and extract the tenant name. Opens the
 * TenantEditorPanel.
 *
 * The verb set is intentionally narrow — NOT including "show",
 * "list", "delete", "create" — those go to existing tenant flows.
 * "Update" alone IS ambiguous with "update vlan range of X" / "update
 * vrf quota for X" — those phrases are routed by their per-op
 * detectors elsewhere in this file (or the server-side router).
 * The editor's "update tenant X" verb is the GENERIC fallback that
 * means "open the editor; I'll pick the action there."
 *
 * Tenant name extraction:
 *   - "<verb> tenant <name>"
 *   - "<verb> <name> tenant"
 * Name accepts letters/digits/underscore/hyphen (matches XCO's
 * tenant-name constraints) up to 40 chars.
 *
 * Returns { matched: true, tenantName } on hit. tenantName may be ""
 * if the operator typed bare "edit tenant" with no name — caller
 * (App.tsx) treats that as "show me which tenants exist first".
 */
export function detectEditTenantIntent(text: string): { matched: boolean; tenantName: string } {
  const t = text.trim();
  if (!t) return { matched: false, tenantName: "" };
  // verb + (the )? + tenant(s) + name?
  // NOTE: tenant**s?** — the plural form ("edit tenants") is the
  // bare-verb case (no specific name); fall through to the picker.
  // Originally the regex required singular, which let "edit tenants"
  // fall to the LLM router that picked tenant_get_all_endpoint_groups.
  const m1 = t.match(/\b(edit|modify|configure|update)\s+(?:the\s+)?tenants?(?:\s+([A-Za-z0-9_-]{1,40}))?\b/i);
  if (m1) {
    // Disambiguate "update VLAN range" / "update VRF quota" — those
    // have a noun between "update" and "tenant" so the regex above
    // won't match them. But "update tenant X vlan range" CAN match here
    // — punt that to the per-op detector by rejecting if the prompt
    // mentions vlan-range / vrf-quota after the tenant name. Per-op
    // wins because it knows the specific operation.
    const tail = t.slice(m1.index! + m1[0].length).toLowerCase();
    if (/\b(vlan[-\s]?range|vrf[-\s]?quota|num[-\s]?of[-\s]?vrf|vlan[-\s]?range\s+for)\b/.test(tail)) {
      return { matched: false, tenantName: "" };
    }
    return { matched: true, tenantName: (m1[2] ?? "").trim() };
  }
  // "<verb> <name> tenant" reverse word order (singular only — "X tenants"
  // doesn't make grammatical sense for naming a specific tenant)
  const m2 = t.match(/\b(edit|modify|configure)\s+([A-Za-z0-9_-]{1,40})\s+tenant\b/i);
  if (m2) return { matched: true, tenantName: m2[2].trim() };
  return { matched: false, tenantName: "" };
}
