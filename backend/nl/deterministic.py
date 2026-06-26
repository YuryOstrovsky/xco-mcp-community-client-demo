"""
Deterministic NL routing — regex tables + intent detectors.

The fast path of the /api/nl router: match the user's text against a
prioritized list of regex patterns and emit a tool name. Zero LLM cost,
predictable, debuggable.

What lives here:
  - ROUTES: ordered (pattern, tool) tuples for general NL queries
  - RESTCONF_TOOLS + _RESTCONF_TOPIC_ROUTES + pick_restconf_tool +
    is_restconf_intent: device-direct query detection and dispatch
  - is_switch_inventory_intent: inventory-overview heuristic (used by
    the post-NL guardrail in main.py to recover from over-eager LLM picks)
  - _GENERIC_HEALTH_TOOLS: the set of tools the guardrail considers
    "over-selected by NL for anything status/health"

What does NOT live here:
  - The /api/nl endpoint handler itself — that's orchestration that mixes
    pure-NL helpers with the live MCP adapter (`invoke_tool`, the tools
    cache). It stays in main.py.
  - `pick_tool_deterministic` — needs the live `_TOOLS_CACHE` from main
    for the bare-tool-name shortcut. Stays in main.py and imports ROUTES
    + is_restconf_intent + pick_restconf_tool from this module.
  - `extract_inputs` — couples to `RESTCONF_TOOLS` (imported from here)
    but also to a bunch of fabric/tenant entity extraction.
"""

from __future__ import annotations

import re
from typing import List, Tuple


