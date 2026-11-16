"""Bounded local-file reads. This module knows no provider record formats."""

import hashlib
import json
from pathlib import Path
from typing import NamedTuple

from .accounting import redact

MAX_BYTES = 96 * 1024 * 1024
MAX_LINE = 16 * 1024 * 1024
MAX_EVENTS = 5000


def metadata(path, root):
    """Read known metadata without following a link outside its approved root."""
    try:
        path = path.resolve()
        if not path.is_relative_to(root.resolve()):
            return {}
        with path.open("rb") as stream:
            raw = stream.read(MAX_LINE + 1)
        value = json.loads(raw) if len(raw) <= MAX_LINE else None
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def recent_candidates(candidates, home, accepts):
    result = []
    for candidate in candidates:
        try:
            source = Path(candidate["path"]).resolve()
            if accepts(source, home) and source.is_file():
                result.append(
                    dict(
                        candidate,
                        path=str(source),
                        name=redact(str(candidate["name"]))[:100],
                        updated=source.stat().st_mtime,
                    )
                )
        except (OSError, ValueError):
            continue
    return sorted(result, key=lambda candidate: candidate["updated"], reverse=True)[:60]


class Record(NamedTuple):
    row: dict
    source: Path
    line: int
    digest: str


class ReadBudget:
    def __init__(self, max_bytes=MAX_BYTES, max_line=MAX_LINE):
        self.max_bytes = max_bytes
        self.max_line = max_line
        self.used = 0
        self.malformed = 0
        self.notes = []

    def records(self, parts):
        for source, boundary in parts:
            with source.open("rb") as stream:
                line = 0
                while True:
                    if boundary is not None and stream.tell() >= boundary:
                        break
                    remaining = self.max_bytes - self.used
                    if remaining <= 0:
                        self.notes.append("The read limit was reached; this view is partial.")
                        return
                    raw = stream.readline(min(self.max_line + 1, remaining))
                    if not raw:
                        break
                    self.used += len(raw)
                    line += 1
                    if boundary is not None and stream.tell() > boundary:
                        self.malformed += 1
                        break
                    if len(raw) > self.max_line:
                        self.notes.append("An oversized record was skipped; this view is partial.")
                        while raw and not raw.endswith(b"\n"):
                            remaining = self.max_bytes - self.used
                            if remaining <= 0:
                                break
                            raw = stream.readline(min(self.max_line, remaining))
                            self.used += len(raw)
                        continue
                    if not raw.endswith(b"\n"):
                        self.malformed += 1
                        break
                    try:
                        row = json.loads(raw)
                    except ValueError:
                        self.malformed += 1
                        continue
                    if not isinstance(row, dict):
                        self.malformed += 1
                        continue
                    yield Record(row, source, line, hashlib.sha256(raw).hexdigest())


def record_at(path, line):
    for record in ReadBudget().records([(path, None)]):
        if record.line == line:
            return record
        if record.line > line:
            break
    return None
