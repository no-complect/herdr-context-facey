# Contributing

Use two spaces for TypeScript, JavaScript, JSON, YAML and Markdown, and four spaces for
Python. `.editorconfig`, Prettier and Ruff keep formatting consistent. Name
reported usage and estimated text explicitly; keep them independent.

## Check a change

```sh
npm ci
python3 -m pip install -r requirements-dev.txt
npm test
npm run typecheck:herdr
python3 -m unittest discover -s tests -v
npm run format:check
python3 -m ruff check .
python3 -m ruff format --check .
herdr-app check mods/herdr-context-facey
```

To apply formatting:

```sh
npm run format
python3 -m ruff format .
```

Python tests create synthetic sessions in temporary directories. Never commit
real transcripts, provider credentials, local Herdr state, or generated editor
files. Node 22 is used in CI. TypeScript, Node declarations, Prettier and Ruff are
development tools only. The runtime remains native Herdr JavaScript plus Python's
standard library; installation requires no Node or TypeScript build.

## TypeScript sources and generated runtime

Edit the six modules in `src/`, then run `npm run build`. This compiles strict
TypeScript to the checked-in `.js` files under `mods/herdr-context-facey/` and
formats that output. Do not edit generated JavaScript directly. `npm test` builds
first, checks source and tooling types, checks the negative type examples under
`tests/types/`, and runs the existing Node tests against the emitted JavaScript.
CI rejects runtime output that differs from a fresh build. Use `npm run build:watch`
while developing, then run the normal build before committing.

`src/contracts.d.ts` describes session identity, events, usage and the versioned
reader protocol. Responses are discriminated unions; the JSON decoder validates
the subprocess boundary before data enters typed panel state. Keep that runtime
validation even when the compiler accepts a change.

Portable host contracts in `types/` cover only the native APIs this mod consumes.
They allow CI to check all source files without installing the desktop app.
With Herdr installed, `npm run typecheck:herdr` substitutes its current generated
`gpui-kit.d.ts` and `herdr.d.ts`. Start Herdr once if those files do not exist;
set `HERDR_APP_HOME` for a non-default installation. It skips upstream declaration
internals but checks this mod's source in strict mode against their API signatures.
Do not commit the generated host declaration files. Also run the native check and
live checks below: types cannot verify native handle or callback lifetimes.

## Live checks

Install the mod into Herdr and test a local session. Herdr's native check only
loads initial state. Verify session following, refresh, filtering, Largest,
pinned previews, replay, and narrow/expanded views. Exercise compaction with a
test session and compare Since compact with Whole history. Check that hidden
stack children pause polling. Keep unknown or opaque context explicitly unknown.

Describe which provider, session format, operating system and Herdr version you
tested. A user-confirmed smoke test is useful evidence, but does not establish
complete accounting accuracy. Changes are welcome under the MIT license.
