# Herdr Context Facey

A context inspector inside [Herdr](https://herdr.dev/) for **Codex**,
**Claude Code**, **Grok Build**, and **Antigravity CLI** (`agy`, also called Gemini AGY).
Follow an agent's session, see recorded usage, and inspect the messages and tool
results contributing to its captured context.

[<img src="preview.png" alt="Context sidebars for Codex, Claude Code, AGY, and Grok Build" width="680">](preview.png)

## Install

Run this in your agent:

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/no-complect/herdr-context-facey
```

Requires Herdr and **Python 3.9+** available as `python3`. Tested on macOS.
Works with your existing layout. No API keys, hooks, or extra services are needed.
See [manual setup and shortcuts](docs/INSTALL.md).

## Use

Focus a supported agent terminal, then open **Context**. It refreshes every
five seconds while visible. Use **Session** to select a session manually.

Filter by category, switch between **Timeline** and **Largest**, and click an
entry to pin its text preview. **Expand** opens a larger view. Historical replay
and compaction views depend on what the provider records.

## What the numbers mean

- **Last reported input** is the latest recorded input-token count and may lag a
  running turn. Grok shows its recorded **Context estimate** instead.
- **Captured text** estimates the size of retained text using UTF-8 bytes divided
  by four. It is not an exact count of the agent's active prompt.

The mod reads default local session history without changing it or making network
requests. Coverage varies by provider; AGY requires a generated `transcript.jsonl`.
Previews can contain private text, so review screenshots before sharing.
See [accounting, supported formats, and limitations](docs/ACCOUNTING.md).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and checks,
[architecture](docs/ARCHITECTURE.md) for the code structure, and
[RECIPE.md](RECIPE.md) for the Herdr recipe.

## License

[MIT](LICENSE).
