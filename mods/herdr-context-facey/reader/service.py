"""Orchestrate discovery and accounting; provider formats stay in their adapters."""

import collections
import hashlib
import json
import re
import subprocess
from pathlib import Path

from .accounting import CATEGORIES, Accounting, redact
from .protocol import VERSION, ReaderError, failure, parse_request
from .providers import (
    adapter_for,
    allowed,
    canonical_session,
    get_provider,
    process_session,
    session_id,
)
from .sources import MAX_EVENTS, ReadBudget, record_at


def resolve(request, home):
    provider = request.get("provider", "codex")
    adapter = get_provider(provider)
    candidates = adapter.candidates(home)
    if request.get("path"):
        chosen = canonical_session(request["path"], home, provider)
        return chosen, candidates, None, "Selected session"
    sid = request.get("session_id")
    if sid:
        match = [c for c in candidates if c["id"] == sid]
        if len(match) == 1:
            return Path(match[0]["path"]), candidates, None, "Session identifier"
    # Open-file identity is stronger than folder or recency. Never inspect process environments.
    pid = request.get("pid")
    if isinstance(pid, int) and pid > 0:
        try:
            proc = subprocess.run(
                ["lsof", "-a", "-p", str(pid), "-Fn"], capture_output=True, text=True, timeout=2
            )
            opened = []
            for line in proc.stdout.splitlines():
                if line.startswith("n"):
                    try:
                        p = process_session(line[1:], home, provider)
                        if p.is_file():
                            opened.append(p)
                    except ValueError:
                        pass
            if len(set(opened)) == 1:
                return opened[0], candidates, None, "Foreground process file"
        except (OSError, subprocess.TimeoutExpired):
            pass
    if hasattr(adapter, "process_id") and isinstance(pid, int):
        sid = adapter.process_id(pid, home)
        match = [c for c in candidates if c["id"] == sid]
        if len(match) == 1:
            return Path(match[0]["path"]), candidates, None, "Claude process session"
    title = re.sub(r"^[^\w]+", "", request.get("title") or "").strip().split(" | ")[0].strip()
    if len(title) >= 8:
        matches = [c for c in candidates if c["name"].strip() == title]
        if matches:
            # A continued thread may retain its name. Remove recorded ancestors,
            # and follow a single leaf; independent same-name sessions stay ambiguous.
            ancestors = set()
            if hasattr(adapter, "ancestors"):
                for candidate in matches:
                    ancestors.update(adapter.ancestors(Path(candidate["path"])))
            leaves = [c for c in matches if c["id"] not in ancestors]
            if len(leaves) == 1:
                return (
                    Path(leaves[0]["path"]),
                    candidates,
                    None,
                    "Session name and recorded continuation",
                )
    near = [c for c in candidates if c.get("cwd") == request.get("cwd")]
    # A folder alone cannot establish which conversation the terminal is showing.
    return (
        None,
        near or candidates[:15],
        "Choose the session to inspect. A folder alone does not identify a conversation.",
        "",
    )


def summarize(path, home):
    path = allowed(path, home)
    adapter = adapter_for(path, home)
    parts, notes = adapter.parts(path, home)
    accounting = Accounting()
    if hasattr(adapter, "prepare"):
        adapter.prepare(accounting, path, home)
    budget = ReadBudget()
    for record in budget.records(parts):
        accounting.record_hash = record.digest
        try:
            adapter.consume(accounting, record.row, record.source, record.line)
        except (ValueError, TypeError):
            # Invalid external field values are partial data, not an empty session.
            accounting.malformed += 1
    accounting.malformed += budget.malformed
    notes.extend(budget.notes)
    if hasattr(adapter, "finish"):
        adapter.finish(accounting)
    if accounting.truncated_records:
        notes.append(
            "The provider truncated some recorded fields; text estimates and previews are partial."
        )
    if accounting.malformed:
        notes.append(
            str(accounting.malformed)
            + " incomplete or unsupported records skipped; a pending write is retried on refresh."
        )
    if accounting.hidden_reasoning:
        notes.append(
            "Private reasoning is excluded. Only ordinary messages, tool records and usage counters are inspected."
        )
    if accounting.media:
        notes.append(
            "Image/audio payloads are omitted from text estimates; they may still consume model context."
        )
    if accounting.opaque_compaction:
        notes.append(
            "The compacted summary is opaque in this session format. Its content and token cost cannot be reconstructed; the reported usage still includes provider-accounted context."
        )
    events = accounting.events
    # Preserve the beginning, largest contributors and latest events within a bounded UI payload.
    if len(events) > MAX_EVENTS:
        kept = {
            e["id"]: e
            for e in events[-3500:]
            + sorted(events, key=lambda e: e["tokens"], reverse=True)[:1000]
            + events[:500]
        }
        events = sorted(kept.values(), key=lambda e: int(e["id"]))[-MAX_EVENTS:]
        notes.append(
            "Event list is capped at 5,000 entries; category estimates cover the retained entries only."
        )
    return dict(
        partial=bool(
            accounting.malformed
            or accounting.truncated_records
            or budget.notes
            or len(accounting.events) > MAX_EVENTS
        ),
        events=events,
        recorded_events=len(accounting.events),
        latest_segment=accounting.segment,
        reported=accounting.reported,
        model=accounting.model,
        notes=notes,
        usage_samples=accounting.samples[-2000:],
        files=len(parts),
        persistent=accounting.persistent,
        all_totals=dict(
            collections.Counter(
                {
                    c: sum(e["tokens"] for e in accounting.events if e["category"] == c)
                    for c in CATEGORIES
                }
            )
        ),
        method="Text estimate = UTF-8 bytes / 4. Category estimates are not an exact decomposition of reported input tokens.",
    )


