# Centralized on-disk paths. Every module that reads or writes operator
# data goes through these constants so the same paths can be remapped at
# deploy time via env vars (Docker volume mounts, dev overrides, etc).
#
# AUDIT_LOG_PATH is the anchor — settings/usage logs default to siblings
# of it so a single volume mount covers everything.

import os
from pathlib import Path

AUDIT_LOG_PATH: str = os.getenv(
    "AUDIT_LOG_PATH",
    str(Path(__file__).resolve().parent.parent / "audit.log"),
)

CLIENT_SETTINGS_PATH: str = os.getenv(
    "CLIENT_SETTINGS_PATH",
    str(Path(AUDIT_LOG_PATH).with_name("client_settings.json")),
)

OPENAI_USAGE_LOG_PATH: str = os.getenv(
    "OPENAI_USAGE_LOG_PATH",
    str(Path(AUDIT_LOG_PATH).with_name("openai_usage.jsonl")),
)
