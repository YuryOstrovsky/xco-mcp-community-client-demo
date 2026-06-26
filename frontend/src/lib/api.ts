// API barrel — re-exports the auth-free HTTP plumbing + the generic SSE
// consumer used by the community client.
//
//   api/core.ts — HTTP verbs (getJSON/postJSON/...), WhoAmI type
//   api/sse.ts  — generic one-shot SSE consumer (agent investigate stream)

export * from "./api/core";
export * from "./api/sse";
