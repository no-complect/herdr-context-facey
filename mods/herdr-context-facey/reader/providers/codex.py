"""Codex rollouts, bounded lineage and response-item normalization."""

import json
import re
import sqlite3
from pathlib import Path

from ..accounting import object_value, redact, visible_text
from ..protocol import ReaderError
from ..sources import MAX_LINE

CAPABILITIES = dict(compaction=True, historical_usage=True)


def accepts(path, home):
    return path.suffix == ".jsonl" and path.is_relative_to((home / ".codex/sessions").resolve())


def validate(path, home):
    path = Path(path).expanduser().resolve()
    if not accepts(path, home):
        raise ReaderError("invalid_request", "Select a local Codex session file.")
    return path


def canonical(path, home):
    return validate(path, home)


def process_session(path, home):
    return validate(path, home)


def session_id(path):
    return path.stem.split("rollout-")[-1]


def header(path):
    try:
        with path.open("rb") as f:
            return json.loads(f.readline(MAX_LINE)).get("payload", {})
    except (OSError, ValueError):
        return {}


def candidates(home):
    rows = []
    for path in sorted(home.glob(".codex/state_*.sqlite"), reverse=True):
        try:
            with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=0.3) as db:
                db.row_factory = sqlite3.Row
                columns = {r[1] for r in db.execute("pragma table_info(threads)")}
                fields = [
                    k
                    for k in [
                        "id",
                        "rollout_path",
                        "name",
                        "title",
                        "cwd",
                        "updated_at",
                        "archived",
                    ]
                    if k in columns
                ]
                if not {"id", "rollout_path"}.issubset(columns):
                    continue
                rows = [
                    dict(r)
                    for r in db.execute(
                        "select "
                        + ",".join(fields)
                        + " from threads order by updated_at desc limit 100"
                    )
                ]
            break
        except sqlite3.Error:
            continue
    if not rows:
        paths = sorted(
            home.glob(".codex/sessions/*/*/*/*.jsonl"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )[:60]
        for p in paths:
            h = header(p)
            rows.append(
                dict(
                    id=h.get("id") or session_id(p),
                    rollout_path=str(p),
                    cwd=h.get("cwd"),
                    name="",
                    updated_at=int(p.stat().st_mtime),
                )
            )
    result = []
    for row in rows:
        try:
            path = validate(row["rollout_path"], home)
            if path.is_file():
                result.append(
                    dict(
                        id=row["id"],
                        path=str(path),
                        name=redact(str(row.get("name") or row.get("title") or row["id"]))[:100],
                        cwd=row.get("cwd", ""),
                        updated=row.get("updated_at", 0),
                    )
                )
        except (ValueError, TypeError, OSError):
            pass
    return result


def find_id(sid, home):
    if not isinstance(sid, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", sid):
        return None
    return next(home.glob(".codex/sessions/*/*/*/*" + sid + ".jsonl"), None)


def chain(path, home, seen=None, limit=None):
    seen = set() if seen is None else seen
    path = validate(path, home)
    if str(path) in seen or len(seen) >= 16:
        return [], ["Earlier lineage is unavailable or cyclic."]
    seen.add(str(path))
    h = header(path)
    base = h.get("history_base") or {}
    parent_id = base.get("thread_id") or h.get("forked_from_id")
    parts, notes = [], []
    if parent_id:
        parent = find_id(parent_id, home)
        boundary = base.get("end_byte_offset")
        if parent and isinstance(boundary, int) and boundary >= 0:
            parts, notes = chain(parent, home, seen, boundary)
        else:
            notes.append("Earlier fork history has no readable byte boundary; it is not included.")
    parts.append((path, limit))
    return parts, notes


def message(accounting, payload, path, line, ts, field=""):
    role = payload.get("role", "")
    text = visible_text(payload.get("content", []))
    category = "assistant" if role == "assistant" else "user"
    label = "Assistant reply" if role == "assistant" else "Your prompt"
    protected = role in ("system", "developer")
    if protected:
        category, label = "instructions", role.capitalize() + " instructions"
    elif role == "user":
        accounting.turn += 1
        if "AGENTS.md instructions" in text or "<INSTRUCTIONS>" in text:
            category, label = "instructions", "Agent instructions"
        elif "<environment_context>" in text:
            category, label = "environment", "Environment update"
        else:
            label = text.strip().split("\n")[0][:100] or label
    accounting.add(category, label, text, path, line, ts, field=field, protected=protected)


def consume(accounting, row, path, line):
    kind, p, ts = row.get("type"), row.get("payload", {}), row.get("timestamp", "")
    if not isinstance(p, dict):
        return
    if kind == "session_meta":
        base = p.get("base_instructions")
        text = base.get("text", "") if isinstance(base, dict) else base or ""
        accounting.add(
            "runtime",
            "Runtime instructions · recorded",
            text,
            path,
            line,
            ts,
            "base",
            "base",
            True,
        )
    elif kind == "world_state":
        state = object_value(p.get("state"))
        for key, category, label in [
            ("agents_md", "instructions", "Agent instruction snapshot"),
            ("top_level_tools", "tools", "Tool definitions snapshot"),
            ("environments", "environment", "Environment snapshot"),
            ("permissions", "environment", "Permission snapshot"),
        ]:
            if key in state:
                accounting.add(
                    category,
                    label,
                    visible_text(state[key]),
                    path,
                    line,
                    ts,
                    "world:" + key,
                    "world:" + key,
                    True,
                )
    elif kind == "turn_context":
        accounting.model = p.get("model") or accounting.model
    elif kind == "event_msg" and p.get("type") == "task_started":
        accounting.window = p.get("model_context_window") or accounting.window
    elif kind == "event_msg" and p.get("type") == "token_count":
        info = object_value(p.get("info"))
        usage = object_value(info.get("last_token_usage"))
        if isinstance(usage.get("input_tokens"), (int, float)):
            accounting.window = info.get("model_context_window") or accounting.window
            accounting.reported = dict(
                input=usage["input_tokens"],
                cached=usage.get("cached_input_tokens", 0),
                output=usage.get("output_tokens", 0),
                timestamp=ts,
                window=accounting.window,
            )
            accounting.samples.append(dict(accounting.reported, afterId=len(accounting.events) - 1))
    elif kind == "compacted":
        accounting.segment += 1
        accounting.add(
            "summary", "Compaction boundary", p.get("message") or "", path, line, ts, "compact"
        )
        # A replacement history is only shown when the recorder explicitly saves it.
        for index, replacement in enumerate(p.get("replacement_history") or []):
            if isinstance(replacement, dict) and replacement.get("type") == "message":
                message(accounting, replacement, path, line, ts, "replacement:" + str(index))
            elif isinstance(replacement, dict) and replacement.get("type") == "additional_tools":
                accounting.add(
                    "tools",
                    "Tool definitions after compaction",
                    visible_text(replacement.get("tools", [])),
                    path,
                    line,
                    ts,
                    persistent="world:top_level_tools",
                    protected=True,
                )
            elif isinstance(replacement, dict) and replacement.get("type") == "compaction":
                accounting.opaque_compaction = True
    elif kind == "response_item":
        typ = p.get("type")
        if typ == "message":
            message(accounting, p, path, line, ts)
        elif typ in ("function_call", "custom_tool_call"):
            name = p.get("name", "tool")
            text = visible_text(p.get("arguments", p.get("input", "")))
            accounting.calls[p.get("call_id")] = (name, text)
            accounting.add("calls", name, text, path, line, ts)
        elif typ in ("function_call_output", "custom_tool_call_output"):
            name, args = accounting.calls.get(p.get("call_id"), ("tool", ""))
            text = visible_text(p.get("output", ""))
            category = "results"
            if re.search(r"(?i)(?:\bread|\bcat\b|sed\b|read_file)", name + " " + args):
                category = (
                    "skills"
                    if "SKILL.md" in args
                    else "memory"
                    if re.search(r"MEMORY\.md|/memories/", args)
                    else "files"
                )
            accounting.add(category, name + " · result", text, path, line, ts)
        elif typ == "additional_tools":
            accounting.add(
                "tools",
                "Additional tool definitions",
                visible_text(p.get("tools", [])),
                path,
                line,
                ts,
                protected=True,
            )
        elif typ == "reasoning":
            accounting.hidden_reasoning += 1


def parts(path, home):
    return chain(path, home)


def ancestors(path):
    h = header(path)
    return {h.get("forked_from_id"), (h.get("history_base") or {}).get("thread_id")}


def preview(row, field):
    p = row.get("payload", {})
    if field.startswith("replacement:"):
        p = p.get("replacement_history", [])[int(field.split(":")[1])]
    if (
        row.get("type") in ("session_meta", "world_state")
        or p.get("role") in ("system", "developer")
        or p.get("type") == "reasoning"
    ):
        return "Runtime instruction and private reasoning content is not displayed."
    if field == "compact":
        return p.get("message") or "Conversation compacted."
    return visible_text(p.get("output", p.get("arguments", p.get("input", p.get("content", "")))))