# -----------------------------
# General NL → tool routes
# -----------------------------
# Ordering is significant: more-specific patterns must come before more-
# general ones (e.g. "fabric timeline" must beat the generic "fabric health"
# rule). Each entry is (compiled-regex, tool-name).
ROUTES: List[Tuple[re.Pattern, str]] = [
    # ── Fleet inventory (serial / part numbers) ──────────────────────────────
    # Catches NL like "list all serial numbers", "give me part numbers",
    # "fleet inventory". Mirrors App.tsx::detectFleetInventoryIntent — both
    # layers stay in sync per MEMORY: "NL routing has TWO layers — fix both".
    # Routes to `inventory_getswitches` (fleet-wide, no required args). The
    # FleetInventoryWidget renders + supports CSV export + per-switch filter.
    # Serial / part number queries — clear intent for the chassis widget.
    # Negative lookahead skips "optics/media/transceiver/sfp/qsfp" queries:
    # those are per-port serials, handled by the client's media-widget
    # detector. Without this exclusion, "show serial numbers of optics"
    # routed here and returned raw JSON (no widget adapter for
    # inventory_getswitches). Mirrored on the client in
    # App.tsx::_extractScope's common-noun blacklist.
    (re.compile(r"^(?!.*\b(optics?|media|transceivers?|sfp|qsfp)\b).*\b(list|give|show|provide|export|fetch|get|display|dump)\b.{0,40}\b(serial|s/n|sn|part)\s*number(s)?\b", re.I | re.S), "inventory_getswitches"),
    (re.compile(r"^(?!.*\b(optics?|media|transceivers?|sfp|qsfp)\b).*\b(serial|part)\s*number(s)?\b.{0,40}\b(for|of|across|in)\s+(all|every|fleet|fabric|switches?)\b", re.I | re.S), "inventory_getswitches"),
    # Fleet / chassis / hardware inventory — but NOT "switch inventory" which
    # is already routed to inventory_get_switch_inventory_overview by an
    # existing route. Keep the "switch" alternative out to avoid shadowing.
    # Reverse word order ("inventory chassis [info]" / "inventory fleet" /
    # "inventory hardware") is matched too. Without it, the LLM fallback
    # picks `inventory_get_chassis_info_bulk` for "inventory chassis info" —
    # which requires `device_ids[]` and 400s when called without them. The
    # bulk tool is internal-only (FleetInventoryWidget supplies device_ids
    # after fetching them from inventory_getswitches); never call it from
    # raw NL.
    (re.compile(r"\b(fleet|chassis|hardware)\s+inventory\b", re.I), "inventory_getswitches"),
    (re.compile(r"\binventory\s+(fleet|chassis|hardware)(?:\s+(info|information|report|export))?\b", re.I), "inventory_getswitches"),
    (re.compile(r"\binventory\s+(of\s+switches|report|export)\b", re.I), "inventory_getswitches"),

    # ── xco_health ───────────────────────────────────────────────────────────
    # MUST come first. Without this, the LLM router happily picks
    # `restconf_get_vrf_summary` when an operator types "is xco healthy".
    # The matching mirror lives in App.tsx::detectXcoHealthIntent — NL
    # routing has TWO layers, so keep both in sync.
    # Note: this routes to `list_xco_probes` (cheap, no required args) so
    # the LLM has a non-VRF fallback path. The UI dispatch uses
    # `force_tool: run_xco_probe` + `force_inputs: {probe_name: ...}`
    # to actually run a probe; the deterministic ROUTES table can't
    # supply those args, so it picks the metadata-only tool instead.
    (re.compile(r"\bxco\b.{0,40}\b(health|healthy|status|probe|service|services|wedge|stuck)\b", re.I), "list_xco_probes"),
    (re.compile(r"\b(probe|check|test|verify)\b.{0,40}\bxco\b", re.I), "list_xco_probes"),
    (re.compile(r"\b(probe|check|test)\b.{0,40}\bfirmware[\s_-]?orchestration\b", re.I), "list_xco_probes"),
    # Tenants
    (re.compile(r"\b(show|get)\s+tenant\s+.+\b(details?|info|summary)\b", re.I), "tenant_get_tenant"),
    # EPG term: epg(s), endpoint group(s), end point group(s), endpointgroup(s), endpoint-group(s)
    # Single-tenant EPG: only when an explicit "for/in tenant <name>" appears near the EPG term.
    # Must come BEFORE the composite catch-all below.
    (re.compile(
        r"\b(?:epgs?|endpoint[\s\-]?groups?|end[\s\-]?point[\s\-]?groups?|endpointgroups?)\b.{0,60}(?:for|in)\s+tenant\b"
        r"|\b(?:for|in)\s+tenant\b.{0,60}\b(?:epgs?|endpoint[\s\-]?groups?|end[\s\-]?point[\s\-]?groups?|endpointgroups?)\b",
        re.I,
    ), "tenant_get_endpoint_groups"),
    # Composite (all tenants): any other EPG mention — verb+EPG, all/every EPG.
    # The final "bare EPG mention" alternative is anchored with `^` + a
    # negative lookahead so mutation phrases like "delete epg" / "create
    # epg" don't get stolen for the read tool. Those are caught by the
    # client-side delete_epg / create_epg intents respectively.
    (re.compile(
        r"\b(?:list|show|get|fetch|gather|display|find)\s+(?:(?:me|us|the)\s+)?(?:all\s+|every\s+)?(?:epgs?|endpoint[\s\-]?groups?|end[\s\-]?point[\s\-]?groups?|endpointgroups?)\b"
        r"|\b(?:all|every)\s+(?:epgs?|endpoint[\s\-]?groups?|end[\s\-]?point[\s\-]?groups?|endpointgroups?)\b"
        r"|\b(?:epgs?|endpoint[\s\-]?groups?|end[\s\-]?point[\s\-]?groups?|endpointgroups?)\s+(?:across|for|in)\s+all\b"
        r"|\b(?:epgs?|endpoint[\s\-]?groups?|end[\s\-]?point[\s\-]?groups?|endpointgroups?)\s+in\s+(?:the\s+)?(?:system|all\s+tenants?|every\s+tenant)\b"
        r"|^(?!.*\b(?:delete|remove|drop|purge|bulk[\s\-]?delete|create|add|new|provision|deploy|make)\b).*\b(?:epgs?|endpoint[\s\-]?groups?|end[\s\-]?point[\s\-]?groups?|endpointgroups?)\b",
        re.I,
    ), "tenant_get_all_endpoint_groups"),  # now routed to tier2 server
    # VRFs — read-only list, but only when there's NO mutation verb in
    # the input. "delete vrfs" / "remove vrfs" / "tenant delete vrf"
    # should hit the client-side delete_vrfs intent (which opens
    # DeleteVrfsModal); same for create. If they somehow reach this
    # server-side router, falling through to the LLM is better than
    # stealing the input for the read tool.
    # (A bare \bvrfs?\b rule would match "delete vrfs" and route it to
    # tenant_get_vrfs, an unhelpful read list — the lookahead prevents that.)
    # Anchored with ^ so the negative lookahead scans the full input.
    (re.compile(
        r"^(?!.*\b(?:delete|remove|drop|purge|bulk[\s\-]?delete|create|add|new)\b).*\bvrfs?\b",
        re.I,
    ), "tenant_get_vrfs"),
    (re.compile(r"\btenant\s+health\b|\bhealth\s+of\s+tenants?\b", re.I), "tenant_get_health"),
    # Tenants — same pattern. Only route to the read list when the verb is
    # list/show/get/which/what — NOT delete/remove/create/add/new.
    # A bare \btenants?\b rule would catch "tenant delete" and route it to
    # tenant_get_tenants. The mutation-verb negative lookahead prevents
    # that — those phrases either get handled client-side (delete_vrfs /
    # create_epg / create_portchannel intents) or fall through to the LLM
    # for proper disambiguation.
    (re.compile(
        r"\b(?:list|show|get|which|what|how\s+many)\s+(?:all\s+|the\s+|my\s+)?tenants?\b"
        r"|^\s*tenants?\s*\??\s*$",  # bare "tenants" or "tenants?" alone
        re.I,
    ), "tenant_get_tenants"),

    # Fabrics (more specific first)
    # Historical view — explicit "timeline" / "history" / "over time" lands
    # on the timeline tool. Must come BEFORE the general fabric-health rules
    # below (which would otherwise swallow "fabric health timeline" via
    # the bare \bfabric\s+health\b regex).
    (re.compile(r"\bfabric\b.*\b(?:timeline|history|over\s+time|chronological|past\s+(?:hour|day|week|month))\b|\b(?:timeline|history)\s+(?:of\s+)?(?:my\s+|the\s+)?fabric", re.I), "fabric_get_fabric_health_timeline"),
    # Past-tense "what happened" / "what changed" / recent-activity questions —
    # operator wants a chronological view ("what happened to lab-b-alex in
    # the last 24h?"). Falls through to the timeline tool with fabric name
    # + window extracted by extract_inputs() below.
    (re.compile(r"\bwhat\s+(?:happened|changed|occurred|went\s+wrong)\b|\b(?:recent|past|last)\s+(?:activity|changes|events|history)\s+(?:on|in|for|to|of|with)\b|\bactivity\s+(?:on|for|in)\b.*\b(?:fabric|site|over\s+the)", re.I), "fabric_get_fabric_health_timeline"),
    (re.compile(r"\b(show|get)\s+fabric\s+.+\s+health\b", re.I), "fabric_get_fabric_health_summary"),
    # "why is DC red/yellow" — user names the fabric but omits the word "fabric"
    (re.compile(r"\bwhy\b.{1,60}\b(red|yellow|degraded)\b|\btop\s+offenders\b", re.I), "fabric_get_fabric_health_summary"),
    (re.compile(r"\bwhy\b.*\bfabric\b.*\b(red|yellow)\b", re.I), "fabric_get_fabric_health_summary"),
    (re.compile(r"\b(show|list)\s+fabrics?\b", re.I), "fabric_get_fabrics_health"),
    (re.compile(r"\bfabrics?\s+health\b|\bfabric\s+health\b|\bhow\s+is\s+my\s+fabric\s+doing\b", re.I), "fabric_get_fabrics_health"),
    # Adjective forms — "is my fabric healthy?", "are fabrics ok?", etc.
    # Without this rule the LLM fallback picked fabric_get_fabric_health_timeline
    # (a historical view) because the prompt-vs-tool-name overlap was strongest
    # there. Catching the adjective forms deterministically routes to the
    # current-state tool, which is what the present-tense question is asking.
    (re.compile(r"\b(?:is|are)\s+(?:my\s+|the\s+|all\s+)?fabrics?\s+(?:healthy|ok|fine|good|alright)\b", re.I), "fabric_get_fabrics_health"),

    # Switch inventory
    (re.compile(r"\b(switch\s+inventory|inventory\s+switch(es)?|show\s+(?:all\s+)?switch(es)?|list\s+(?:all\s+)?switch(es)?|(?:show|list|get|display)\s+(?:(?:a\s+|the\s+)?list\s+of\s+)?ip\s+address(?:es)?|show\s+all\s+devices?|device\s+inventory|(?:show|get|list)\s+inventory|inventory\s+overview)\b", re.I), "inventory_get_switch_inventory_overview"),
    # Colloquial "what's up / what's running" — operator-speak for "what's
    # active in my environment", NOT a request for device running-config.
    # Without this rule the LLM picks inventory_get_running_config because
    # of literal "running" overlap, and that tool's output is unstructured
    # CLI dumps with no widget. Route to the inventory overview instead.
    # `whats?` matches both "what" and "whats" (informal — no apostrophe);
    # `what's` matches the apostrophe form; `what is/are` are the formal forms.
    (re.compile(r"\b(?:whats?|what's|what\s+is|what\s+are)\s+(?:running|up|online|active|alive|happening)\b|\b(?:whats?|what's|what\s+is)\s+(?:going\s+on|out\s+there)\b", re.I), "inventory_get_switch_inventory_overview"),
    # Inventory / device health
    (re.compile(r"\b(device\s+health\s+rollup|health\s+rollup|unhealthy\s+devices?)\b", re.I), "inventory_get_device_health_rollup"),
    (re.compile(r"\bunreachable\s+devices?\b|\bdown\s+devices?\b", re.I), "inventory_get_unreachable_devices"),

    # L3 routing — bare "bgp" / "show bgp" / "router bgp" / "bgp status"
    # (fleet-wide, no switch IP) → inventory_get_router_bgp (no inputs needed).
    # With a switch IP, the RESTCONF path (checked earlier) handles it instead.
    # The lookaround guard avoids matching BGP inside a hyphenated name
    # (e.g. a tenant called "BGP-LAB").
    (re.compile(r"(?<![-\w])bgp(?![-\w])", re.I), "inventory_get_router_bgp"),

    # System / monitoring
    (re.compile(r"\b(system\s+healthy|is\s+the\s+system\s+healthy|ha\s+and\s+node\s+health)\b", re.I), "system_get_ha_and_node_health_summary"),
    # Certificates — fixed: \bcert matches 'cert','certs' but NOT 'certif...' so use prefix match;
    # \bexpir\b won't match 'expiring' so drop the trailing \b from expir
    (re.compile(r"\bcertificat|\bcerts?\b|\bexpir", re.I), "system_get_certificates_expiring_soon"),
    # Platform — "show platform" (bare) + "platform quick status" + "platform … status"
    (re.compile(r"\bplatform\s+quick\s+status\b|\bplatform\b.*\bstatus\b|\bshow\s+platform\b|\bplatform\s+overview\b", re.I), "monitor_get_platform_quick_status"),
    # Health / environment problems — extended with "what is wrong" and "what's wrong" variants
    (re.compile(
        r"\b(environment|overall|everything|system|platform|cluster)\b.*\b(unhealthy|down|degraded|problem|issue|wrong)\b"
        r"|\bwhy\b.*\b(unhealthy|down|degraded|problem|issue|wrong)\b"
        r"|\bwhat\b.{0,20}\b(wrong|broken|problem|issue|down|degraded)\b",
        re.I), "monitor_get_health"),
    (re.compile(r"\bhealth\s+detail\b|\bdetailed\s+health\b", re.I), "monitor_get_health_detail"),
    (re.compile(r"\bmonitor\s+health\b|\bhealth\b\s*(overview)?\b", re.I), "monitor_get_health"),

    # Alarms
    (re.compile(r"\balarm|alerts?|faults?\b", re.I), "fault_get_active_alarms_top"),
]


