---
name: xco-health-check
description: Run XCO subsystem functional probes via the xco_health tool surface. Reports which XCO services are operational versus appearing-healthy-but-degraded. v1 covers firmware_orchestration (the goinventory-service wedge that silently breaks firmware downloads). Read-only — no remediation, no service restarts. Operators see a remediation suggestion on degraded results but must approve the restart through the plan pipeline (Phase 2).
read_only: true
trigger_keywords:
  - xco health
  - is xco healthy
  - check xco
  - xco probe
  - xco status
  - health probe
  - probe xco
  - probe firmware
  - is the firmware service healthy
  - check firmware orchestration
  - xco service health
allowed_tools:
  - list_xco_probes
  - run_xco_probe
  - list_xco_services
---

You are running a functional health check across XCO subsystems. Unlike
liveness/readiness checks (which only verify that a process is up), these
probes exercise the *user-facing code path* of each subsystem and verify
the result. This catches the failure mode where XCO's kubectl status
shows everything Running, but a specific operation silently fails — the
goinventory-service "Messaging failure" wedge being the canonical
example we saw in May 2026.

## Plan of action

1. Call `list_xco_probes` to retrieve the catalog of probes the MCP
   server knows how to run. v1 expects one probe:
   `firmware_orchestration`. Do not assume more exist; render whatever
   the catalog returns.

2. For each `cheap`-cost probe in the catalog, call `run_xco_probe` with
   the probe name. Surface results in the order they finish. Do not run
   `medium` or `heavy` probes unless the operator explicitly named one
   in their request — those have transient side effects and shouldn't
   fire on a "check xco" request.

3. (Optional, only if it adds value to the answer) Call
   `list_xco_services` to show the kubectl snapshot alongside the
   probe results. This is useful when ≥1 probe came back `degraded`
   so the operator can see the live state of the suspect service.

## Result rendering rules (per the locked Phase 1 contract)

- `status: "ok"` — one green line per probe with the summary.
- `status: "degraded"` — show the summary + each finding's `detail`.
  If a finding has `code: "messaging_failure"`, lead with "Messaging
  failure detected" and include the `evidence` string verbatim in a
  fenced code block (the operator will want to see the HTTP body).
- `status: "error"` — show the summary + findings, but never suggest a
  remediation. The server team deliberately doesn't guess remediation
  for `error` statuses, and neither should we.

If a probe returns `suggested_remediation` (only happens on `degraded`),
report it to the operator with the rationale. **Never** call
`restart_xco_service` yourself. The remediation is a suggestion, not an
instruction. Phase 2 will wire the operator-approval path; v1 of this
skill stops at "here's what's wrong, here's what would fix it, your
move."

## Tone

Be concrete. Show probe names, elapsed times, finding codes. The
operator is using this as a diagnostic tool — they want signal, not
reassurance. If everything is `ok`, say "all probes green" once and
stop.

## What this skill does NOT do

- It does not restart services. That's `restart_xco_service`, gated by
  the plan-pipeline mutation flow, available in Phase 2.
- It does not re-probe after a restart to verify recovery — that's also
  Phase 2 (the verification loop attached to the remediation chip).
- It does not enable / disable / reconfigure probes — the server team
  owns the probe registry; we just consume it.
