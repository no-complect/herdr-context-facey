# Contributing

Use two spaces for JavaScript, JSON, YAML and Markdown, and four spaces for
Python. `.editorconfig`, Prettier and Ruff keep formatting consistent. Name
reported usage and estimated text explicitly; keep them independent.

## Check a change

```sh
npm ci
python3 -m pip install -r requirements-dev.txt
npm test
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
files. No dependencies are needed by the tests; Prettier and Ruff are development
tools only. Node 22 is used in CI. The runtime is native Herdr JavaScript plus
Python's standard library.

## Live checks

Install the mod into Herdr and test a local session. Herdr's native check only
loads initial state. Verify session following, refresh, filtering, Largest,
pinned previews, replay, and narrow/expanded views. Exercise compaction with a
test session and compare Since compact with Whole history. Check that hidden
stack children pause polling. Keep unknown or opaque context explicitly unknown.

Describe which provider, session format, operating system and Herdr version you
tested. A user-confirmed smoke test is useful evidence, but does not establish
complete accounting accuracy. Changes are welcome under the MIT license.
