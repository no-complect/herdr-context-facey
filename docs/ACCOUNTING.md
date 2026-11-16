# Accounting, compatibility and local data

## Reported usage and estimated text

The top gauge is the provider's **last reported input** for a model request,
not a sum across requests. It may lag an in-flight turn. Codex input already
includes cached input, so cached tokens are not added again. Claude's uncached,
cache-read and cache-creation input counters are separate and are summed.
Window capacity and percentage appear only when the session records them.

The category bar estimates captured text using **UTF-8 bytes / 4**, rounded up.
It helps locate large recorded contributions; it is not exact tokenization,
billing, or an exact decomposition of the active prompt. Labels for file reads,
memory and skills are inferred from Codex's associated tool command and can
contain mixed output. Persistent snapshots and saved replacement messages are
recorded evidence, not proof that every displayed item remains in context.

Codex's mirrored records are ignored. Fork history is followed only to explicit
recorded byte boundaries. Compaction begins a new segment. Saved replacement
messages are included when available; an opaque compacted summary cannot be
displayed or independently sized. Media payloads and private reasoning are
excluded from text estimates. These gaps can make the two totals differ.

**Claude coverage:** prompts, replies, tool calls/results, usage counters and
compaction markers are parsed. File reads appear under Tool results. Separate
startup-instruction, memory and skill accounting is not implemented for Claude.
The current Claude adapter does not infer context-window capacity.

## Compatibility and limits

Version **0.1.0** is an initial community release. The original integration was
tested on macOS with Herdr **0.1.15** and live Codex sessions, including compaction.
The user also confirmed a live Claude Code smoke test using Claude Code
**2.1.322**; the [Claude screenshot](screenshots/claude-panel.png) shows usage and pinned previews. This
does not establish accuracy for every Claude session format or tool combination.
Linux and Windows have not been checked live. Provider log formats can change.

Default local storage only:

- `~/.codex/sessions/` and the read-only `~/.codex/state_*.sqlite` thread index.
- `~/.claude/projects/` and optional `~/.claude/sessions/<pid>.json` process mapping.
- Optional `lsof` for foreground-session identification; it is not required when
  another reliable match or a manual selection is available.

Remote sessions, custom `CODEX_HOME`/`CLAUDE_CONFIG_DIR` storage, subagent context
aggregation, and complete reconstruction of the provider's prompt are not
supported. Only the 100 most recently indexed Codex threads or 60 recent Claude
files are candidates. A refresh reads up to 96 MiB across at most 16 lineage
files, skips records over 16 MiB, retains up to 5,000 events and 2,000 usage
samples, and limits previews to 24,000 characters. Partial reads are identified;
category totals cover retained entries when the event cap is reached.

## Local data

The runtime makes no network requests, reads no authentication files or process
environments, and installs no hooks. Python reads session logs and the Codex
index; it never edits transcripts or writes extra copies of their text. Previews
stay in the native panel and clear when its selected session changes. Runtime,
developer and tool-definition content is not previewed, and opaque reasoning is
not decrypted or displayed.

Common credential formats are redacted on a best-effort basis. Ordinary
conversation previews can still contain private information: review any
screenshots before sharing them. The supplied screenshots were provided for
this release; no session transcripts or local application configuration are
included in this repository.
