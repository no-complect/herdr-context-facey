"""Versioned JSON boundary shared by the CLI and session service."""

import json
import re

VERSION = 1
PROVIDERS = ("codex", "claude", "grok", "agy")


class ReaderError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def failure(code, message):
    return dict(version=VERSION, status="error", error=dict(code=code, message=message))


def invalid():
    raise ReaderError("invalid_request", "The session reader request is invalid or unsupported.")


def validate_session(session):
    if not isinstance(session, dict) or session.get("provider") not in PROVIDERS:
        invalid()
    if not all(isinstance(session.get(key), str) and session[key] for key in ("id", "path")):
        invalid()


def parse_request(raw):
    try:
        request = json.loads(raw)
    except ValueError:
        invalid()
    if not isinstance(request, dict) or type(request.get("version")) is not int:
        invalid()
    if request["version"] != VERSION:
        invalid()
    action = request.get("action", "summary")
    if action not in ("summary", "detail"):
        invalid()
    if action == "detail":
        validate_session(request.get("session"))
        if type(request.get("line")) is not int or request["line"] <= 0:
            invalid()
        if not isinstance(request.get("source"), str) or not request["source"]:
            invalid()
        if not isinstance(request.get("record_hash"), str) or not re.fullmatch(
            r"[a-f0-9]{64}", request["record_hash"]
        ):
            invalid()
        if not isinstance(request.get("revision"), str) or not request["revision"]:
            invalid()
        if not isinstance(request.get("field", ""), str):
            invalid()
        if type(request.get("protected", False)) is not bool:
            invalid()
    else:
        if request.get("provider") not in PROVIDERS:
            invalid()
        for key in ("path", "session_id", "title", "cwd", "address", "revision"):
            if request.get(key) is not None and not isinstance(request[key], str):
                invalid()
        pid = request.get("pid")
        if pid is not None and (type(pid) is not int or pid <= 0):
            invalid()
    return request
