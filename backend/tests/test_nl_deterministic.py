# Unit tests for nl/deterministic.py — ROUTES table + RESTCONF dispatch + intent detection.
#
# This is the deterministic fast path of /api/nl: regex match → tool name,
# zero LLM cost. Worth testing because the ROUTES table is the document of
# what NL queries map to what tools. A test failure here means we silently
# broke a known query pattern.
#
# Run via:
#     cd backend && .venv/bin/python -m pytest tests/test_nl_deterministic.py -v
#
# No service required.

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from nl.deterministic import (
    ROUTES,
    RESTCONF_TOOLS,
    is_restconf_intent,
    is_switch_inventory_intent,
    pick_restconf_tool,
    _GENERIC_HEALTH_TOOLS,
)


def _match_route(text: str):
    """Walk ROUTES in order, return first matching tool name (or None)."""
    for pat, tool in ROUTES:
        if pat.search(text):
            return tool
    return None


# ─── ROUTES — tenants ──────────────────────────────────────────────────

def test_route_tenant_get_details():
    assert _match_route("show tenant Red Zone details") == "tenant_get_tenant"


def test_route_epg_for_tenant_picks_per_tenant_tool():
    """Single-tenant EPG: explicit 'for tenant <name>' → per-tenant tool."""
    assert _match_route("show EPGs for tenant Red Zone") == "tenant_get_endpoint_groups"
    assert _match_route("list endpoint groups in tenant DC") == "tenant_get_endpoint_groups"


def test_route_epg_bare_picks_composite():
    """Bare EPG query (no tenant context) → all-tenants composite."""
    assert _match_route("list all EPGs") == "tenant_get_all_endpoint_groups"
    assert _match_route("show endpoint groups across all tenants") == "tenant_get_all_endpoint_groups"


def test_route_vrfs():
    assert _match_route("list vrfs") == "tenant_get_vrfs"
    assert _match_route("show all VRF") == "tenant_get_vrfs"


def test_route_tenant_health():
    assert _match_route("tenant health") == "tenant_get_health"


def test_route_list_tenants():
    assert _match_route("show tenants") == "tenant_get_tenants"
    assert _match_route("list all tenants") == "tenant_get_tenants"


# ─── ROUTES — mutation phrases must NOT steal read-only rules ──
# A greedy `\btenants?\b` / `\bvrfs?\b` rule would route "tenant delete"
# to tenant_get_tenants (a read list) and "delete vrfs" to tenant_get_vrfs.
# Both wrong — those inputs should fall through to the LLM (or the
# client-side intent detector that runs BEFORE /api/nl is even called).

def test_route_tenant_delete_does_not_steal_read_list():
    """'tenant delete' must NOT route to tenant_get_tenants."""
    assert _match_route("tenant delete") != "tenant_get_tenants"
    assert _match_route("delete tenant") != "tenant_get_tenants"
    assert _match_route("delete tenant lab-test") != "tenant_get_tenants"
    assert _match_route("create tenant new-app") != "tenant_get_tenants"
    assert _match_route("add tenant lab-b") != "tenant_get_tenants"


def test_route_delete_epg_does_not_steal_read_list():
    """'delete epg' / 'remove epgs' must NOT route to tenant_get_all_endpoint_groups."""
    assert _match_route("delete epg") != "tenant_get_all_endpoint_groups"
    assert _match_route("delete epgs") != "tenant_get_all_endpoint_groups"
    assert _match_route("remove epg test4-epg") != "tenant_get_all_endpoint_groups"
    assert _match_route("drop endpoint-group") != "tenant_get_all_endpoint_groups"
    assert _match_route("create epg") != "tenant_get_all_endpoint_groups"
    assert _match_route("add endpoint-group") != "tenant_get_all_endpoint_groups"


