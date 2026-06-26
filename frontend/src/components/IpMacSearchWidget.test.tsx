// IpMacSearchWidget (Compass) unit tests.
//
// Covers:
//   1. detectKind — the pure IP/MAC/port/VLAN classifier.
//   2. Tool wiring when the MAC-address-table tool is present in the
//      catalog (the community server now ships it): MAC / VLAN / port
//      searches invoke restconf_slx_get_mac_address_table; IP search
//      fires restconf_get_arp_table. When the tool is absent the widget
//      falls back to ARP (the MAC_TABLE_AVAILABLE=false branch).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { IpMacSearchWidget, detectKind } from "./IpMacSearchWidget";

// Mock the typed-invoke layer so no real network call happens. The
// widget should only ever reach restconf_get_arp_table on this server.
const invokeMock = vi.fn();
vi.mock("../lib/typedInvoke", () => ({
  invokeToolTyped: (...args: unknown[]) => invokeMock(...args),
}));

const BASE_PROPS = {
  open: true,
  initialQuery: "",
  initialScopeIps: [] as string[],
  fleetSwitchIps: ["10.9.140.41", "10.9.140.42"],
  switchNameByIp: { "10.9.140.41": "Leaf-1", "10.9.140.42": "Leaf-2" },
  switchIpByName: { "Leaf-1": "10.9.140.41", "Leaf-2": "10.9.140.42" },
  onClose: () => {},
};

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue({ result: { payload: { items: [] } } });
});

describe("detectKind", () => {
  it("classifies an IPv4 address", () => {
    expect(detectKind("10.10.10.125")).toBe("ip");
  });
  it("classifies a dotted-quad MAC", () => {
    expect(detectKind("0004.96d6.8649")).toBe("mac");
  });
  it("classifies a colon MAC", () => {
    expect(detectKind("aa:bb:cc:dd:ee:ff")).toBe("mac");
  });
  it("classifies a switch port (N/M)", () => {
    expect(detectKind("0/50")).toBe("port");
    expect(detectKind("Eth 0/50")).toBe("port");
  });
  it("classifies a VLAN id", () => {
    expect(detectKind("100")).toBe("vlan");
  });
  it("returns unknown for gibberish", () => {
    expect(detectKind("not-a-thing")).toBe("unknown");
    expect(detectKind("")).toBe("unknown");
  });
});

describe("IpMacSearchWidget — open gate", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <IpMacSearchWidget {...BASE_PROPS} open={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the Compass panel when open", () => {
    render(<IpMacSearchWidget {...BASE_PROPS} />);
    expect(screen.getByText("Compass")).toBeInTheDocument();
  });
});

describe("IpMacSearchWidget — MAC table available (tool in catalog)", () => {
  it("auto-fires restconf_get_arp_table for an IP query", async () => {
    render(<IpMacSearchWidget {...BASE_PROPS} initialQuery="10.10.10.125" />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });
    const tools = invokeMock.mock.calls.map((c) => c[0]);
    expect(tools).toContain("restconf_get_arp_table");
  });

  it("queries the MAC table (with mac_filter) for a MAC query", async () => {
    render(<IpMacSearchWidget {...BASE_PROPS} initialQuery="0004.96d6.8649" />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });
    const tools = invokeMock.mock.calls.map((c) => c[0]);
    expect(tools).toContain("restconf_slx_get_mac_address_table");
    const macCall = invokeMock.mock.calls.find(
      (c) => c[0] === "restconf_slx_get_mac_address_table",
    );
    expect(macCall?.[1]).toMatchObject({ mac_filter: "0004.96d6.8649" });
  });

  it("queries the MAC table (with vlan_filter) for a VLAN query", async () => {
    render(<IpMacSearchWidget {...BASE_PROPS} initialQuery="100" />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });
    const tools = invokeMock.mock.calls.map((c) => c[0]);
    expect(tools).toContain("restconf_slx_get_mac_address_table");
    const macCall = invokeMock.mock.calls.find(
      (c) => c[0] === "restconf_slx_get_mac_address_table",
    );
    expect(macCall?.[1]).toMatchObject({ vlan_filter: 100 });
  });

  it("queries both the MAC table and ARP for a port query", async () => {
    render(<IpMacSearchWidget {...BASE_PROPS} initialQuery="0/50" />);
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalled();
    });
    const tools = invokeMock.mock.calls.map((c) => c[0]);
    expect(tools).toContain("restconf_slx_get_mac_address_table");
    expect(tools).toContain("restconf_get_arp_table");
  });
});