def signature(path, home):
    adapter = adapter_for(path, home)
    parts = (
        adapter.revision_parts(path, home)
        if hasattr(adapter, "revision_parts")
        else adapter.parts(path, home)[0]
    )
    values = [
        (
            str(p),
            p.stat().st_mtime_ns if end is None else end,
            p.stat().st_size if end is None else end,
        )
        for p, end in parts
    ]
    return hashlib.sha256(json.dumps(values).encode()).hexdigest()


def detail(request, home):
    path = allowed(request["source"], home)
    if request.get("protected"):
        return dict(
            text="Runtime and developer instruction content is not displayed. Only its recorded size is estimated."
        )
    target = int(request["line"])
    if target <= 0:
        raise ReaderError("invalid_request", "Invalid event position.")
    record = record_at(path, target)
    if record is None or (request.get("record_hash") and record.digest != request["record_hash"]):
        raise ReaderError("stale_event", "This event changed. Refresh before previewing it.")
    try:
        text = redact(adapter_for(path, home).preview(record.row, request.get("field", "")))
    except (ValueError, IndexError, KeyError, TypeError):
        raise ReaderError(
            "unsupported_format", "This record has an unsupported preview format."
        ) from None
    return dict(text=text[:24000], truncated=len(text) > 24000)


def handle(raw, home):
    """Translate expected local-data failures once, at the process boundary."""
    try:
        request = parse_request(raw)
        if request.get("action") == "detail":
            session = request["session"]
            path = canonical_session(session["path"], home, session["provider"])
            if session_id(path, home) != session["id"]:
                raise ReaderError("invalid_request", "The event belongs to another session.")
            source = allowed(request["source"], home, session["provider"])
            parts, _ = adapter_for(path, home).parts(path, home)
            if source not in [part for part, _ in parts]:
                raise ReaderError("invalid_request", "The event belongs to another session.")
            return dict(version=VERSION, status="detail", **detail(request, home))
        path, candidates, reason, matched = resolve(request, home)
        if not path:
            return dict(
                version=VERSION,
                status="selection_required",
                code="ambiguous_session" if candidates else "no_session",
                candidates=candidates[:20],
                reason=reason,
            )
        provider = request["provider"]
        adapter = get_provider(provider)
        revision = signature(path, home)
        response = dict(
            version=VERSION,
            session=dict(id=session_id(path, home), path=str(path), provider=provider),
            revision=revision,
            candidates=candidates[:20],
            match=matched,
        )
        if revision == request.get("revision"):
            return dict(response, status="unchanged")
        snapshot = summarize(path, home)
        if signature(path, home) != revision:
            snapshot["partial"] = True
            snapshot["notes"].append(
                "The session changed during reading; a new snapshot will be read on refresh."
            )
        return dict(response, status="snapshot", capabilities=adapter.CAPABILITIES, **snapshot)
    except ReaderError as error:
        return failure(error.code, str(error))
    except PermissionError:
        return failure(
            "permission_denied",
            "The session reader does not have permission to read this local source.",
        )
    except OSError:
        return failure(
            "source_unavailable",
            "The local session source is unavailable. Select another session or refresh.",
        )