def test_route_read_epg_phrases_still_match():
    """Don't over-correct — list/show EPG phrases must still route to the read tool."""
    assert _match_route("list epgs") == "tenant_get_all_endpoint_groups"
    assert _match_route("show all epgs") == "tenant_get_all_endpoint_groups"
    assert _match_route("display endpoint groups") == "tenant_get_all_endpoint_groups"
    assert _match_route("all epgs across tenants") == "tenant_get_all_endpoint_groups"


def test_route_delete_vrfs_does_not_steal_read_list():
    """'delete vrfs' must NOT route to tenant_get_vrfs."""
    assert _match_route("delete vrfs") != "tenant_get_vrfs"
    assert _match_route("delete vrf in tenant lab-a") != "tenant_get_vrfs"
    assert _match_route("remove vrfs from tenant lab-b") != "tenant_get_vrfs"
    assert _match_route("bulk delete vrfs") != "tenant_get_vrfs"
    assert _match_route("create vrf my-vrf") != "tenant_get_vrfs"


def test_route_read_phrases_still_match():
    """Don't over-correct — the original read-phrases must still route."""
    # Tenants — read context preserved.
    assert _match_route("list tenants") == "tenant_get_tenants"
    assert _match_route("show all tenants") == "tenant_get_tenants"
    assert _match_route("which tenants are configured") == "tenant_get_tenants"
    assert _match_route("how many tenants are there") == "tenant_get_tenants"
    assert _match_route("tenants?") == "tenant_get_tenants"
    assert _match_route("tenants") == "tenant_get_tenants"
    # VRFs — read context preserved.
    assert _match_route("list vrfs") == "tenant_get_vrfs"
    assert _match_route("show me the vrfs") == "tenant_get_vrfs"


# ─── ROUTES — fabrics ──────────────────────────────────────────────────

def test_route_fabric_timeline_explicit():
    """'fabric history' → timeline (NOT bare fabric health)."""
    assert _match_route("show fabric DC timeline") == "fabric_get_fabric_health_timeline"
    assert _match_route("fabric history over time") == "fabric_get_fabric_health_timeline"


def test_route_what_happened_past_tense_picks_timeline():
    """Past-tense / recent-activity queries route to timeline."""
    assert _match_route("what happened to lab-b-alex in the last 24h") == "fabric_get_fabric_health_timeline"
    assert _match_route("what changed in fabric DC") == "fabric_get_fabric_health_timeline"


def test_route_show_fabric_X_health():
    assert _match_route("show fabric DC health") == "fabric_get_fabric_health_summary"


def test_route_why_red_fabric():
    """'why is X red/yellow' → fabric health summary."""
    assert _match_route("why is fabric DC red") == "fabric_get_fabric_health_summary"
    assert _match_route("top offenders") == "fabric_get_fabric_health_summary"


def test_route_list_fabrics_health():
    assert _match_route("show fabrics") == "fabric_get_fabrics_health"
    assert _match_route("fabric health") == "fabric_get_fabrics_health"


def test_route_is_fabric_healthy_adjective_form():
    """'is my fabric healthy?' → current-state tool (not timeline)."""
    assert _match_route("is my fabric healthy") == "fabric_get_fabrics_health"
    assert _match_route("are fabrics ok") == "fabric_get_fabrics_health"


# ─── ROUTES — switch inventory ─────────────────────────────────────────

def test_route_switch_inventory():
    assert _match_route("show switch inventory") == "inventory_get_switch_inventory_overview"
    assert _match_route("list all switches") == "inventory_get_switch_inventory_overview"
    assert _match_route("show all devices") == "inventory_get_switch_inventory_overview"


def test_route_whats_running_colloquial():
    """'whats running' = 'what's active', NOT a request for running-config."""
    assert _match_route("what's running") == "inventory_get_switch_inventory_overview"
    assert _match_route("whats up out there") == "inventory_get_switch_inventory_overview"


def test_route_device_health_rollup():
    assert _match_route("device health rollup") == "inventory_get_device_health_rollup"
    assert _match_route("unhealthy devices") == "inventory_get_device_health_rollup"


def test_route_unreachable_devices():
    assert _match_route("unreachable devices") == "inventory_get_unreachable_devices"
    assert _match_route("down devices") == "inventory_get_unreachable_devices"