# -----------------------------
# Device-direct (RESTCONF) intent detection + topic dispatch
# -----------------------------

# All known RESTCONF tools (used in guardrails and extract_inputs)
RESTCONF_TOOLS: set = {
    "restconf_show_firmware_version",
    "restconf_get_interface_detail",
    "restconf_list_operations",
    "restconf_get_lldp_neighbor_detail",
    "restconf_get_port_statistics_summary",
    "restconf_get_media_detail",
    "restconf_get_arp_table",
    "restconf_get_clock",
    "restconf_get_vlan_brief",
    "restconf_get_vrf_summary",
    "restconf_get_ip_interface",
    "restconf_get_running_config",
    "restconf_get_system_maintenance_status",
    "restconf_get_system_maintenance_rate_monitoring",
    "restconf_get_interface_all",
}

# Signals that the user wants to query a device DIRECTLY (not via EFA/inventory)
_IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")

# Explicit device-direct keywords (no IP required)
_DIRECT_EXPLICIT_RE = re.compile(
    r"\b(restconf|directly?|on\s+(?:the\s+)?switch|from\s+(?:the\s+)?switch|from\s+(?:the\s+)?device)\b",
    re.I,
)

# "show/get/check/display <anything> on <IP>"  e.g. "show bgp on 10.1.1.1"
_SHOW_ON_IP_RE = re.compile(
    r"\b(show|get|check|display|fetch|query|run|list)\b.{1,60}\bon\s+" + r"\d{1,3}(?:\.\d{1,3}){3}\b",
    re.I,
)

