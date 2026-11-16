"""Grok retained chat snapshots and the saved context-estimate stream."""

from pathlib import Path

from ..accounting import object_value, result_category, valid_count, visible_text
from ..protocol import ReaderError
from ..sources import metadata, recent_candidates

CAPABILITIES = dict(compaction=False, historical_usage=False)


def accepts(path, home):
    root = (home / ".grok/sessions").resolve()
    return (
        path.is_relative_to(root)
        and len(path.relative_to(root).parts) == 3
        and path.name in ("chat_history.jsonl", "updates.jsonl")
    )


def canonical(path, home):
    return Path(path).expanduser().resolve().with_name("chat_history.jsonl").resolve()


def process_session(path, home):
    path = Path(path).expanduser().resolve()
    root = (home / ".grok/sessions").resolve()
    if (
        path.is_relative_to(root)
        and len(path.relative_to(root).parts) == 3
        and path.name
        in (
            "events.jsonl",
            "chat_history.jsonl.lock",
            "updates.jsonl.lock",
            "chat_history.jsonl",
            "updates.jsonl",
        )
    ):
        return canonical(path, home)
    raise ReaderError("invalid_request", "This open file is not a Grok session.")


def session_id(path):
    return path.parent.name


def candidates(home):
    candidates = []
    for source in home.glob(".grok/sessions/*/*/summary.json"):
        data = metadata(source, home / ".grok/sessions")
        info = data.get("info") or {}
        if isinstance(info, dict):
            candidates.append(
                dict(
                    id=info.get("id") or source.parent.name,
                    path=str(source.with_name("chat_history.jsonl")),
                    name=data.get("title") or data.get("generated_title") or source.parent.name,
                    cwd=info.get("cwd", ""),
                )
            )
    return recent_candidates(candidates, home, accepts)


def parts(path, home):
    result = [(path, None)]
    updates = path.with_name("updates.jsonl").resolve()
    if accepts(updates, home) and updates.is_file():
        result.append((updates, None))
    notes = [
        "Grok shows its own context estimate and the retained chat history. Compaction or rewind can replace that history; pre-compaction history and earlier usage replay are unavailable.",
        "Grok tool definitions outside the chat history are not included in captured text.",
    ]
    return result, notes


def revision_parts(path, home):
    result, _ = parts(path, home)
    summary = path.with_name("summary.json").resolve()
    if summary.is_relative_to((home / ".grok/sessions").resolve()) and summary.is_file():
        result.append((summary, None))
    return result


def prepare(accounting, path, home):
    accounting.model = (
        metadata(path.with_name("summary.json"), home / ".grok/sessions").get("current_model_id")
        or ""
    )


def finish(accounting):
    if accounting.reported:
        accounting.samples = [dict(accounting.reported, afterId=len(accounting.events) - 1)]


def preview(row, field):
    if row.get("type") in ("system", "reasoning") or row.get("synthetic_reason") not in (
        None,
        "human",
        "compaction_meta",
    ):
        return "Runtime instruction and private reasoning content is not displayed."
    if field == "grok:content":
        return visible_text(row.get("content", ""))
    if field.startswith("grok:call:"):
        return visible_text(
            row.get("tool_calls", [])[int(field.split(":")[-1])].get("arguments", "")
        )
    return "This field is not available for preview."


def usage(accounting, row):
    params = object_value(row.get("params"))
    meta = object_value(params.get("_meta"))
    value = meta.get("totalTokens")
    if valid_count(value):
        accounting.reported = dict(
            input=value,
            cached=0,
            output=0,
            window=None,
            timestamp=row.get("timestamp", ""),
            kind="context",
            label="CONTEXT ESTIMATE",
        )


def consume_history(accounting, row, path, line):
    typ, ts = row.get("type"), row.get("timestamp", "")
    text = visible_text(row.get("content", ""))
    reason = row.get("synthetic_reason")
    if typ == "reasoning":
        accounting.hidden_reasoning += 1
    elif typ == "system":
        accounting.add(
            "runtime",
            "Runtime instructions · recorded",
            text,
            path,
            line,
            ts,
            "grok:content",
            protected=True,
        )
    elif typ == "user":
        if reason == "compaction_meta":
            # This file is a retained snapshot, not an append-only pre-compaction log.
            accounting.add(
                "summary", "Compacted history · recorded", text, path, line, ts, "grok:content"
            )
        elif reason and reason != "human":
            accounting.add(
                "instructions",
                "Runtime injection · " + str(reason),
                text,
                path,
                line,
                ts,
                "grok:content",
                protected=True,
            )
        else:
            accounting.turn += 1
            accounting.add("user", "Your prompt", text, path, line, ts, "grok:content")
    elif typ == "assistant":
        accounting.model = row.get("model_id") or accounting.model
        accounting.add("assistant", "Assistant reply", text, path, line, ts, "grok:content")
        for index, call in enumerate(row.get("tool_calls") or []):
            if not isinstance(call, dict):
                continue
            name = call.get("name") or "Tool call"
            args = visible_text(call.get("arguments", ""))
            accounting.calls[call.get("id")] = (name, args)
            accounting.add("calls", name, args, path, line, ts, "grok:call:" + str(index))
    elif typ == "tool_result":
        name, args = accounting.calls.get(row.get("tool_call_id"), ("Tool", ""))
        accounting.add(
            result_category(name, args),
            name + " · result",
            text,
            path,
            line,
            ts,
            "grok:content",
        )


def consume(accounting, row, path, line):
    if path.name == "updates.jsonl":
        usage(accounting, row)
    else:
        consume_history(accounting, row, path, line)