# ─── ROUTES — system + monitoring ──────────────────────────────────────

def test_route_system_health():
    assert _match_route("is the system healthy") == "system_get_ha_and_node_health_summary"


def test_route_certificates():
    assert _match_route("show certificates expiring") == "system_get_certificates_expiring_soon"
    assert _match_route("cert expiry") == "system_get_certificates_expiring_soon"


def test_route_platform_status():
    assert _match_route("show platform") == "monitor_get_platform_quick_status"
    assert _match_route("platform quick status") == "monitor_get_platform_quick_status"


def test_route_environment_unhealthy_picks_monitor_health():
    assert _match_route("why is the system unhealthy") == "monitor_get_health"
    assert _match_route("what is wrong with the platform") == "monitor_get_health"


def test_route_alarms():
    assert _match_route("show alarms") == "fault_get_active_alarms_top"
    assert _match_route("active alerts") == "fault_get_active_alarms_top"
    assert _match_route("any faults") == "fault_get_active_alarms_top"


def test_route_no_match_returns_none():
    """Random nonsense → no rule matches → None."""
    assert _match_route("flibbertigibbet quux") is None


# ─── is_restconf_intent ────────────────────────────────────────────────

def test_restconf_intent_explicit_keywords():
    assert is_restconf_intent("run restconf get firmware")
    assert is_restconf_intent("query directly")
    assert is_restconf_intent("on the switch")
    assert is_restconf_intent("from the device")


def test_restconf_intent_show_on_ip_pattern():
    assert is_restconf_intent("show bgp on 10.1.1.1")
    assert is_restconf_intent("check interfaces on 192.168.1.5")


def test_restconf_intent_ip_plus_device_context():
    """IP alone + a networking word → RESTCONF intent."""
    assert is_restconf_intent("port stats 10.1.1.1")
    assert is_restconf_intent("10.1.1.1 lldp neighbors")


def test_restconf_intent_ip_without_device_word_no_match():
    """Bare IP, no networking context → not RESTCONF intent."""
    assert not is_restconf_intent("10.1.1.1")
    assert not is_restconf_intent("look at 10.1.1.1")


def test_restconf_intent_empty():
    assert not is_restconf_intent("")
    assert not is_restconf_intent(None)


# ─── pick_restconf_tool ────────────────────────────────────────────────

def test_pick_restconf_lldp():
    assert pick_restconf_tool("show lldp neighbors") == "restconf_get_lldp_neighbor_detail"
    assert pick_restconf_tool("topology view") == "restconf_get_lldp_neighbor_detail"


def test_pick_restconf_port_stats():
    assert pick_restconf_tool("show port statistics") == "restconf_get_port_statistics_summary"
    assert pick_restconf_tool("traffic counters") == "restconf_get_port_statistics_summary"


def test_pick_restconf_ip_interface():
    assert pick_restconf_tool("show ip interface") == "restconf_get_ip_interface"
    assert pick_restconf_tool("show ip addresses on switch") == "restconf_get_ip_interface"


def test_pick_restconf_interface_all():
    """'all interfaces' / 'interface brief' → bulk listing tool."""
    assert pick_restconf_tool("show all interfaces") == "restconf_get_interface_all"
    assert pick_restconf_tool("how many ports") == "restconf_get_interface_all"
    assert pick_restconf_tool("show interfaces brief") == "restconf_get_interface_all"


def test_pick_restconf_media():
    """Note: the regex is `\\btransceiver\\b` (no plural) — 'transceivers'
    falls through. Test uses the singular form."""
    assert pick_restconf_tool("optic info") == "restconf_get_media_detail"
    assert pick_restconf_tool("show transceiver") == "restconf_get_media_detail"
    assert pick_restconf_tool("show sfp") == "restconf_get_media_detail"