# Device-context words — used together with a bare IP to confirm device-direct intent
# (broad: covers any networking term a user might name alongside an IP address)
_DEVICE_CONTEXT_RE = re.compile(
    r"\b(switch|router|device|node|port|interface|vlan|arp|lldp|bgp|ospf|isis|mpls|"
    r"firmware|optics?|transceivers?|sfp|qsfp|media|dom|clock|ntp|vrf|route|routing|"
    r"running\s*config|config|maintenance|neighbor|topology|mac|spanning.?tree|"
    r"stp|bfd|pim|igmp|multicast|acl|qos|counters?|statistic|traffic|bandwidth|"
    r"uptime|cpu|memory|version|hardware|chassis|serial)\b",
    re.I,
)

def is_restconf_intent(text: str) -> bool:
    """True when the user clearly wants to query a device directly via RESTCONF.

    Triggers on any of:
      - explicit keywords: 'restconf', 'directly', 'on (the) switch', 'from the device'
      - pattern: show/get/check … on <IP>  (e.g. "show bgp on 10.1.1.1")
      - IP address present AND at least one networking/device-context word
    """
    if not text:
        return False
    if _DIRECT_EXPLICIT_RE.search(text):
        return True
    if _SHOW_ON_IP_RE.search(text):
        return True
    if _IP_RE.search(text) and _DEVICE_CONTEXT_RE.search(text):
        return True
    return False


