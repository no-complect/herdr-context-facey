# Architecture

The mod is authored in strict TypeScript and compiled to native GPUI JavaScript,
with a Python standard-library subprocess for local session files. Installation
still copies one mod directory. There is no
runtime package installation, service, transcript cache, or browser layer.

The six source modules in `src/` emit the corresponding runtime files below.
`src/contracts.d.ts` defines the protocol and domain types without runtime output.

```text
mods/herdr-context-facey/
  main.js                   GPUI elements, lifecycle, native editor handles
  session-controller.js     Refresh ordering, selected snapshot, pinned previews
  reader-client.js          Subprocess invocation and response validation
  model.js                  Pure event filtering, estimates and usage replay
  target.js                 Herdr focus and supported agent identity
  visibility.js             Layout visibility rules
  inspect_session.py        CLI and final unexpected-failure containment
  reader/
    protocol.py             Request validation and structured error envelopes
    service.py              Discovery and snapshot/preview orchestration
    sources.py              Bounded file reads and record fingerprints
    accounting.py           Shared text accounting and normalized event creation
    providers/
      __init__.py           Closed registry and approved-path validation
      codex.py              Codex discovery, lineage, records and previews
      claude.py             Claude discovery, records and previews
      grok.py               Grok discovery, retained history and context estimate
      agy.py                Antigravity discovery, generated steps and usage
```

Provider adapters own their source shapes, session IDs, process-file identities,
candidate discovery, parsing, previews and capabilities. Shared orchestration
does not switch on provider names to interpret records. Optional adapter hooks
handle Codex ancestry, Claude process metadata and Grok's saved usage stream.

## State and identity

Each panel owns a controller. It receives an asynchronous reader function and has
no native UI, timer or application-context dependency. The view starts work and
awaits it in `cx.spawn`; native editor handles stay in the view and are released
when their preview changes or the view closes.

Every summary request has a monotonically increasing generation. Only the active
generation can update data, errors or the busy flag. Selecting A, B, then A again
does not make the first A request current. Closing invalidates pending work.

A resolved session is `{provider, id, path}`. A snapshot also has a `revision`
derived from its source metadata. The next summary request sends that revision,
allowing the reader to return `unchanged` without reparsing the transcript.

Event `id` is an ordinal for ordering and replay, not a globally stable identity.
A preview reference combines the session, event ordinal, source path, physical
line, field and SHA-256 `record_hash`. The reader verifies the fingerprint before
returning text. A changed or removed record produces `stale_event` rather than
text from the replacement record. Appending a different record preserves valid
previews; replacing a selected record or changing sessions clears preview/replay
state. No additional copy of the transcript is stored.

## Reader protocol version 1

Requests include `version: 1` and use either the default `summary` action or
`action: "detail"`. Summary requests carry the selected provider and available
terminal identity, an optional manually selected path, and the last revision.
Detail requests carry the resolved session, revision and event reference above.

Every response has `version: 1` and one status:

| Status               | Meaning                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `snapshot`           | Session, revision, capabilities, events, usage, notes and `partial` flag. |
| `unchanged`          | Same resolved session/revision; retain the previous event payload.        |
| `selection_required` | `no_session` or `ambiguous_session`, with candidates and a reason.        |
| `detail`             | Verified preview text and optional truncation flag.                       |
| `error`              | An error object with a stable code and safe user-facing message.          |

The TypeScript client narrows responses by `status`; summary calls cannot return
a detail response to the controller. `SessionController.snapshot` exposes only
snapshot data to the view, while selection-required data retains its distinct
reason and candidates. Parsed JSON starts as `unknown` and crosses into this
typed union only after validation, including optional UI metadata and nullable
unrecorded values.

Error codes distinguish `invalid_request`, `stale_event`, `unsupported_format`,
`permission_denied`, `source_unavailable` and unexpected `reader_failed` errors.
The JavaScript client separately classifies launch/timeout failures as
`reader_unavailable` and malformed or incompatible responses as `invalid_response`.
Raw stderr and exception messages containing local data are not shown in the panel.

Capabilities describe recorded compaction boundaries and historical usage.
Providers without recorded boundaries display Recorded history. Usage estimates
retain their provider-specific meaning; they are not silently converted into
reported request input. A source changing during a read is marked partial and
retains the earlier revision so the next poll reads it again.

The existing byte, line, lineage and output limits remain. The event limit bounds
the returned UI payload; parsing still accumulates events before selecting the
first, largest and most recent entries. This refactor adds no persistent cache.

## Testing changes

Start with a failing regression for changed behavior, make the smallest fix, then
refactor under the green tests. The controller tests cover out-of-order reads,
session replacement, preview invalidation, appends, manual selection and close.
Python tests cover accounting, path boundaries, malformed records and CLI outcomes.
The cross-language round-trip test sends synthetic fixtures for all four providers
through the real CLI and production JavaScript response validator.

```sh
npm test
npm run typecheck:herdr
python3 -m unittest discover -s tests -v
npm run format:check
python3 -m ruff check .
python3 -m ruff format --check .
herdr-app check mods/herdr-context-facey
```

`npm test` compiles the source first and tests the emitted JavaScript. The build
targets ES2022 modules, preserving the native runtime's imports and initialization
order. View state uses TypeScript `declare` fields because GPUI initializes state
in `init`; these annotations emit no class-field initializers. CI checks the portable
host contracts and compile-time negative examples, then verifies the checked-in
runtime matches a fresh build. A local check against Herdr's generated declarations
checks the installed host version as well; see [Contributing](../CONTRIBUTING.md).

Node tests use Python for the cross-language check. Fixture homes are temporary;
tests do not read the developer's actual provider sessions. A native Herdr load
check and live interaction remain necessary because Node cannot render GPUI.