def test_pick_restconf_arp_vlan_vrf():
    assert pick_restconf_tool("show arp") == "restconf_get_arp_table"
    assert pick_restconf_tool("show vlans") == "restconf_get_vlan_brief"
    assert pick_restconf_tool("show vrf") == "restconf_get_vrf_summary"


def test_pick_restconf_firmware_version():
    assert pick_restconf_tool("show firmware") == "restconf_show_firmware_version"
    assert pick_restconf_tool("os version") == "restconf_show_firmware_version"
    assert pick_restconf_tool("uptime") == "restconf_show_firmware_version"


def test_pick_restconf_routing_falls_through_to_running_config():
    """No dedicated RESTCONF tool for BGP/OSPF — running-config is the
    catch-all. Note: routes are walked in order, and the LLDP rule
    matches the word 'neighbor'/'neighbors' first — so 'show bgp
    neighbors' hits LLDP, not routing. Tests use 'summary' phrasings
    that avoid the LLDP keyword."""
    assert pick_restconf_tool("show bgp summary") == "restconf_get_running_config"
    assert pick_restconf_tool("ospf routes") == "restconf_get_running_config"
    assert pick_restconf_tool("multicast configuration") == "restconf_get_running_config"


def test_pick_restconf_clock():
    assert pick_restconf_tool("show clock") == "restconf_get_clock"
    assert pick_restconf_tool("ntp time") == "restconf_get_clock"


def test_pick_restconf_safe_default_when_no_topic_matches():
    """No topic regex matches → running-config (safe catch-all)."""
    assert pick_restconf_tool("xyzzy nothing matches") == "restconf_get_running_config"


# ─── is_switch_inventory_intent ────────────────────────────────────────

def test_switch_inventory_intent_explicit_words():
    assert is_switch_inventory_intent("show switches")
    assert is_switch_inventory_intent("inventory")
    assert is_switch_inventory_intent("list devices")


def test_switch_inventory_intent_model_signals():
    assert is_switch_inventory_intent("show me SLX 9250")
    assert is_switch_inventory_intent("EXOS switches")
    assert is_switch_inventory_intent("leaf switches")


def test_switch_inventory_intent_ip_alone_does_not_trigger():
    """'show ip addresses' without 'switch/device/inventory' → NOT inventory intent."""
    assert not is_switch_inventory_intent("show ip addresses")


def test_switch_inventory_intent_ip_with_switch_does_trigger():
    """'ip addresses of switches' → inventory intent (the safe ambiguity)."""
    assert is_switch_inventory_intent("show ip addresses of switches")


def test_switch_inventory_intent_empty():
    assert not is_switch_inventory_intent("")
    assert not is_switch_inventory_intent(None)


# ─── Registry / constants sanity ───────────────────────────────────────

def test_restconf_tools_has_expected_set():
    """The RESTCONF_TOOLS set holds the tool names extract_inputs
    consults for switch_ip injection — bump this count when adding a
    new restconf_* tool."""
    assert len(RESTCONF_TOOLS) == 15
    # Spot-check a few critical ones
    assert "restconf_show_firmware_version" in RESTCONF_TOOLS
    assert "restconf_get_lldp_neighbor_detail" in RESTCONF_TOOLS
    assert "restconf_get_running_config" in RESTCONF_TOOLS


def test_generic_health_tools_set():
    """The guardrail's 'over-selected' tool set."""
    assert "monitor_get_health" in _GENERIC_HEALTH_TOOLS
    assert "monitor_get_platform_quick_status" in _GENERIC_HEALTH_TOOLS
    assert "system_get_ha_and_node_health_summary" in _GENERIC_HEALTH_TOOLS


def test_routes_table_nonempty_and_well_formed():
    """Every ROUTES entry should be (compiled-regex, str). Catches future
    accidental entries that aren't compiled patterns."""
    import re
    assert len(ROUTES) >= 20
    for pat, tool in ROUTES:
        assert isinstance(pat, re.Pattern), f"Non-compiled pattern for tool={tool!r}"
        assert isinstance(tool, str) and tool, f"Bad tool name in routes: {tool!r}"


