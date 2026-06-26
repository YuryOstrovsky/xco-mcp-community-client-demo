# Server-Sent Events (SSE) helpers — turn a long-running async coroutine
# into an event stream the frontend can consume incrementally.
#
# Used by /api/agent/investigate/stream: the agent loop emits per-step
# events (`tool_call`, `tool_result`, `thought`, …). The same shape works
# for:
#
#   • multi-step backend flows that want to show progress
#   • watchers / loops that emit transitions
#   • any endpoint where the operator shouldn't stare at a frozen spinner
#
# How it works:
#   queue_stream(runner)
#       Runs `runner(emit)` in a background asyncio.Task. `emit` is an
#       async callable the runner uses to push dict events. The yielded
#       generator drains the queue and formats each as one SSE line.
#       Errors from runner come through as {"kind": "error", "error": …}
#       events (not raised). When runner returns, the stream closes
#       cleanly.
#
#   sse_response(generator)
#       Wraps the generator in FastAPI's StreamingResponse with the
#       canonical SSE headers + an X-Accel-Buffering hint so nginx (if
#       any) doesn't buffer.
#
#   sse_event(data)
#       Format one dict as an SSE `data: …\n\n` line. Exposed so callers
#       building their own generator (not queue-based) can still format
#       events consistently.
#
# Usage (queue-based — most common):
#
#     from core.sse import queue_stream, sse_response
#
#     @router.post("/api/things/scan-stream")
#     async def scan_stream():
#         async def runner(emit):
#             await emit({"kind": "started", "total": 5})
#             for i, item in enumerate(await load_items()):
#                 await emit({"kind": "progress", "idx": i, "label": item.name})
#                 await process(item)
#             await emit({"kind": "done", "count": 5})
#         return sse_response(queue_stream(runner))
#
# Frontend consumes via lib/api.ts:streamSSE(url, body, onEvent).

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Awaitable, Callable, Dict

from fastapi.responses import StreamingResponse


# Canonical SSE headers. X-Accel-Buffering=no tells nginx (if behind a
# reverse proxy) to flush bytes immediately instead of buffering — without
# this the operator sees no events until the runner finishes.
SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


class _Done:
    """Sentinel pushed by the runner task to close the queue stream.
    Not exposed — callers don't need to know about it."""


_DONE = _Done()


def sse_event(data: Dict[str, Any]) -> str:
    """Format one dict as a single SSE line. Always terminates with the
    required \\n\\n. Uses default=str so timestamps + sets serialize
    without raising."""
    return f"data: {json.dumps(data, default=str)}\n\n"


def sse_response(generator: AsyncIterator[str]) -> StreamingResponse:
    """Wrap an SSE generator in a FastAPI StreamingResponse with the
    canonical headers. Caller is responsible for the generator yielding
    pre-formatted SSE lines (use `sse_event()` per line)."""
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


# Type for the emit callable runners receive
EmitFn = Callable[[Dict[str, Any]], Awaitable[None]]

# Type for runner coroutines — receive emit, return nothing
RunnerFn = Callable[[EmitFn], Awaitable[None]]


async def queue_stream(runner: RunnerFn) -> AsyncIterator[str]:
    """Run `runner(emit)` in a background task; yield each emitted dict
    as a formatted SSE line.

    The runner is given an async `emit(event_dict)` callable. It can
    emit any number of events; when it returns (success OR raises), the
    stream closes. Exceptions from the runner are converted to
    {"kind": "error", "error": "<message>"} events so the client sees
    the failure inline instead of a cleanly-closed stream with no
    explanation.

    The initial `: stream-open\\n\\n` SSE comment line is sent before
    the runner produces anything — that flushes response headers
    immediately so browsers / proxies don't sit on them.

    On cancellation (client disconnect, server shutdown), the runner
    task is cancelled cleanly so it can release MCP connections /
    inflight work.
    """
    queue: asyncio.Queue = asyncio.Queue()

    async def _emit(ev: Dict[str, Any]) -> None:
        await queue.put(ev)

    async def _task() -> None:
        try:
            await runner(_emit)
        except Exception as exc:
            await queue.put({"kind": "error", "error": str(exc)[:300]})
        finally:
            await queue.put(_DONE)

    task = asyncio.create_task(_task())
    try:
        # SSE preamble — comment line forces proxy header flush.
        yield ": stream-open\n\n"
        while True:
            ev = await queue.get()
            if ev is _DONE:
                break
            yield sse_event(ev)
    finally:
        # Client disconnected mid-stream OR runner finished. Cancel the
        # background task so it doesn't leak resources.
        if not task.done():
            task.cancel()
