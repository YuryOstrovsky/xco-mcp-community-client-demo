// FreshnessHint — italic "N min ago" label for proposal staleness.
//
// Shows "just now" / "N min ago" / "N min ago · expired", with the color
// flipping to red at the 15-minute mark. The 15-minute threshold matches
// AGENT_PROPOSAL_MAX_AGE_SECONDS on the backend — if the operator approves
// after this label turns red, the approve endpoint refuses with HTTP 409.
//
// Sub-component because Date.now() at parent render-time would trip
// react-hooks/purity. Updates every 30s via setInterval while mounted;
// stops when the parent unmounts.

import { useEffect, useState } from "react";
import { FG } from "../lib/figmaStyles";

export interface FreshnessHintProps {
  /** ISO8601 timestamp emitted by the backend with the proposal. */
  emittedAt: string;
  /** Minutes after emission at which the proposal is considered stale.
   *  Defaults to 15 (matches backend AGENT_PROPOSAL_MAX_AGE_SECONDS). */
  staleAfterMin?: number;
}

export function FreshnessHint({ emittedAt, staleAfterMin = 15 }: FreshnessHintProps) {
  const computeAgeMin = () =>
    Math.floor((Date.now() - new Date(emittedAt).getTime()) / 60000);
  const [ageMin, setAgeMin] = useState<number>(computeAgeMin);
  useEffect(() => {
    setAgeMin(computeAgeMin());
    const id = setInterval(() => setAgeMin(computeAgeMin()), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emittedAt]);
  const stale = ageMin >= staleAfterMin;
  return (
    <span
      title={stale
        ? "Proposal is stale — re-run the skill to refresh evidence before approving."
        : `Proposals expire ${staleAfterMin} minutes after emission to prevent acting on outdated lab state.`}
      style={{
        fontSize: 11, color: stale ? "#fca5a5" : FG.dimColor,
        fontStyle: "italic", marginLeft: "auto",
      }}>
      {ageMin <= 0 ? "just now" : `${ageMin} min ago`}
      {stale && " · expired"}
    </span>
  );
}