# Topic → RESTCONF tool dispatch (most-specific first within each topic)
_RESTCONF_TOPIC_ROUTES: List[Tuple[re.Pattern, str]] = [
    # LLDP / neighbors / topology
    (re.compile(r"\blldp\b|\bneighbor(s)?\b|\btopology\b|\bconnected\s+devices?\b", re.I),
     "restconf_get_lldp_neighbor_detail"),
    # Interfaces / ports — detailed first, then statistics, then IP
    (re.compile(r"\b(port\s+stat(istic)?s?|traffic|error\s+counter|rx|tx|bandwidth|utilization)\b", re.I),
     "restconf_get_port_statistics_summary"),
    (re.compile(r"\b(interface\s+detail|detailed\s+interface|interface\s+status|interface\s+counter)\b", re.I),
     "restconf_get_interface_detail"),
    (re.compile(r"\bip\s+interface\b|\binterface\s+ip\b|\bip\s+addr(ess(es)?)?\b", re.I),
     "restconf_get_ip_interface"),
    # Interface inventory / summary — all interfaces with active/shutdown counts
    # Also catches "interface brief" / "interfaces brief" (Cisco-style brief listing = summary view)
    (re.compile(r"\b(all\s+interfaces?|interface\s+inventor|how\s+many\s+(ports?|interfaces?)|active\s+vs\s+shutdown|shutdown\s+vs\s+active|port\s+inventor|interface\s+summar|interface\s+list|interfaces?\s+brief|brief\s+interfaces?)\b", re.I),
     "restconf_get_interface_all"),
    (re.compile(r"\binterface(s)?\b|\bport(s)?\b", re.I),
     "restconf_get_interface_detail"),
    # Media / optics / transceivers — plural-aware so "transceivers" matches
    # as well as bare "transceiver" (otherwise it falls to the LLM, which
    # picks the wrong tool). Also includes qsfp.
    (re.compile(r"\b(optics?|transceivers?|sfp|qsfp|media|dom)\b", re.I),
     "restconf_get_media_detail"),
    # ARP
    (re.compile(r"\barp\b", re.I),
     "restconf_get_arp_table"),
    # VLANs
    (re.compile(r"\bvlan(s)?\b", re.I),
     "restconf_get_vlan_brief"),
    # VRF
    (re.compile(r"\bvrf(s)?\b", re.I),
     "restconf_get_vrf_summary"),
    # Firmware / OS / version / uptime / CPU / memory
    (re.compile(r"\b(firmware|os\s+version|software\s+version|uptime|cpu|memory|version)\b", re.I),
     "restconf_show_firmware_version"),
    # Routing protocols — no dedicated restconf tool; running-config is the best available
    (re.compile(r"\b(bgp|ospf|isis|mpls|bfd|pim|igmp|multicast|route\s+table|routing\s+table|prefix)\b", re.I),
     "restconf_get_running_config"),
    # Running config / configuration
    (re.compile(r"\b(running[\s\-]?config|configuration|backup)\b", re.I),
     "restconf_get_running_config"),
    # Maintenance
    (re.compile(r"\b(maintenance\s+rate|rate\s+monitor)\b", re.I),
     "restconf_get_system_maintenance_rate_monitoring"),
    (re.compile(r"\bmaintenance\b", re.I),
     "restconf_get_system_maintenance_status"),
    # Clock / time
    (re.compile(r"\b(clock|time|ntp|timestamp)\b", re.I),
     "restconf_get_clock"),
    # Operations / capabilities
    (re.compile(r"\b(operations?|capabilities|rpc|what\s+can)\b", re.I),
     "restconf_list_operations"),
]


