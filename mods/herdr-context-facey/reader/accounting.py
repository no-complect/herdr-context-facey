import json
import math
import re

CATEGORIES = [
    "runtime",
    "instructions",
    "memory",
    "skills",
    "tools",
    "environment",
    "user",
    "files",
    "calls",
    "results",
    "assistant",
    "summary",
]


def redact(text):
    text = re.sub(
        r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----",
        "[private key redacted]",
        text,
        flags=re.S,
    )
    text = re.sub(
        r"\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b",
        "[credential redacted]",
        text,
    )
    text = re.sub(r"(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}", r"\1[redacted]", text)
    text = re.sub(
        r"""(?ix)(["']?(?:[a-z0-9_]*api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret[_-]?key)["']?\s*[:=]\s*)(["'])(.*?)(\2)""",
        lambda m: m[1] + m[2] + "[redacted]" + m[2],
        text,
    )
    return re.sub(
        r"""(?ix)(\b(?:[a-z0-9_]*api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret[_-]?key)\s*=\s*)(?!["'])([^\s;,]+)""",
        r"\1[redacted]",
        text,
    )


def visible_text(value):
    """Exclude media payloads, opaque reasoning and embeddings from text estimates."""
    if isinstance(value, str):
        # Tool output may itself be serialized JSON with base64 media fields.
        if value.lstrip().startswith(("{", "[")):
            try:
                return visible_text(json.loads(value))
            except (ValueError, RecursionError):
                pass
        return re.sub(r'data:(?:image|audio|video)/[^\s"\']+', "[media omitted]", value)
    if isinstance(value, list):
        return "\n".join(filter(None, (visible_text(v) for v in value)))
    if isinstance(value, dict):
        kind = value.get("type", "")
        if kind in ("reasoning", "thinking", "redacted_thinking"):
            return ""
        if any(word in kind for word in ("image", "audio", "video")):
            return "[media omitted]"
        if isinstance(value.get("text"), str):
            return visible_text(value["text"])
        if isinstance(value.get("content"), (list, str)):
            return visible_text(value["content"])
        return json.dumps(
            {
                k: visible_text(v)
                for k, v in value.items()
                if k not in ("encrypted_content", "data", "base64", "signature")
            },
            ensure_ascii=False,
        )
    return "" if value is None else str(value)


def estimate(text):
    return math.ceil(len(text.encode("utf-8")) / 4)


def valid_count(value):
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )


def object_value(value):
    """Reject malformed external object fields before format-specific access."""
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("Expected a recorded object field.")
    return value


def result_category(name, arguments):
    if re.search(r"(?i)(?:read|view_file|\bcat\b|\bsed\b)", name + " " + arguments):
        return (
            "skills"
            if "SKILL.md" in arguments
            else "memory"
            if re.search(r"MEMORY\.md|/memories/", arguments)
            else "files"
        )
    return "results"


class Accounting:
    def __init__(self):
        self.events = []
        self.calls = {}
        self.segment = 0
        self.turn = 0
        self.reported = None
        self.samples = []
        self.model = ""
        self.window = None
        self.hidden_reasoning = 0
        self.malformed = 0
        self.media = 0
        self.opaque_compaction = False
        self.truncated_records = False
        self.persistent = {}
        self.record_hash = ""

    def add(
        self,
        category,
        label,
        text,
        path,
        line,
        timestamp,
        field="",
        persistent=None,
        protected=False,
    ):
        if not text and category != "summary":
            return
        event = dict(
            id=str(len(self.events)),
            record_hash=self.record_hash,
            category=category,
            label=redact(label)[:110],
            tokens=estimate(text),
            bytes=len(text.encode("utf-8")),
            timestamp=timestamp,
            segment=self.segment,
            turn=self.turn,
            source=str(path),
            line=line,
            field=field,
            persistent=persistent,
            protected=protected,
            teaser="Instruction content is not displayed."
            if protected
            else redact(text[:600])[:160],
        )
        if persistent:
            self.persistent[persistent] = event["id"]
        self.media += text.count("[media omitted]")
        self.events.append(event)
