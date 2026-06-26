# XCO MCP Server – Demo Examples

Natural language queries you can ask the NL/AI assistant.
The format `> "…"` is parsed by the backend `/api/examples` endpoint.

---

## Fabric

> "What's the health of all my fabrics?"

> "Show me a fabric overview — status, type, and health."

> "Run a pre-change validation report across all fabrics."

> "Show health timeline for fabric DC."

> "Summarize errors for fabric DC."

> "Show recent executions for fabric DC."

---

## Inventory

> "Show me all switches with their IP, role, and firmware version."

> "Give me a full switch inventory overview."

> "Are there any devices I can't reach right now?"

> "Do all switches run the same firmware version?"

> "Which devices are dragging fabric health into the red?"

> "Show me the switch summary for fabric DC."

---

## Tenant / EPG

> "List all endpoint groups across every tenant."

> "Show EPG health summary for tenant DC."

> "Show alarms for tenant DC."

> "Show event logs for tenant DC."

---

## Alarms / Faults

> "What are the top critical active alarms right now?"

> "Show me alarm details with context — what's impacted and why?"

> "Show health-related alerts for fabric DC."

---

## Platform / System

> "Show me a full platform status — EFA, services, and health."

> "Is the HA cluster healthy? Show me node and storage status."

> "Which certificates are expiring in the next 90 days?"

> "Are there any certificate expiry alarms I should know about?"

> "What was the last failed system execution and why did it fail?"

---

## Notifications / Events

> "Show me recent critical and warning events across all services."

> "Were there any failed notification deliveries recently?"

---

## Safety Notes

- Server enforces `XCO_READ_ONLY=1`
- All Tier-2 tools are composite read-only
- No configuration-changing endpoints are exposed
