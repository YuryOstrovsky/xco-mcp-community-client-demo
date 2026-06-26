// HTTP plumbing for every other lib/api/* module.
//
// The community client is AUTH-FREE: the backend talks to an auth-free
// community MCP server, so there is no token storage, no Authorization
// header, no 401 → refresh dance, and no login. The five HTTP verbs and
// the raw-Response fetch helper simply throw on a non-OK response.

function authHeaders(): Record<string, string> {
  // Auth-free community client — no Authorization header.
  return {};
}

/**
 * Raw fetch helper for callers that need to stream the body themselves
 * (the agent investigate SSE endpoint). Auth-free: no 401 retry.
 */
export async function authedFetchWithRetry(input: RequestInfo, init: RequestInit = {}): Promise<Response> {
  return fetch(input, {
    ...init,
    headers: { ...(init.headers || {}), ...authHeaders() },
  });
}

export async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

/** Build an Error from a non-ok response. `.message` stays the raw body text
 *  (back-compat — callers that `alert(e.message)` are unaffected), with the
 *  HTTP status + parsed JSON body attached so callers that need to branch on a
 *  structured error can. */
export async function httpError(r: Response): Promise<Error & { status?: number; body?: unknown }> {
  const text = await r.text();
  const err = new Error(text) as Error & { status?: number; body?: unknown };
  err.status = r.status;
  try { err.body = JSON.parse(text); } catch { /* non-JSON body — leave undefined */ }
  return err;
}

export async function postJSON<T>(path: string, body: any): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await httpError(r);
  return r.json();
}

export async function deleteJSON<T>(path: string): Promise<T> {
  const r = await fetch(path, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
  if (r.status === 204) return {} as T;
  const text = await r.text();
  if (!text) return {} as T;
  try { return JSON.parse(text); } catch { return {} as T; }
}

export async function putJSON<T>(path: string, body: any): Promise<T> {
  const r = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function patchJSON<T>(path: string, body: any): Promise<T> {
  const r = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export interface WhoAmI {
  sub: string;
  role: string;
  scope: string;
  scopes: string[];
  exp: number | null;
}
