import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createReader } from "../mods/herdr-context-facey/reader-client.js";

test("all four Python providers round-trip through the production JavaScript client", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "facey-contract-")));
  const entry = fileURLToPath(
    new URL("../mods/herdr-context-facey/inspect_session.py", import.meta.url),
  );
  const harness = fileURLToPath(new URL("./helpers/reader_harness.py", import.meta.url));
  const read = createReader(async (_command, args) => {
    const result = await promisify(execFile)("python3", [harness, entry, home, args[2]]);
    return { code: 0, ...result };
  }, entry);
  const cases = [
    [
      "codex",
      ".codex/sessions/2026/11/16/rollout-test0000.jsonl",
      { type: "response_item", payload: { type: "message", role: "user", content: "hello" } },
    ],
    [
      "claude",
      ".claude/projects/project/session.jsonl",
      { type: "user", message: { content: "hello" } },
    ],
    [
      "grok",
      ".grok/sessions/workspace/session/chat_history.jsonl",
      { type: "user", content: "hello" },
    ],
    [
      "agy",
      ".gemini/antigravity-cli/brain/session/.system_generated/logs/transcript.jsonl",
      { type: "USER_INPUT", content: "hello" },
    ],
  ];
  try {
    for (const [provider, relative, row] of cases) {
      const path = join(home, relative);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, JSON.stringify(row) + "\n");
      const data = await read({ provider, path });
      assert.equal(data.status, "snapshot", provider);
      assert.equal(data.events[0].category, "user", provider);
      const detail = await read({
        action: "detail",
        session: data.session,
        revision: data.revision,
        ...data.events[0],
      });
      assert.equal(detail.text, "hello", provider);
      assert.equal(
        (await read({ provider, path, revision: data.revision })).status,
        "unchanged",
        provider,
      );
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
