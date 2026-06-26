"""
Pre-loop hooks for agent skills.

Some skills benefit from server-side target resolution BEFORE the loop
starts. This is the same lesson learned from filter_resolved_alarms and
normalize_bgp_summary: when the model misreads obvious data (e.g.,
"lab-b-alex is right there in payload.items but the model says it isn't"),
move enforcement to code. A pre-loop hook returns a string that gets
injected as a system message before the user's query, so the model sees
the resolved target as authoritative context.

Each resolver receives `(query, site, invoke_tool, token)` as keyword
args. `invoke_tool` is bound by the caller (`agent.loop.run_investigation`)
to the live MCP adapter — resolvers don't import from main.py.

Three resolvers ship today:
  - _resolve_target_for_post_upgrade  → post-firmware-upgrade-verification
  - _resolve_for_pre_upgrade_check    → pre-firmware-upgrade-check
                                        (pre-runs firmware_check_storage too)
  - _resolve_for_pre_rma_check        → pre-rma-check
                                        (probes both switches + computes
                                         hardware-fingerprint verdict)

The registry `_PRE_LOOP_HOOKS` maps skill name → resolver; the loop reads
this dict by skill name and calls the registered hook if present.

Extracted from agent/loop.py in task #92. All public symbols re-exported
via agent/__init__.py for back-compat with any direct importer.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List, Optional, Tuple

from .filters import _firmware_storage_pp


def _extract_fabric_names(resp: Any) -> List[str]:
    """Pull fabric names out of a fabric_get_fabrics response, accepting the
    several response shapes the MCP server has returned over time."""
    body = resp
    if isinstance(body, dict) and isinstance(body.get("result"), dict):
        body = body["result"].get("payload", body)
    if isinstance(body, dict) and isinstance(body.get("payload"), dict):
        body = body["payload"]
    fabric_list: List[Any] = []
    if isinstance(body, dict):
        for key in ("items", "fabrics", "groups"):
            v = body.get(key)
            if isinstance(v, list):
                fabric_list = v
                break
    elif isinstance(body, list):
        fabric_list = body
    out: List[str] = []
    for entry in fabric_list:
        if not isinstance(entry, dict):
            continue
        inner = entry.get("fabric") if isinstance(entry.get("fabric"), dict) else entry
        nm = (
            inner.get("fabric-name") or inner.get("name")
            or inner.get("fabric_name") or inner.get("fabricName") or ""
        )
        if isinstance(nm, str) and nm.strip():
            out.append(nm.strip())
    return out


def _extract_switches_per_fabric(resp: Any) -> Dict[str, List[str]]:
    """From an inventory_getswitches response, build {fabric_name: [ip, ip, …]}.
    Switches assigned to no fabric land under '<unassigned>'.

    We need the IPs (not just counts) so the pre-resolver can hand them to
    the agent directly — otherwise the agent has to spend a tool call
    enumerating switches before it can call firmware_check_storage,
    which the model has shown it sometimes skips."""
    body = resp
    if isinstance(body, dict) and isinstance(body.get("result"), dict):
        body = body["result"].get("payload", body)
    if isinstance(body, dict) and isinstance(body.get("payload"), dict):
        body = body["payload"]
    items: List[Any] = []
    if isinstance(body, dict):
        for key in ("items", "switches"):
            v = body.get(key)
            if isinstance(v, list):
                items = v
                break
    elif isinstance(body, list):
        items = body
    result: Dict[str, List[str]] = {}
    for sw in items:
        if not isinstance(sw, dict):
            continue
        fab = sw.get("fabric")
        if isinstance(fab, dict):
            fab_name = fab.get("fabric_name") or fab.get("fabric-name") or fab.get("name") or ""
        elif isinstance(fab, str):
            fab_name = fab
        else:
            fab_name = sw.get("fabric_name") or sw.get("fabric-name") or ""
        fab_name = (fab_name or "").strip() or "<unassigned>"
        ip = (
            sw.get("ip_address") or sw.get("ip") or sw.get("management_ip")
            or sw.get("ipAddress") or sw.get("device_ip") or ""
        )
        if isinstance(ip, str) and ip.strip():
            result.setdefault(fab_name, []).append(ip.strip())
    return result


def _count_switches_per_fabric(resp: Any) -> Dict[str, int]:
    """Backward-compat shim: switch counts derived from the per-fabric IP map."""
    return {k: len(v) for k, v in _extract_switches_per_fabric(resp).items()}


async def _resolve_target_for_post_upgrade(
    *, query: str, site: Optional[str], invoke_tool, token: str,
) -> Optional[Dict[str, str]]:
    """Pre-resolve the target fabric(s) for post-firmware-upgrade-verification.

    Strategy: fetch the live fabric list AND the live switch inventory,
    join them on fabric name, and target only fabrics that actually have
    switches. Whether a fabric is called 'default' or anything else is
    incidental — what matters is whether there's anything to verify.

    Returns a multi-line system message (or None on failure — the agent
    falls back to its prompt-driven discovery in that case).
    """
    ip_pattern = re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b")
    ips_in_query = ip_pattern.findall(query or "")

    inputs: Dict[str, Any] = {}
    if site:
        inputs["site"] = site

    # Fetch fabrics + switches in parallel.
    try:
        fab_resp, sw_resp = await asyncio.gather(
            invoke_tool("fabric_get_fabrics", inputs, token),
            invoke_tool("inventory_getswitches", inputs, token),
        )
    except Exception as exc:
        return {
            "context_msg": (
                f"PRE-RESOLVE ERROR: fabric/switch discovery failed "
                f"({type(exc).__name__}: {str(exc)[:120]}). "
                f"Discover targets via tools as the prompt directs."
            ),
            "query_directive": "",
        }

    all_fabrics = _extract_fabric_names(fab_resp)
    sw_per_fabric = _extract_switches_per_fabric(sw_resp)
    sw_counts = {n: len(ips) for n, ips in sw_per_fabric.items()}

    # Real verification targets: fabrics with at least one switch assigned.
    targets_with_switches: List[Tuple[str, int]] = sorted(
        [(name, sw_counts.get(name, 0)) for name in all_fabrics if sw_counts.get(name, 0) > 0],
        key=lambda x: -x[1],  # most-populated first
    )
    target_names = [n for n, _ in targets_with_switches]
    empty_fabrics = [n for n in all_fabrics if sw_counts.get(n, 0) == 0]

    # User-named targets (any fabric name that appears in the query).
    q_lower = (query or "").lower()
    named_in_query = [n for n in all_fabrics if n.lower() in q_lower]

    # === Build the system context (informational; what was discovered) ===
    ctx_lines: List[str] = ["[PRE-RESOLVED CONTEXT — computed by the host, AUTHORITATIVE]"]
    ctx_lines.append(f"All fabrics on this site: {all_fabrics!r}")
    ctx_lines.append(f"Switch counts per fabric: { {n: sw_counts.get(n, 0) for n in all_fabrics} !r}")
    if empty_fabrics:
        ctx_lines.append(f"Fabrics with NO switches (skipped): {empty_fabrics!r}")
    ctx_lines.append(f"Fabrics WITH switches (verification targets): {target_names!r}")

    # Surface stranded standalones (switches in inventory but not in any
    # fabric) for visibility — these are intentionally OUT OF SCOPE for
    # firmware skills. Operators sometimes wonder where their staged spares
    # went; saying so explicitly avoids confusion in the report.
    n_unassigned = sw_counts.get("<unassigned>", 0)
    if n_unassigned > 0:
        ctx_lines.append(
            f"Unassigned switches in inventory (NOT in scope for fabric-targeted "
            f"firmware checks): {n_unassigned}. Mention this once in 'How I "
            "investigated' if helpful, but do NOT include them in the checklist."
        )

    # === Build the directive that gets appended to the user query ===
    # This is the change that matters: the directive lands in the USER
    # message, not just a system message. The model has been ignoring
    # system context but follows user instructions reliably.
    if ips_in_query:
        directive = (
            f"\n\nIMPORTANT — host has resolved the target for you: verify these "
            f"switch IPs directly: {ips_in_query!r}. Begin the 5-point checklist NOW. "
            "Do NOT respond with 'cannot verify' or ask for clarification — the "
            "target IS resolved."
        )
    elif named_in_query:
        chosen = named_in_query[0]
        n_sw = sw_counts.get(chosen, 0)
        directive = (
            f"\n\nIMPORTANT — host has resolved the target for you: fabric '{chosen}' "
            f"({n_sw} switches). Begin the 5-point checklist NOW. Do NOT respond "
            "with 'cannot verify' or ask for clarification — the target IS resolved."
        )
    elif len(target_names) == 0:
        directive = (
            "\n\nNo fabric on this site has switches assigned. Return verdict "
            "'cannot_verify_no_target' with Summary: 'Cannot verify: no fabric "
            "on this site has any switches assigned.' This is the only acceptable "
            "response in this branch."
        )
    elif len(target_names) == 1:
        chosen = target_names[0]
        chosen_ips = sw_per_fabric.get(chosen, [])
        n_sw = len(chosen_ips)
        directive = (
            f"\n\nIMPORTANT — host has resolved the target for you: fabric "
            f"'{chosen}' ({n_sw} switches). Switch IPs: {chosen_ips!r}. "
            "These IPs are AUTHORITATIVE — pass them directly to the per-switch "
            "tools (e.g., `firmware_check_storage` with "
            f"{{device_ips: {chosen_ips!r}}}, `restconf_get_bgp_summary` with "
            f"{{switch_ips: {chosen_ips!r}}}). Do NOT call the tools with empty "
            "lists, do NOT skip the checklist with 'returned 0 devices' — the "
            "IPs are right here. Begin the checklist NOW. Do NOT respond with "
            "'cannot verify' or 'cannot check'."
        )
    else:
        # Multi-fabric branch — include IPs per fabric so the agent can
        # process each one without a separate enumeration step.
        per_fab = {n: sw_per_fabric.get(n, []) for n in target_names}
        directive = (
            f"\n\nIMPORTANT — host has resolved the targets for you: "
            f"verify ALL of these fabrics. Switch IPs per fabric: {per_fab!r}. "
            "Pass these IP lists directly to the per-switch tools. "
            "Run the checklist on each fabric; produce a per-fabric table; "
            "overall verdict is the WORST across all fabrics. Begin NOW. "
            "Do NOT refuse or ask for clarification."
        )

    # Also expose the resolved-target IPs structurally so other pre-loop
    # hooks can reuse them (e.g. pre-firmware-upgrade-check pre-runs
    # firmware_check_storage on these IPs).
    if ips_in_query:
        resolved_ips = list(ips_in_query)
        resolved_fabric: Optional[str] = None
    elif named_in_query:
        resolved_fabric = named_in_query[0]
        resolved_ips = sw_per_fabric.get(resolved_fabric, [])
    elif len(target_names) == 1:
        resolved_fabric = target_names[0]
        resolved_ips = sw_per_fabric.get(resolved_fabric, [])
    else:
        resolved_fabric = None
        resolved_ips = []

    return {
        "context_msg": "\n".join(ctx_lines),
        "query_directive": directive,
        "resolved_ips": resolved_ips,
        "resolved_fabric": resolved_fabric,
    }


async def _resolve_for_pre_upgrade_check(
    *, query: str, site: Optional[str], invoke_tool, token: str,
) -> Optional[Dict[str, Any]]:
    """Pre-loop hook for `pre-firmware-upgrade-check`.

    Builds on the post-upgrade resolver (target discovery), then ALSO
    pre-executes `firmware_check_storage` with the resolved IPs so the
    agent gets the storage verdict directly in its context — no second
    chance to call the tool with an empty IP list.

    Why this exists: the `firmware_check_storage` tool needs `device_ips`
    explicitly, and the model has shown it sometimes calls the tool
    without them even when the IPs are right there in the directive.
    Pre-executing here guarantees Check 1 always has real data.
    """
    base = await _resolve_target_for_post_upgrade(
        query=query, site=site, invoke_tool=invoke_tool, token=token,
    )
    if not base:
        return base

    ips: List[str] = list(base.get("resolved_ips") or [])
    if not ips:
        # No target → nothing to pre-run. Forward the base result; the
        # skill will handle cannot_check_no_target.
        return base

    # Pre-execute firmware_check_storage with the resolved IPs.
    try:
        storage_resp = await invoke_tool(
            "firmware_check_storage", {"device_ips": ips}, token,
        )
    except Exception as exc:
        # Pre-run failed — surface it but don't block the run; the agent
        # can still try its own call as a fallback.
        base["pre_run_storage_error"] = f"{type(exc).__name__}: {str(exc)[:160]}"
        return base

    # Apply the same preprocessor the agent loop would have applied so
    # the verdict is computed identically.
    storage_filtered, _ = _firmware_storage_pp("firmware_check_storage", storage_resp)

    # Pull the verdict out of the filtered payload.
    sbody = storage_filtered
    if isinstance(sbody.get("result"), dict) and isinstance(sbody["result"].get("payload"), dict):
        sbody = sbody["result"]["payload"]
    elif isinstance(sbody.get("payload"), dict):
        sbody = sbody["payload"]
    verdict = (sbody or {}).get("_agent_storage_verdict") or "skip"
    summary = (sbody or {}).get("_agent_storage_summary") or "(unavailable)"
    devices = (sbody or {}).get("devices") or []
    per_sw = [
        {
            "ip": d.get("ip"),
            "free_mb": d.get("free_mb"),
            "required_mb": d.get("required_mb"),
            "sufficient": d.get("sufficient"),
        }
        for d in devices if isinstance(d, dict)
    ]

    storage_block = (
        "\n\n[PRE-RUN — firmware_check_storage already executed by the host on your behalf]\n"
        f"Pre-run verdict: {verdict}\n"
        f"Pre-run summary: {summary}\n"
        f"Per-switch detail: {per_sw!r}\n"
        "DO NOT re-call firmware_check_storage. Use the verdict above verbatim "
        "for Checklist Check 1: Result = " + verdict.upper() + ", Detail = the "
        "summary phrase. The tool has already run; calling it again wastes a "
        "tool call and risks hitting the empty-args bug we are working around."
    )

    base["context_msg"] = (base.get("context_msg") or "") + storage_block
    base["query_directive"] = (base.get("query_directive") or "") + (
        "\n\n[STORAGE CHECK PRE-RUN] The host has already run "
        f"firmware_check_storage with the resolved IPs. Pre-run verdict: "
        f"{verdict.upper()}. Use this verbatim for Check 1; do NOT call "
        "firmware_check_storage again."
    )
    # Stash for trace emission in the loop
    base["pre_run_storage_trace"] = {
        "tool": "firmware_check_storage",
        "verdict": verdict,
        "summary": summary,
        "n_devices": len(devices),
    }
    return base


async def _resolve_for_pre_rma_check(
    *, query: str, site: Optional[str], invoke_tool, token: str,
) -> Optional[Dict[str, Any]]:
    """Pre-loop hook for `pre-rma-check`.

    Identifies the failed switch (by IP from the query) in inventory,
    finds its fabric, identifies a likely MCT partner using the same
    heuristic as the wizard (same fabric + role + pod + rack, leaf-class).
    Optionally also resolves a "new switch IP" if a second IP is in the
    query.

    Output (in addition to context_msg + query_directive) extra fields
    the agent loop doesn't need but the trace surfaces:
      resolved_failed_switch  — the inventory record
      resolved_new_switch_ip  — second IP from the query, if any
      resolved_mct_partner    — best-effort partner record
    """
    ips = re.findall(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", query or "")
    failed_ip = ips[0] if ips else ""
    new_ip = ips[1] if len(ips) > 1 else ""

    if not failed_ip:
        return {
            "context_msg": "[PRE-RESOLVED CONTEXT]\nNo failed-switch IP found in the query.",
            "query_directive": (
                "\n\nNo failed switch IP was given. Return verdict "
                "'cannot_check_no_target' with Summary 'Cannot check: no failed "
                "switch IP given.' Recommended next step: ask the operator to "
                "re-run with a specific IP, e.g. 'rma check on 10.x.x.x'."
            ),
            "resolved_failed_switch": None,
            "resolved_new_switch_ip": "",
            "resolved_mct_partner": None,
        }

    inputs: Dict[str, Any] = {}
    if site:
        inputs["site"] = site

    try:
        sw_resp = await invoke_tool("inventory_getswitches", inputs, token)
    except Exception as exc:
        return {
            "context_msg": (
                f"[PRE-RESOLVED CONTEXT]\nFailed switch IP: {failed_ip}\n"
                f"PRE-RESOLVE WARNING: inventory_getswitches failed "
                f"({type(exc).__name__}: {str(exc)[:120]}). Discover targets "
                f"via tools as the prompt directs."
            ),
            "query_directive": (
                f"\n\nProceed with the failed switch IP {failed_ip!r} "
                + (f"and new switch IP {new_ip!r}. " if new_ip else "(no new switch IP given). ")
                + "The host couldn't pre-fetch inventory; call inventory_getswitches yourself."
            ),
            "resolved_failed_switch": None,
            "resolved_new_switch_ip": new_ip,
            "resolved_mct_partner": None,
        }

    body = sw_resp
    if isinstance(body, dict) and isinstance(body.get("result"), dict):
        body = body["result"].get("payload", body)
    if isinstance(body, dict) and isinstance(body.get("payload"), dict):
        body = body["payload"]
    items: List[Any] = []
    if isinstance(body, dict):
        for key in ("items", "switches"):
            v = body.get(key)
            if isinstance(v, list):
                items = v
                break
    elif isinstance(body, list):
        items = body

    def _ip_of(sw: Any) -> str:
        if not isinstance(sw, dict):
            return ""
        return str(sw.get("ip_address") or sw.get("ip") or sw.get("management_ip") or "").strip()

    def _fab_of(sw: Any) -> str:
        if not isinstance(sw, dict):
            return ""
        fab = sw.get("fabric")
        if isinstance(fab, dict):
            return str(fab.get("fabric_name") or fab.get("fabric-name") or fab.get("name") or "").strip()
        if isinstance(fab, str):
            return fab.strip()
        return str(sw.get("fabric_name") or sw.get("fabric-name") or "").strip()

    failed_sw = next((sw for sw in items if isinstance(sw, dict) and _ip_of(sw) == failed_ip), None)

    if failed_sw is None:
        return {
            "context_msg": (
                f"[PRE-RESOLVED CONTEXT]\n"
                f"Failed switch IP: {failed_ip}\n"
                f"NOT FOUND in inventory."
            ),
            "query_directive": (
                f"\n\nIMPORTANT — failed switch IP {failed_ip!r} was NOT found in "
                f"inventory. Check 1 (Failed switch identification) is FAIL. "
                f"Verdict: not_ready. Likely blockers: 'Failed switch IP not in "
                f"inventory — verify the IP, or the switch may have been removed "
                f"already.' Do NOT proceed with the other checks."
            ),
            "resolved_failed_switch": None,
            "resolved_new_switch_ip": new_ip,
            "resolved_mct_partner": None,
        }

    failed_fab = _fab_of(failed_sw)
    failed_role = str(failed_sw.get("role") or "")
    failed_pod = failed_sw.get("pod")
    failed_rack = failed_sw.get("rack")
    failed_model = str(failed_sw.get("model") or failed_sw.get("chassis_name") or "")
    failed_health = str(failed_sw.get("device_health") or "")

    # MCT partner heuristic — same as the wizard
    partner = None
    if failed_role and ("leaf" in failed_role.lower()):
        for sw in items:
            if not isinstance(sw, dict):
                continue
            if _ip_of(sw) == failed_ip:
                continue
            if _fab_of(sw) != failed_fab:
                continue
            if str(sw.get("role") or "") != failed_role:
                continue
            if failed_pod and sw.get("pod") != failed_pod:
                continue
            if failed_rack and sw.get("rack") != failed_rack:
                continue
            partner = sw
            break

    partner_ip = _ip_of(partner) if partner else ""
    partner_name = str(partner.get("name") or partner.get("hostname") or "") if isinstance(partner, dict) else ""

    # ── Pre-execute reachability probes — Tier 4 enforcement. ───────────
    # The model has fabricated "Check 2 = PASS / switch unreachable" on
    # actually-healthy switches even when the inventory record says
    # device_health=healthy. Don't let it touch this check; compute it.
    # The probe ALSO extracts hardware fingerprint fields (cpu, memory,
    # os_version) so we can compute Check 5 (model/role compatibility)
    # without an additional tool call.
    async def _probe_reachable(ip: str) -> Tuple[bool, str, Dict[str, Any]]:
        """Returns (reachable, note, fingerprint). Fingerprint contains
        cpu / memory_mb / os_version / firmware_full_version when extractable —
        an empty dict otherwise. Best-effort — RESTCONF errors count as
        unreachable, with operator-friendly notes (no raw HTTP 500 spam)."""
        if not ip:
            return False, "no IP given", {}

        # Operator-friendly translation of common probe-failure shapes.
        def _clean_note(raw: str) -> str:
            s = (raw or "").lower()
            if "timeout" in s or "timed out" in s:
                return "switch unreachable (probe timed out)"
            if "connection refused" in s or "refused" in s:
                return "switch unreachable (connection refused)"
            if "name or service not known" in s or "no route to host" in s or "unreachable" in s:
                return "switch unreachable (no route)"
            if "auth" in s and ("fail" in s or "denied" in s or "401" in s or "403" in s):
                return "RESTCONF auth failed"
            if "500" in s and "internal server error" in s:
                return "switch unreachable (MCP server returned 500 — likely connect failure to the device)"
            if "502" in s or "503" in s or "504" in s:
                return "switch unreachable (MCP server gateway error — device likely unresponsive)"
            # Generic fallback — strip JSON noise but keep something useful
            short = (raw or "").strip()
            short = re.sub(r"\{[^}]*\}", "", short)  # drop JSON detail blobs
            short = re.sub(r"\s+", " ", short).strip(": .,")
            return f"switch unreachable ({short[:90]})" if short else "switch unreachable"

        try:
            r = await invoke_tool("restconf_show_firmware_version", {"switch_ip": ip}, token)
            inner = r if isinstance(r, dict) else {}
            res = inner.get("result", inner) if isinstance(inner, dict) else {}
            status = res.get("status") if isinstance(res, dict) else None
            payload = res.get("payload") if isinstance(res, dict) else None
            if status == 200 and isinstance(payload, dict):
                meta = payload.get("meta") if isinstance(payload, dict) else None
                if isinstance(meta, dict) and meta.get("ok") is False:
                    return False, _clean_note(str(meta.get("error") or "RESTCONF error")), {}
                # Pull the hardware fingerprint fields. The firmware response
                # places them under .item with .summary as a partial mirror.
                fp: Dict[str, Any] = {}
                item = payload.get("item") if isinstance(payload.get("item"), dict) else {}
                summary_block = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
                for k in ("cpu", "memory_mb", "os_version", "firmware_full_version", "kernel_version", "os_name"):
                    if item.get(k):
                        fp[k] = item[k]
                    elif summary_block.get(k):
                        fp[k] = summary_block[k]
                # Found at least version info → treat as reachable
                if fp.get("firmware_full_version") or fp.get("os_version"):
                    return True, f"RESTCONF responded; fw={fp.get('firmware_full_version') or fp.get('os_version')}", fp
                return True, "RESTCONF responded 200 (responsive)", fp
            if isinstance(status, int) and status >= 400:
                return False, _clean_note(f"RESTCONF returned HTTP {status}"), {}
            return False, "switch unreachable (probe response unparseable)", {}
        except Exception as exc:
            return False, _clean_note(f"{type(exc).__name__}: {exc}"), {}

    # Probe failed switch and (if given) new switch.
    failed_reachable, failed_probe_note, failed_fp = await _probe_reachable(failed_ip)
    new_reachable: Optional[bool] = None
    new_probe_note = ""
    new_fp: Dict[str, Any] = {}
    if new_ip:
        new_reachable, new_probe_note, new_fp = await _probe_reachable(new_ip)

    # Compute Check 2 verdict (Failed switch unreachable):
    #   PASS    — probe failed (switch is offline → RMA justified)
    #   ADVISORY — probe succeeded BUT inventory says unhealthy (degraded but alive)
    #   FAIL    — probe succeeded AND inventory says healthy (don't replace a working switch!)
    if not failed_reachable:
        check2_verdict = "PASS"
        check2_reason = f"Failed switch did NOT respond → unreachable, RMA justified. ({failed_probe_note})"
    else:
        if failed_health.lower() == "healthy":
            check2_verdict = "FAIL"
            check2_reason = (
                f"Failed switch RESPONDED to RESTCONF and inventory shows device_health='healthy'. "
                f"This switch is alive and well — DO NOT replace it. ({failed_probe_note}) "
                f"The operator likely entered the wrong IP, or replacement is no longer needed."
            )
        else:
            check2_verdict = "ADVISORY"
            check2_reason = (
                f"Failed switch RESPONDED to RESTCONF but inventory shows device_health={failed_health!r}. "
                f"Switch is partially alive but degraded — RMA may still be appropriate; flag this as "
                f"a soft warning that the switch isn't fully offline. ({failed_probe_note})"
            )

    # Compute Check 4 verdict (New switch reachability):
    if not new_ip:
        check4_verdict = "SKIP"
        check4_reason = "New switch IP not provided."
    elif new_reachable:
        check4_verdict = "PASS"
        check4_reason = f"New switch responded to RESTCONF. ({new_probe_note})"
    else:
        check4_verdict = "FAIL"
        check4_reason = (
            f"New switch did NOT respond. The RMA composite needs to register the new switch via "
            f"RESTCONF; if it can't reach it, the operation will fail at the register step. "
            f"({new_probe_note})"
        )

    # Compute Check 5 verdict (Model / role compatibility) — best-effort
    # hardware fingerprint match. RESTCONF doesn't expose the model name
    # (e.g., "SLX9250-32C") directly, but cpu + memory_mb + os_version
    # together form a reliable identity for an SLX device class. If both
    # switches return matching fingerprints, they're almost certainly the
    # same hardware platform. Mismatched fingerprint → flag for operator.
    failed_cpu = str(failed_fp.get("cpu") or "")
    failed_mem = str(failed_fp.get("memory_mb") or "")
    failed_osver = str(failed_fp.get("os_version") or "")
    new_cpu = str(new_fp.get("cpu") or "")
    new_mem = str(new_fp.get("memory_mb") or "")
    new_osver = str(new_fp.get("os_version") or "")

    if not new_ip:
        check5_verdict = "SKIP"
        check5_reason = "New switch IP not provided."
    elif not new_reachable:
        check5_verdict = "SKIP"
        check5_reason = "New switch unreachable — cannot fingerprint hardware."
    elif not failed_reachable and not failed_cpu:
        # Failed switch is offline (the expected case) so we can't fingerprint
        # it via RESTCONF. Fall back to inventory's `model` field on the failed
        # switch + announce the new switch's fingerprint for operator review.
        check5_verdict = "ADVISORY"
        if new_cpu or new_mem:
            check5_reason = (
                f"Failed switch is offline so RESTCONF fingerprint comparison is not possible. "
                f"Inventory says failed switch model: {failed_model!r}. "
                f"New switch fingerprint: cpu={new_cpu!r}, memory={new_mem!r}, os={new_osver!r}. "
                f"Operator must confirm new switch is the same {failed_model!r}-class device."
            )
        else:
            check5_reason = (
                f"Failed switch is offline; new switch responded to RESTCONF but didn't return "
                f"hardware fingerprint fields. Operator must confirm model match manually "
                f"(failed switch model per inventory: {failed_model!r})."
            )
    else:
        # Both reachable — direct fingerprint comparison.
        cpu_match = bool(failed_cpu) and bool(new_cpu) and failed_cpu == new_cpu
        mem_match = bool(failed_mem) and bool(new_mem) and failed_mem == new_mem
        osver_match = bool(failed_osver) and bool(new_osver) and failed_osver == new_osver
        if cpu_match and mem_match:
            check5_verdict = "PASS"
            extra = "" if osver_match else f" (OS version differs: {failed_osver!r} vs {new_osver!r} — soft-warn only, the upgrade pipeline can normalize)"
            check5_reason = (
                f"Hardware fingerprints match: cpu={failed_cpu!r}, memory={failed_mem!r}.{extra} "
                f"Failed switch is alive (note: Check 2 will FAIL — see above)."
            )
        elif (failed_cpu and new_cpu and failed_cpu != new_cpu) or (failed_mem and new_mem and failed_mem != new_mem):
            check5_verdict = "FAIL"
            check5_reason = (
                f"Hardware fingerprint MISMATCH between failed and new switch. "
                f"Failed: cpu={failed_cpu!r}, memory={failed_mem!r}. "
                f"New: cpu={new_cpu!r}, memory={new_mem!r}. "
                f"Likely different hardware classes (e.g., Spine-class vs Leaf-class TOR). "
                f"Replacing with mismatched hardware will likely break fabric topology."
            )
        else:
            check5_verdict = "ADVISORY"
            check5_reason = (
                f"Partial fingerprint data only. Failed: cpu={failed_cpu!r}, memory={failed_mem!r}. "
                f"New: cpu={new_cpu!r}, memory={new_mem!r}. Operator should confirm model match "
                f"(failed switch model per inventory: {failed_model!r})."
            )

    ctx_lines = ["[PRE-RESOLVED CONTEXT — computed by the host, AUTHORITATIVE]"]
    ctx_lines.append(f"Failed switch: {failed_ip!r}")
    ctx_lines.append(f"  in fabric: {failed_fab!r}")
    ctx_lines.append(f"  role: {failed_role!r}, model: {failed_model!r}")
    ctx_lines.append(f"  device_health (last seen): {failed_health!r}")
    ctx_lines.append(f"  live RESTCONF probe: {'REACHABLE' if failed_reachable else 'UNREACHABLE'} — {failed_probe_note}")
    if new_ip:
        ctx_lines.append(f"New switch IP (replacement): {new_ip!r}")
        ctx_lines.append(f"  live RESTCONF probe: {'REACHABLE' if new_reachable else 'UNREACHABLE'} — {new_probe_note}")
    else:
        ctx_lines.append("New switch IP: NOT PROVIDED — Check 4 will be SKIP")
    if partner_ip:
        ctx_lines.append(f"Likely MCT partner: {partner_ip!r}" + (f" ({partner_name})" if partner_name else ""))
        ctx_lines.append("  same role + same pod + same rack as failed switch → carries load during replacement")
    else:
        if "leaf" in failed_role.lower():
            ctx_lines.append("MCT partner: not detected (no other switch matches role/pod/rack)")
        else:
            ctx_lines.append(f"MCT partner: N/A (role {failed_role!r} is not leaf-class)")
    ctx_lines.append("")
    ctx_lines.append(
        f"AUTHORITATIVE CHECK VERDICTS (computed by the host — use VERBATIM):\n"
        f"  Check 2 (Failed switch unreachable): {check2_verdict}\n"
        f"    Reason: {check2_reason}\n"
        f"  Check 4 (New switch reachability):   {check4_verdict}\n"
        f"    Reason: {check4_reason}\n"
        f"  Check 5 (Model / role compatibility): {check5_verdict}\n"
        f"    Reason: {check5_reason}\n"
        f"DO NOT recompute these checks. Use the verdict + reason verbatim in the "
        f"checklist table. The model has been observed fabricating Check 2 = PASS "
        f"on healthy switches; the host has run the live probes to prevent that."
    )

    directive_parts = [
        f"\n\nIMPORTANT — host has resolved the RMA target AND probed reachability + hardware:"
    ]
    directive_parts.append(f"Failed switch IP: {failed_ip} (probe: {'reachable' if failed_reachable else 'unreachable'})")
    directive_parts.append(f"Fabric: {failed_fab}")
    if new_ip:
        directive_parts.append(f"New switch IP: {new_ip} (probe: {'reachable' if new_reachable else 'unreachable'})")
    if partner_ip:
        directive_parts.append(f"MCT partner: {partner_ip} (verify its health in Check 3)")
    directive_parts.append(
        f"\nMANDATORY check verdicts (computed by the host — use verbatim):\n"
        f"  Check 2 = {check2_verdict}  ({check2_reason[:140]})\n"
        f"  Check 4 = {check4_verdict}  ({check4_reason[:140]})\n"
        f"  Check 5 = {check5_verdict}  ({check5_reason[:140]})\n"
        f"Use these verbatim in your Checklist results table — do NOT change them. "
        f"Run Check 3 (MCT partner) and Check 6 (fabric baseline) yourself via tools."
    )

    return {
        "context_msg": "\n".join(ctx_lines),
        "query_directive": "\n".join(directive_parts),
        "resolved_failed_switch": failed_sw,
        "resolved_new_switch_ip": new_ip,
        "resolved_mct_partner": partner,
        "pre_run_check2_verdict": check2_verdict,
        "pre_run_check2_reason": check2_reason,
        "pre_run_check4_verdict": check4_verdict,
        "pre_run_check4_reason": check4_reason,
        "pre_run_check5_verdict": check5_verdict,
        "pre_run_check5_reason": check5_reason,
    }


# Pre-loop hook registry: skill name → async resolver. Each resolver gets
# the live invoke_tool/fetch_catalog/token bound by the caller and returns
# an optional system-message string to inject before the user's query.
#
# pre/post firmware skills share the same target-discovery logic (a fabric
# is a valid target iff it has switches assigned), so the resolver is
# registered for both names. If a future skill needs different discovery,
# write a new resolver function and register it here.
_PRE_LOOP_HOOKS = {
    "post-firmware-upgrade-verification": _resolve_target_for_post_upgrade,
    # Pre-upgrade uses a richer resolver that ALSO pre-runs
    # firmware_check_storage with the resolved IPs. The agent receives the
    # storage verdict directly so it can't whiff Check 1 by calling the
    # tool with empty device_ips (which it has done on every prior run).
    "pre-firmware-upgrade-check": _resolve_for_pre_upgrade_check,
    # Pre-RMA uses a target-finder that looks up the failed switch in
    # inventory and does best-effort MCT partner detection.
    "pre-rma-check": _resolve_for_pre_rma_check,
}
