// useElapsedMsWhile — small reusable hook that returns elapsed ms while
// a boolean flag is true. Resets to 0 when the flag flips to false.
// Drives the progress counters on NL runs, agent investigations, and
// (future) any other "while running, show seconds elapsed" UI.
//
// Extracted from three near-identical useEffect blocks in App.tsx.

import { useState, useEffect } from "react";

export function useElapsedMsWhile(running: boolean, intervalMs = 200): number {
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!running) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    setElapsedMs(0);
    const t = window.setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, intervalMs);
    return () => window.clearInterval(t);
  }, [running, intervalMs]);
  return elapsedMs;
}
