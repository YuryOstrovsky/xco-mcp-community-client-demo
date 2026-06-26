// useIfaceWidgets — state bundle for the two interface modals (the
// summary "Interface Dashboard" widget and the per-interface "Interface
// Detail" widget that opens when you click a row).
//
// Both share the same UI controls (filter + sort) but with slightly
// different filter values (the detail widget has an extra 'partial'
// state for interfaces that are up on one side and down on the other).
// Bundling into one hook because the two widgets are always wired
// together — they're effectively two views of the same data.
//
// State-only. The fetch handlers and the open/close callbacks stay in
// App.tsx because they close over App-scope helpers (switchOptions, etc).

import { useState } from "react";

export type IfaceFilter = "all" | "up" | "down";
export type IfaceDetailFilter = "all" | "up" | "down" | "partial";
export type IfaceDetailTab = "overview" | "traffic";

export interface UseIfaceWidgets {
  // Interface Dashboard widget (summary view)
  ifaceWidgetOpen: boolean;
  setIfaceWidgetOpen: (v: boolean) => void;
  ifaceFilter: IfaceFilter;
  setIfaceFilter: (f: IfaceFilter) => void;
  ifaceSort: { col: string; dir: "asc" | "desc" };
  setIfaceSort: React.Dispatch<React.SetStateAction<{ col: string; dir: "asc" | "desc" }>>;

  // Interface Detail widget (per-interface drilldown)
  ifaceDetailWidgetOpen: boolean;
  setIfaceDetailWidgetOpen: (v: boolean) => void;
  ifaceDetailFilter: IfaceDetailFilter;
  setIfaceDetailFilter: (f: IfaceDetailFilter) => void;
  ifaceDetailSort: { col: string; dir: "asc" | "desc" };
  setIfaceDetailSort: React.Dispatch<React.SetStateAction<{ col: string; dir: "asc" | "desc" }>>;
  ifaceDetailTab: IfaceDetailTab;
  setIfaceDetailTab: (t: IfaceDetailTab) => void;
}

export function useIfaceWidgets(): UseIfaceWidgets {
  const [ifaceWidgetOpen, setIfaceWidgetOpen] = useState<boolean>(false);
  const [ifaceFilter, setIfaceFilter] = useState<IfaceFilter>("all");
  const [ifaceSort, setIfaceSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "name", dir: "asc" });

  const [ifaceDetailWidgetOpen, setIfaceDetailWidgetOpen] = useState<boolean>(false);
  const [ifaceDetailFilter, setIfaceDetailFilter] = useState<IfaceDetailFilter>("all");
  const [ifaceDetailSort, setIfaceDetailSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "name", dir: "asc" });
  const [ifaceDetailTab, setIfaceDetailTab] = useState<IfaceDetailTab>("overview");

  return {
    ifaceWidgetOpen, setIfaceWidgetOpen,
    ifaceFilter, setIfaceFilter,
    ifaceSort, setIfaceSort,
    ifaceDetailWidgetOpen, setIfaceDetailWidgetOpen,
    ifaceDetailFilter, setIfaceDetailFilter,
    ifaceDetailSort, setIfaceDetailSort,
    ifaceDetailTab, setIfaceDetailTab,
  };
}
