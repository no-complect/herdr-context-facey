"""Antigravity generated step transcripts; legacy Gemini CLI is excluded."""

from pathlib import Path
from urllib.parse import unquote, urlparse

from ..accounting import valid_count, visible_text
from ..protocol import ReaderError
from ..sources import metadata, recent_candidates

CAPABILITIES = dict(compaction=False, historical_usage=True)


def roots(home):
    return [home / ".gemini/antigravity-cli", home / ".gemini/antigravity"]


def accepts(path, home):
    for root in roots(home):
        root = (root / "brain").resolve()
        if path.is_relative_to(root):
            parts = path.relative_to(root).parts
            if len(parts) == 4 and parts[1:] == (".system_generated", "logs", "transcript.jsonl"):
                return True
    return False


def canonical(path, home):
    return Path(path).expanduser().resolve()


def process_session(path, home):
    path = Path(path).expanduser().resolve()
    for root in roots(home):
        if path.parent == (root / "presence").resolve() and path.suffix == ".lock":
            return root / "brain" / path.stem / ".system_generated/logs/transcript.jsonl"
    if accepts(path, home):
        return path
    raise ReaderError("invalid_request", "This open file is not an Antigravity session.")


def session_id(path):
    return path.parents[2].name


def candidates(home):
    candidates = []
    for root in roots(home):
        indexed = (
            metadata(root / "cache/conversation_metadata.json", root).get("conversations") or {}
        )
        if not isinstance(indexed, dict):
            indexed = {}
        for source in root.glob("brain/*/.system_generated/logs/transcript.jsonl"):
            sid = source.parents[2].name
            entry = indexed.get(sid) or {}
            if not isinstance(entry, dict):
                continue
            summary = entry.get("summary") or {}
            if not isinstance(summary, dict) or entry.get("is_internal") or summary.get("Internal"):
                continue
            uris = summary.get("WorkspaceURIs") or []
            cwd = unquote(urlparse(uris[0]).path) if uris and isinstance(uris[0], str) else ""
            candidates.append(
                dict(id=sid, path=str(source), name=summary.get("Title") or sid, cwd=cwd)
            )
    return recent_candidates(candidates, home, accepts)


def parts(path, home):
    return [(path, None)], [
        "Antigravity input and cache-read counters are separate and are summed. Model/window capacity and startup instructions are not recorded in this transcript format.",
        "Antigravity result steps are grouped under Tool results. Compaction boundaries are not reconstructed from these transcripts.",
    ]


def preview(row, field):
    if field == "agy:content":
        return visible_text(row.get("content") or row.get("error", ""))
    if field.startswith("agy:call:"):
        return visible_text(row.get("tool_calls", [])[int(field.split(":")[-1])].get("args", ""))
    return "This field is not available for preview."


def consume(accounting, row, path, line):
    typ, ts = row.get("type"), row.get("created_at", "")
    if row.get("thinking"):
        accounting.hidden_reasoning += 1
    if row.get("truncated_fields"):
        accounting.truncated_records = True
    if typ == "USER_INPUT":
        accounting.turn += 1
        accounting.add(
            "user",
            "Your prompt",
            visible_text(row.get("content", "")),
            path,
            line,
            ts,
            "agy:content",
        )
    elif typ == "PLANNER_RESPONSE":
        accounting.add(
            "assistant",
            "Assistant reply",
            visible_text(row.get("content", "")),
            path,
            line,
            ts,
            "agy:content",
        )
        for index, call in enumerate(row.get("tool_calls") or []):
            if isinstance(call, dict):
                accounting.add(
                    "calls",
                    call.get("name") or "Tool call",
                    visible_text(call.get("args", {})),
                    path,
                    line,
                    ts,
                    "agy:call:" + str(index),
                )
        value = row.get("input_tokens")
        if valid_count(value):
            cached = row.get("cache_read_tokens", 0)
            cached = cached if valid_count(cached) else 0
            accounting.reported = dict(
                input=value + cached,
                cached=cached,
                output=row.get("output_tokens", 0),
                window=None,
                timestamp=ts,
            )
            accounting.samples.append(dict(accounting.reported, afterId=len(accounting.events) - 1))
    elif typ == "GENERIC":
        accounting.add(
            "results",
            "Recorded result",
            visible_text(row.get("content") or row.get("error", "")),
            path,
            line,
            ts,
            "agy:content",
        )
