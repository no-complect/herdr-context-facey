import test from "node:test";
import assert from "node:assert/strict";
import { createReader, decodeResponse } from "../mods/herdr-context-facey/reader-client.js";

const session = { id: "one", provider: "grok", path: "/session/chat_history.jsonl" };
const response = {
  version: 1,
  status: "snapshot",
  session,
  revision: "revision",
  partial: false,
  capabilities: { compaction: false, historical_usage: false },
  events: [
    {
      id: "0",
      source: session.path,
      line: 1,
      field: "grok:content",
      record_hash: "a".repeat(64),
      category: "user",
      label: "Your prompt",
      teaser: "hello",
      timestamp: "",
      segment: 0,
      turn: 1,
      tokens: 3,
      bytes: 12,
    },
  ],
  candidates: [],
  usage_samples: [],
  notes: [],
};

test("the reader uses an argument array and sends the protocol version", async () => {
  let call;
  const read = createReader(async (...args) => {
    call = args;
    return { code: 0, stdout: JSON.stringify(response) };
  }, "/mod with spaces/inspect_session.py");
  assert.deepEqual(await read({ provider: "grok", title: "literal $(command)" }), response);
  assert.equal(call[0], "python3");
  assert.equal(call[1][0], "/mod with spaces/inspect_session.py");
  assert.deepEqual(JSON.parse(call[1][2]), {
    version: 1,
    provider: "grok",
    title: "literal $(command)",
  });
});

test("a failed reader process is not misreported as a missing Python installation", async () => {
  const read = createReader(
    async () => ({ code: 2, stderr: "private transcript data", stdout: "" }),
    "/mod/inspect_session.py",
  );
  await assert.rejects(read({ provider: "grok" }), (error) => {
    assert.equal(error.code, "reader_failed");
    assert.match(error.message, /exit code 2/);
    assert.doesNotMatch(error.message, /Python.*required|private transcript/);
    return true;
  });
});

test("launch failures retain a safe dependency failure classification", async () => {
  const read = createReader(async () => {
    throw new Error("private host diagnostic");
  }, "/mod/inspect_session.py");
  await assert.rejects(
    read({}),
    (error) => error.code === "reader_unavailable" && !error.message.includes("private"),
  );
});

test("invalid JSON, unknown versions and malformed event references fail at the boundary", () => {
  for (const data of [
    "not JSON",
    JSON.stringify({ ...response, version: 2 }),
    JSON.stringify({ ...response, events: [{}] }),
    JSON.stringify({ ...response, session: null }),
    JSON.stringify({ ...response, events: [{ ...response.events[0], record_hash: "" }] }),
    JSON.stringify({ ...response, status: "mystery" }),
    JSON.stringify({ ...response, events: [{ ...response.events[0], teaser: null }] }),
    JSON.stringify({ ...response, reported: { input: "100" } }),
    JSON.stringify({ ...response, usage_samples: [null] }),
    JSON.stringify({ ...response, candidates: [{}] }),
  ])
    assert.throws(
      () => decodeResponse(data),
      (error) => error.code === "invalid_response",
    );
});

test("expected reader outcomes preserve their distinct codes", () => {
  const selection = {
    version: 1,
    status: "selection_required",
    code: "no_session",
    reason: "Choose a session.",
    candidates: [],
  };
  assert.deepEqual(decodeResponse(JSON.stringify(selection)), selection);
  assert.throws(
    () =>
      decodeResponse(
        JSON.stringify({
          version: 1,
          status: "error",
          error: {
            code: "stale_event",
            message: "This event changed. Refresh before previewing it.",
          },
        }),
      ),
    (error) => error.code === "stale_event",
  );
});

test("summary and preview responses cannot be exchanged", async () => {
  const read = createReader(
    async () => ({ code: 0, stdout: JSON.stringify(response) }),
    "/mod/inspect_session.py",
  );
  await assert.rejects(read({ action: "detail" }), (error) => error.code === "invalid_response");
  const summary = createReader(
    async () => ({
      code: 0,
      stdout: JSON.stringify({ version: 1, status: "detail", text: "hello" }),
    }),
    "/mod/inspect_session.py",
  );
  await assert.rejects(summary({ provider: "grok" }), (error) => error.code === "invalid_response");
});
