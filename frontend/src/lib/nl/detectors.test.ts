// frontend/src/lib/nl/detectors.test.ts
//
// Focused tests for detectEditTenantIntent. Existing detectors are
// tested indirectly via integration; we don't backfill those here.
// New detector → new test, keeping coverage proportional.

import { describe, it, expect } from "vitest";
import { detectEditTenantIntent, detectFabricTopologyIntent } from "./detectors";

describe("detectEditTenantIntent", () => {
  it("matches 'edit tenant ROCE-LAB' and extracts the name", () => {
    const r = detectEditTenantIntent("edit tenant ROCE-LAB");
    expect(r.matched).toBe(true);
    expect(r.tenantName).toBe("ROCE-LAB");
  });

  it("matches 'modify tenant FOO'", () => {
    const r = detectEditTenantIntent("modify tenant FOO");
    expect(r.matched).toBe(true);
    expect(r.tenantName).toBe("FOO");
  });

  it("matches 'configure tenant BAR_BAZ'", () => {
    const r = detectEditTenantIntent("configure tenant BAR_BAZ");
    expect(r.matched).toBe(true);
    expect(r.tenantName).toBe("BAR_BAZ");
  });

  it("matches 'edit the tenant ABC' (article)", () => {
    const r = detectEditTenantIntent("edit the tenant ABC");
    expect(r.matched).toBe(true);
    expect(r.tenantName).toBe("ABC");
  });

  it("matches reverse word order 'edit ABC tenant'", () => {
    const r = detectEditTenantIntent("edit ABC tenant");
    expect(r.matched).toBe(true);
    expect(r.tenantName).toBe("ABC");
  });

  it("matches bare 'edit tenant' with empty name", () => {
    const r = detectEditTenantIntent("edit tenant");
    expect(r.matched).toBe(true);
    expect(r.tenantName).toBe("");
  });

  // Plural form falls to bare-verb / picker branch — the LLM router
  // would otherwise misroute "edit tenants" to
  // tenant_get_all_endpoint_groups.
  it("matches plural 'edit tenants' with empty name", () => {
    const r = detectEditTenantIntent("edit tenants");
    expect(r.matched).toBe(true);
    expect(r.tenantName).toBe("");
  });

  it("matches plural 'modify tenants' with empty name", () => {
    const r = detectEditTenantIntent("modify tenants");
    expect(r.matched).toBe(true);
    expect(r.tenantName).toBe("");
  });

  it("DOES NOT match 'show tenants'", () => {
    expect(detectEditTenantIntent("show tenants").matched).toBe(false);
  });

  it("DOES NOT match 'create tenant FOO'", () => {
    expect(detectEditTenantIntent("create tenant FOO").matched).toBe(false);
  });

  it("DOES NOT match 'delete tenant FOO'", () => {
    expect(detectEditTenantIntent("delete tenant FOO").matched).toBe(false);
  });

  // Per-op detectors win — generic editor verb gives up when the prompt
  // mentions a specific knob the per-op modals already handle.
  it("DOES NOT swallow 'update vlan range for tenant FOO'", () => {
    expect(detectEditTenantIntent("update vlan range for tenant FOO").matched).toBe(false);
  });

  it("DOES NOT swallow 'update vrf quota for tenant FOO'", () => {
    expect(detectEditTenantIntent("update vrf quota for tenant FOO").matched).toBe(false);
  });

  it("DOES NOT swallow 'update tenant FOO vlan range'", () => {
    // Tail mentions vlan range — per-op detector should win.
    const r = detectEditTenantIntent("update tenant FOO vlan range");
    expect(r.matched).toBe(false);
  });

  it("matches generic 'update tenant FOO' with no per-op tail", () => {
    const r = detectEditTenantIntent("update tenant FOO");
    expect(r.matched).toBe(true);
    expect(r.tenantName).toBe("FOO");
  });

  it("returns no-match on empty input", () => {
    expect(detectEditTenantIntent("").matched).toBe(false);
    expect(detectEditTenantIntent("   ").matched).toBe(false);
  });

  it("is case-insensitive on the verb", () => {
    expect(detectEditTenantIntent("EDIT TENANT ROCE-LAB").matched).toBe(true);
    expect(detectEditTenantIntent("Edit Tenant Roce-Lab").matched).toBe(true);
  });
});

describe("detectFabricTopologyIntent", () => {
  it("matches 'show topology' with no fabric (picker)", () => {
    const r = detectFabricTopologyIntent("show topology");
    expect(r.matched).toBe(true);
    expect(r.fabricName).toBe("");
  });

  it("matches 'fabric topology'", () => {
    const r = detectFabricTopologyIntent("fabric topology");
    expect(r.matched).toBe(true);
    expect(r.fabricName).toBe("");
  });

  it("matches 'topology diagram'", () => {
    expect(detectFabricTopologyIntent("topology diagram").matched).toBe(true);
  });

  it("extracts the fabric from 'show topology for lab-b-alex'", () => {
    const r = detectFabricTopologyIntent("show topology for lab-b-alex");
    expect(r.matched).toBe(true);
    expect(r.fabricName).toBe("lab-b-alex");
  });

  it("extracts the fabric from 'topology of fabric DC-A'", () => {
    const r = detectFabricTopologyIntent("topology of fabric DC-A");
    expect(r.matched).toBe(true);
    expect(r.fabricName).toBe("DC-A");
  });

  // LLDP queries belong to detectLldpIntent — must NOT be stolen here.
  it("DOES NOT match 'show lldp topology'", () => {
    expect(detectFabricTopologyIntent("show lldp topology").matched).toBe(false);
  });

  // A switch IP means an LLDP-seeded perspective map → leave to LLDP flow.
  it("DOES NOT match 'topology from 10.9.140.31'", () => {
    expect(detectFabricTopologyIntent("topology from 10.9.140.31").matched).toBe(false);
  });

  it("DOES NOT match unrelated prompts", () => {
    expect(detectFabricTopologyIntent("show fabric health").matched).toBe(false);
    expect(detectFabricTopologyIntent("list switches").matched).toBe(false);
  });

  it("returns no-match on empty input", () => {
    expect(detectFabricTopologyIntent("").matched).toBe(false);
    expect(detectFabricTopologyIntent("   ").matched).toBe(false);
  });
});
