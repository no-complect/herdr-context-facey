"""Claude project transcripts and optional process-to-session metadata."""

from pathlib import Path

from ..accounting import object_value, visible_text
from ..sources import metadata

CAPABILITIES = dict(compaction=True, historical_usage=True)


def accepts(path, home):
    return path.suffix == ".jsonl" and path.is_relative_to((home / ".claude/projects").resolve())


def canonical(path, home):
    return Path(path).expanduser().resolve()


def process_session(path, home):
    return canonical(path, home)


def session_id(path):
    return path.stem


def candidates(home):
    paths = sorted(
        home.glob(".claude/projects/*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True
    )[:60]
    return [
        dict(id=p.stem, path=str(p.resolve()), name=p.stem, cwd="", updated=int(p.stat().st_mtime))
        for p in paths
        if accepts(p.resolve(), home)
    ]


def process_id(pid, home):
    return metadata(
        home / ".claude/sessions" / (str(pid) + ".json"), home / ".claude/sessions"
    ).get("sessionId")


def parts(path, home):
    return [(path, None)], []


def preview(row, field):
    if field == "claude":
        return "Conversation compacted."
    if not field.startswith("claude:"):
        return "This field is not available for preview."
    content = (row.get("message") or {}).get("content", [])
    if isinstance(content, str):
        content = [{"type": "text", "text": content}]
    part = content[int(field.split(":")[1])]
    return visible_text(part.get("input", part.get("content", part)))


def consume(accounting, row, path, line):
    typ, ts = row.get("type"), row.get("timestamp", "")
    if typ == "system" and row.get("subtype") == "compact_boundary":
        accounting.segment += 1
        accounting.add("summary", "Compaction boundary", "", path, line, ts, "claude")
        return
    msg = row.get("message") or {}
    if typ not in ("user", "assistant") or not isinstance(msg, dict):
        return
    accounting.model = msg.get("model") or accounting.model
    usage = object_value(msg.get("usage"))
    if "input_tokens" in usage:
        # Claude reports uncached, cache-read and cache-write inputs as separate buckets.
        value = sum(
            usage.get(k, 0) or 0
            for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
        )
        accounting.reported = dict(
            input=value,
            cached=usage.get("cache_read_input_tokens", 0),
            output=usage.get("output_tokens", 0),
            timestamp=ts,
            window=None,
        )
        accounting.samples.append(dict(accounting.reported, afterId=len(accounting.events) - 1))
    content = msg.get("content", [])
    if isinstance(content, str):
        content = [{"type": "text", "text": content}]
    for index, part in enumerate(content):
        if not isinstance(part, dict):
            continue
        field = "claude:" + str(index)
        kind = part.get("type")
        if kind in ("thinking", "redacted_thinking"):
            accounting.hidden_reasoning += 1
            continue
        if kind == "tool_use":
            accounting.add(
                "calls",
                part.get("name", "Tool call"),
                visible_text(part.get("input")),
                path,
                line,
                ts,
                field,
            )
        elif kind == "tool_result":
            accounting.add(
                "results",
                "Tool result",
                visible_text(part.get("content")),
                path,
                line,
                ts,
                field,
            )
        else:
            text = visible_text(part)
            if typ == "user":
                accounting.turn += 1
            accounting.add(
                "user" if typ == "user" else "assistant",
                "Your prompt" if typ == "user" else "Assistant reply",
                text,
                path,
                line,
                ts,
                field,
            )
