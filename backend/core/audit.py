# Audit log — one JSONL record per operator-visible event.
#
# Every endpoint that returns or mutates fleet state calls audit(...)
# with the operator, the action, and any salient context. The audit log
# is the forensic trail for "who triggered this firmware push and when"
# questions — append-only, raw JSONL so `jq` works.
#
# The logger and handler are configured at module import time. Doing this
# in a function would let some callers slip an audit() before setup.
# Logger is named `mcp.audit`; propagate=False so it doesn't double-emit
# through the root uvicorn logger.

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from .paths import AUDIT_LOG_PATH

# The audit logger — JSONL only, no formatter prefix.
audit_log = logging.getLogger("mcp.audit")
audit_log.setLevel(logging.INFO)
audit_log.propagate = False  # don't double-emit to root logger

_audit_handler = logging.FileHandler(AUDIT_LOG_PATH, encoding="utf-8")
_audit_handler.setFormatter(logging.Formatter("%(message)s"))  # raw JSONL
audit_log.addHandler(_audit_handler)

# Module-level logger for non-audit lines (snapshot capture warnings,
# background-task errors, etc). Goes through root → uvicorn formatting.
logger = logging.getLogger("mcp.client")


def audit(event: str, **fields: Any) -> None:
    """Write one JSONL audit record."""
    record = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "event": event,
        **fields,
    }
    audit_log.info(json.dumps(record, default=str))
