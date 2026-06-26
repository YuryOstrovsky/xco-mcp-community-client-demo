// Unit tests for the NL switch-name→IP substitution + unresolved-ref detector.

import { describe, it, expect } from "vitest";
import { substituteSwitchNames, unresolvedSwitchRef } from "./switchNameToIp";

const SW = [
  { ip: "10.0.0.1", name: "DC-Leaf6", fabric: "DC" },
  { ip: "10.0.0.2", name: "DC-Leaf10", fabric: "DC" },
  { ip: "10.0.0.3", name: "Spine-1", fabric: "DC" },
];

describe("substituteSwitchNames", () => {
  it("replaces a switch name with its IP", () => {
    expect(substituteSwitchNames("check media on DC-Leaf6", SW)).toBe("check media on 10.0.0.1");
  });

  it("replaces the longer name first (no Leaf-10 → Leaf-1 garbage)", () => {
    expect(substituteSwitchNames("clock on DC-Leaf10", SW)).toBe("clock on 10.0.0.2");
  });

  it("is a no-op when the text already has an IP", () => {
    expect(substituteSwitchNames("check media on 10.0.0.9", SW)).toBe("check media on 10.0.0.9");
  });

  it("is a no-op when no switches are loaded or the name is unknown", () => {
    expect(substituteSwitchNames("check media on DC-Leaf6", [])).toBe("check media on DC-Leaf6");
    expect(substituteSwitchNames("check media on DC-Leaf6", [{ ip: "10.9.9.9", name: "OTHER", fabric: "X" }]))
      .toBe("check media on DC-Leaf6");
  });
});

describe("unresolvedSwitchRef", () => {
  it("returns the name when a per-switch ref can't resolve with the given switches (stale inventory)", () => {
    // switchOptions still holds the OTHER site → DC-Leaf6 unresolvable
    expect(unresolvedSwitchRef("check media on DC-Leaf6", [{ ip: "10.9.9.9", name: "lab-b-leaf1", fabric: "lab-b-alex" }]))
      .toBe("DC-Leaf6");
  });

  it("returns null when the name IS resolvable already", () => {
    expect(unresolvedSwitchRef("check media on DC-Leaf6", SW)).toBeNull();
  });

  it("returns null for a fabric name (not a switch)", () => {
    expect(unresolvedSwitchRef("reconcile for DC", SW)).toBeNull();
  });

  it("returns null for generic words / no trailing ref / an IP", () => {
    expect(unresolvedSwitchRef("show all switches", SW)).toBeNull();
    expect(unresolvedSwitchRef("show fabric health", SW)).toBeNull();
    expect(unresolvedSwitchRef("check media on 10.0.0.9", SW)).toBeNull();
  });
});
