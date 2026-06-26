// compass.test.ts — the NL parser that routes "where is X" / bare
// "compass" to the IpMacSearchWidget (Compass). Drives the restored
// Compass wiring in App.tsx's runNL.

import { describe, it, expect } from "vitest";
import { parseCompassPrompt } from "./compass";

const SWITCHES = [
  { ip: "10.9.140.41", name: "Leaf-1" },
  { ip: "10.9.140.42", name: "Leaf-2" },
  { ip: "10.9.140.31", name: "Spine-1" },
];

describe("parseCompassPrompt", () => {
  it("opens an empty search box for the bare 'compass' keyword", () => {
    expect(parseCompassPrompt("compass", SWITCHES)).toEqual({ kind: "open_empty" });
  });

  it("opens with an IP needle for 'where is 10.10.10.111'", () => {
    const r = parseCompassPrompt("where is 10.10.10.111", SWITCHES);
    expect(r.kind).toBe("open_with_query");
    if (r.kind === "open_with_query") {
      expect(r.query).toBe("10.10.10.111");
      // The host IP must NOT leak into the switch scope (the bug the
      // single-box rewrite fixed).
      expect(r.scopeIps).not.toContain("10.10.10.111");
    }
  });

  it("scopes to a named switch from 'where is 10.10.10.5 on Leaf-1'", () => {
    const r = parseCompassPrompt("where is 10.10.10.5 on Leaf-1", SWITCHES);
    expect(r.kind).toBe("open_with_query");
    if (r.kind === "open_with_query") {
      expect(r.query).toBe("10.10.10.5");
      expect(r.scopeIps).toEqual(["10.9.140.41"]);
    }
  });

  it("does NOT open without an explicit search verb", () => {
    // A bare statement about an IP should not hijack into Compass.
    expect(parseCompassPrompt("10.10.10.111 is unreachable", SWITCHES))
      .toEqual({ kind: "no_match" });
  });

  it("returns no-match for unrelated prompts", () => {
    expect(parseCompassPrompt("show fabric health", SWITCHES))
      .toEqual({ kind: "no_match" });
  });
});