def pick_restconf_tool(text: str) -> str:
    """Given text that already passed is_restconf_intent(), return the best RESTCONF tool."""
    for pat, tool in _RESTCONF_TOPIC_ROUTES:
        if pat.search(text or ""):
            return tool
    # Safe default: running-config is the best catch-all when no specific topic matches
    return "restconf_get_running_config"


# -----------------------------
# Guardrails (post-NL sanity routing)
# -----------------------------
_SWITCH_SIGNAL_RE = re.compile(
    r"\b("
    r"switch(es)?|"
    r"inventory|device(s)?|"
    r"ip\s+address(?:es)?|ip\s+addr(?:s)?|"
    r"mac\s+address(?:es)?|"
    r"model|chassis|firmware|"
    r"leaf|spine|"
    r"slx|exos|voss"
    r")\b",
    re.I,
)

_IP_ONLY_RE = re.compile(r"\bip\s+address(?:es)?\b", re.I)
_SWITCH_WORD_RE = re.compile(r"\bswitch(?:es)?\b", re.I)
_INV_WORD_RE = re.compile(r"\binventory\b", re.I)
_DEVICE_WORD_RE = re.compile(r"\bdevices?\b", re.I)


def is_switch_inventory_intent(text: str) -> bool:
    """True when the user is clearly asking about switch/device inventory (incl. IP list).
    We avoid forcing on 'ip addresses' alone to reduce false positives.
    """
    if not text:
        return False
    t = text.strip()
    # If they ONLY said "ip addresses" with no other inventory hint, don't force.
    if _IP_ONLY_RE.search(t) and not (_SWITCH_WORD_RE.search(t) or _INV_WORD_RE.search(t) or _DEVICE_WORD_RE.search(t)):
        return False
    return bool(_SWITCH_SIGNAL_RE.search(t))


# Tools that are commonly over-selected by NL for anything "status/health".
# The /api/nl endpoint's guardrail uses this to detect "model picked a
# generic health tool but the prompt was actually switch inventory" and
# rewrites to inventory_get_switch_inventory_overview.
_GENERIC_HEALTH_TOOLS = {
    "monitor_get_health",
    "monitor_get_platform_quick_status",
    "system_get_ha_and_node_health_summary",
}
