// useAgentSkillsRegistry — one-shot fetch of the agent skill registry.
//
// Loaded once on mount from /api/agent/skills. Consumed by the NL-prompt
// skill-suggestion chip (keyword-tier matching).
//
// Best-effort: a fetch failure leaves the registry empty so downstream
// consumers just don't render. Not refreshed during the session — the
// skill registry rarely changes at runtime.

import { useEffect, useState } from "react";
import { getJSON } from "./api";

export interface AgentSkillRegistryEntry {
  name: string;
  trigger_keywords: string[];
  description?: string;
  proposal_capable?: boolean;
}

export function useAgentSkillsRegistry(): AgentSkillRegistryEntry[] {
  const [skills, setSkills] = useState<AgentSkillRegistryEntry[]>([]);
  useEffect(() => {
    getJSON<{ skills: Array<{ name: string; trigger_keywords?: string[]; description?: string; proposal_capable?: boolean }> }>("/api/agent/skills")
      .then((r) => {
        const arr = Array.isArray(r?.skills) ? r.skills : [];
        setSkills(arr.map((s) => ({
          name: s.name,
          trigger_keywords: Array.isArray(s.trigger_keywords) ? s.trigger_keywords : [],
          description: s.description,
          proposal_capable: Boolean(s.proposal_capable),
        })));
      })
      .catch(() => { /* registry is best-effort — consumers degrade gracefully */ });
  }, []);
  return skills;
}
