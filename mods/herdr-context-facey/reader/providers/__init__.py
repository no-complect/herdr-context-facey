"""The supported providers form a closed registry, not a plugin discovery system."""

from pathlib import Path

from ..protocol import ReaderError
from . import agy, claude, codex, grok

PROVIDERS = dict(codex=codex, claude=claude, grok=grok, agy=agy)


def get_provider(provider):
    if provider not in PROVIDERS:
        raise ReaderError("invalid_request", "Select a supported local agent session.")
    return PROVIDERS[provider]


def provider_of(path, home):
    path = Path(path).expanduser().resolve()
    for name, adapter in PROVIDERS.items():
        if adapter.accepts(path, home):
            return name
    raise ReaderError(
        "invalid_request",
        "Select a local Codex, Claude Code, Grok Build or Antigravity transcript.",
    )


def adapter_for(path, home):
    return get_provider(provider_of(path, home))


def allowed(path, home, provider=None):
    path = Path(path).expanduser().resolve()
    actual = provider_of(path, home)
    if provider is not None and actual != provider:
        raise ReaderError("invalid_request", "The selected transcript belongs to another provider.")
    return path


def canonical_session(path, home, provider):
    path = allowed(path, home, provider)
    return allowed(get_provider(provider).canonical(path, home), home, provider)


def process_session(path, home, provider):
    path = get_provider(provider).process_session(path, home)
    return allowed(path, home, provider)


def session_id(path, home):
    return adapter_for(path, home).session_id(path)
