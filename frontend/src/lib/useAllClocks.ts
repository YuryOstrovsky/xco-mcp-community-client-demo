// useAllClocks — state bundle for the multi-switch clocks + NTP sync
// modal that's opened from the dashboard's "All Clocks" button.
//
// State-only. The two handlers — handleOpenAllClocks (parallel-fetch
// clock + firmware across all switches) and handleSubmitNtpSync (create
// + open a plan that sets NTP on every switch with a parseable
// response) — stay in App.tsx because they close over App-scope helpers
// (closeAllTier3Widgets, switchOptions, setPlanDetail, setPlanDetailOpen)
// that aren't part of this hook's surface.

import { useState } from "react";

export interface AllClocksRow {
  ip: string;
  name: string;
  currentTime: string;
  timezone: string;
  uptime: string;
  source: string;
  error?: string;
}

export interface UseAllClocks {
  allClocksOpen: boolean;
  setAllClocksOpen: (v: boolean) => void;
  allClocksData: AllClocksRow[];
  setAllClocksData: React.Dispatch<React.SetStateAction<AllClocksRow[]>>;
  allClocksLoading: boolean;
  setAllClocksLoading: (v: boolean) => void;
  allClocksNtpServer: string;
  setAllClocksNtpServer: (s: string) => void;
  allClocksQueryCount: number;
  setAllClocksQueryCount: (n: number) => void;
  allClocksNtpSubmitting: boolean;
  setAllClocksNtpSubmitting: (v: boolean) => void;
}

export function useAllClocks(): UseAllClocks {
  const [allClocksOpen, setAllClocksOpen] = useState(false);
  const [allClocksData, setAllClocksData] = useState<AllClocksRow[]>([]);
  const [allClocksLoading, setAllClocksLoading] = useState(false);
  const [allClocksNtpServer, setAllClocksNtpServer] = useState("");
  const [allClocksQueryCount, setAllClocksQueryCount] = useState(0);
  const [allClocksNtpSubmitting, setAllClocksNtpSubmitting] = useState(false);

  return {
    allClocksOpen, setAllClocksOpen,
    allClocksData, setAllClocksData,
    allClocksLoading, setAllClocksLoading,
    allClocksNtpServer, setAllClocksNtpServer,
    allClocksQueryCount, setAllClocksQueryCount,
    allClocksNtpSubmitting, setAllClocksNtpSubmitting,
  };
}
