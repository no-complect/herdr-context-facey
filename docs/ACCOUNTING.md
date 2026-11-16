# Accounting, compatibility and local data

## Reported usage and estimated text

The top gauge is the provider's **last reported input** for a model request,
not a sum across requests. It may lag an in-flight turn. Codex input already
includes cached input, so cached tokens are not added again. Claude's uncached,
cache-read and cache-creation input counters are separate and are summed.
Window capacity and percentage appear only when the session records them.

**Grok Build:** the gauge is labeled **Context estimate**. It
reads the latest `_meta.totalTokens` from the saved update stream, the same
estimated context counter used by Grok's pager. It is neither cumulative billed
usage nor an exact last-input count. Capacity is left unknown. Captured text
comes from `chat_history.jsonl`, not from mirrored streaming chunks. That file
is retained model-facing history: compaction and rewind may replace it. Since
compact and Whole history both show that retained snapshot; pre-compaction
history is unavailable. Only the latest context counter is attached to the end
of the snapshot, so earlier replay positions show no usage sample. Runtime and
synthetic instruction injections are protected from previews. External tool
definitions are not counted.

**Antigravity CLI (`agy`, sometimes called Gemini AGY):** reads the generated
step transcript. `PLANNER_RESPONSE.input_tokens` and `cache_read_tokens` are
separate buckets and are summed once; they are not accumulated across responses.
User inputs, ordinary replies, tool-call arguments and generic result steps are
included. The mirrored `transcript_full.jsonl` and `thinking` fields are excluded.
Provider-truncated fields are marked partial. The observed format does not
record model/window capacity, startup instructions or explicit compaction
boundaries, so these are left unknown rather than inferred. Generic steps stay
under Tool results; no separate file/memory/skill classification is claimed.

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
- `~/.grok/sessions/<workspace>/<session>/chat_history.jsonl`, optional
  `updates.jsonl` for the context counter, and `summary.json` for discovery/model.
- `~/.gemini/antigravity-cli/brain/<session>/.system_generated/logs/transcript.jsonl`
  and the equivalent path under `~/.gemini/antigravity/brain/`. The known
  `cache/conversation_metadata.json` provides titles and workspace identities.
  Older database-only conversations are not read. Legacy Gemini CLI (`gemini`)
  is a different format and is not included in this adapter.
- Optional `lsof` for foreground-session identification; it is not required when
  another reliable match or a manual selection is available.
  Grok's open `events.jsonl` or session lock identifies its sibling chat history;
  AGY's open `presence/<session>.lock` identifies the generated transcript. Only
  their paths are used; lock files, settings, and event logs are not read. Multiple
  distinct sessions held by the same process remain ambiguous.

Remote sessions, custom `CODEX_HOME`/`CLAUDE_CONFIG_DIR` storage, subagent context
aggregation, and complete reconstruction of the provider's prompt are not
supported. Only the 100 most recently indexed Codex threads or 60 recent sessions
for each other provider are candidates. A refresh reads up to 96 MiB across at most 16 lineage
files, skips records over 16 MiB, retains up to 5,000 events and 2,000 usage
samples, and limits previews to 24,000 characters. Partial reads are identified;
category totals cover retained entries when the event cap is reached.

## Local data

The runtime makes no network requests, reads no authentication files or process
environments, and installs no hooks. Python reads session logs and the Codex
index and the known discovery metadata listed above; it never edits transcripts
or writes extra copies of their text. Previews
stay in the native panel and clear when its selected session changes. Runtime,
developer and tool-definition content is not previewed, and opaque reasoning is
not decrypted or displayed.

Common credential formats are redacted on a best-effort basis. Ordinary
conversation previews can still contain private information: review any
screenshots before sharing them. The supplied screenshots were provided for
this release; no session transcripts or local application configuration are
included in this repository.

## Format references

- [Grok session storage](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md)
  and [the update counter implementation](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/session/acp_session_impl/updates.rs).
- [Antigravity transcript location and usage metadata](https://antigravity.google/docs/cli/statusline/).
  The step-record adapter was checked against locally generated CLI transcripts;
  the generated transcript schema is not a stable public API.
