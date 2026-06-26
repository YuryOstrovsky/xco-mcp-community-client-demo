// Generic SSE consumer for one-shot streams.
//
// Pairs with backend/core/sse.py on the server side. Designed for
// fire-once streams (agent investigations, multi-step backend flows)
// where the operator restarts on failure — no auto-reconnect.
//
// (For long-lived streams where reconnect matters — e.g. plan-execution
// monitor — use `streamPlanExecution` in ./planStream.ts; it has
// keepalive watchdog + exponential backoff + token refresh logic.)
//
// Each event is one `data: <json>` line; we parse the dict and hand it
// to `onEvent`. Stream closes on a `{kind: "done"}` or `{kind: "error"}`
// event (caller still gets those via onEvent so it can render them).
//
// Returns a promise that resolves when the stream closes cleanly OR
// throws if the HTTP request failed before any events arrived (so the
// caller can fall back to a non-streaming endpoint).
//
// Usage:
//   await streamSSE("/api/things/scan-stream", { id: 42 }, {
//     onEvent: (ev) => { trace.push(ev); if (ev.kind === "done") setResult(ev); },
//     onHttpError: (status, body) => fallbackToNonStreaming(),
//   });

import { authedFetchWithRetry } from "./core";

export interface StreamSSEOpts<E = any> {
  /** Fires for every event in stream order, including `done` / `error`. */
  onEvent: (ev: E) => void;
  /** Optional — fires once if the initial HTTP open didn't return 2xx.
   *  When set, the function returns instead of throwing. */
  onHttpError?: (status: number, body: string) => void;
}

export async function streamSSE<E = any>(
  url: string,
  body: any,
  opts: StreamSSEOpts<E>,
): Promise<void> {
  // Token-aware open: if first try is 401, refresh + retry once.
  // (Same pattern as postJSON, just for the streaming HTTP open.)
  const resp = await authedFetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    if (opts.onHttpError) {
      opts.onHttpError(resp.status, errBody);
      return;
    }
    throw new Error(`stream HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
  }
  if (!resp.body) {
    throw new Error("stream HTTP 200 but no body — proxy stripped the stream?");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE events are separated by a blank line ("\n\n"). Drain every
    // complete event from the buffer; partial event tail stays for the
    // next read().
    let sep: number;
    // eslint-disable-next-line no-cond-assign
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      // Each block can have multiple lines (data:, event:, id:, …); we
      // care only about `data:` lines. SSE allows multi-line data values
      // — concatenate them in order.
      const dataLines = block.split("\n").filter((l) => l.startsWith("data:"));
      if (dataLines.length === 0) continue;
      const json = dataLines.map((l) => l.slice(5).trim()).join("");
      if (!json) continue;
      let ev: E;
      try {
        ev = JSON.parse(json);
      } catch {
        // Malformed event — skip rather than abort the whole stream.
        continue;
      }
      opts.onEvent(ev);
    }
  }
}
