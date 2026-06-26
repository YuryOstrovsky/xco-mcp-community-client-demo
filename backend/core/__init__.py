# backend.core — foundation primitives shared by main.py and the
# feature-specific router/helper modules under backend/.
#
# What lives here:
#   - paths        : on-disk locations for audit log, settings JSON, usage
#                    JSONL etc. Single source of truth so every module
#                    that reads/writes operator data lands on the same file.
#   - openai_usage : OpenAI usage tracking (log/read/aggregate) + price
#                    table. Used by anything that calls OpenAI.
#
# Nothing in here imports from main.py — the dependency edge points the
# OTHER way (main.py and feature modules import from core).
