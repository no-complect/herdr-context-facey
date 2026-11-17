import test from "node:test";
import assert from "node:assert/strict";
import { SessionController } from "../mods/herdr-context-facey/session-controller.js";

const target = (address = "a", extra = {}) => ({
  address,
  provider: "agy",
  title: "agy",
  cwd: "/project",
  ...extra,
});
const event = (hash = "original", extra = {}) => ({
  id: "0",
  source: "/session/transcript.jsonl",
  line: 1,
  field: "agy:content",
  record_hash: hash,
  ...extra,
});
const snapshot = (id = "one", extra = {}) => ({
  version: 1,
  status: "snapshot",
  session: { id, path: `/session/${id}/transcript.jsonl`, provider: "agy" },
  revision: "revision-one",
  capabilities: { compaction: false, historical_usage: true },
  events: [event()],
  candidates: [],
  ...extra,
});
function pendingReader() {
  const calls = [];
  const controller = new SessionController(
    (request) =>
      new Promise((resolve, reject) => {
        calls.push({ request, resolve, reject });
      }),
  );
  return { controller, calls };
}

test("A → B → A keeps the newest response when older reads finish last", async () => {
  const { controller: c, calls } = pendingReader();
  const oldA = c.refresh(target("a"));
  const b = c.refresh(target("b"));
  const newA = c.refresh(target("a"));
  calls[2].resolve(snapshot("a", { revision: "newest" }));
  await newA;
  calls[1].resolve(snapshot("b"));
  await b;
  calls[0].resolve(snapshot("a", { revision: "oldest" }));
  await oldA;
  assert.equal(c.data.revision, "newest");
  assert.equal(c.busy, false);
});

test("an obsolete failure cannot clear the busy flag or replace the current error", async () => {
  const { controller: c, calls } = pendingReader();
  const oldA = c.refresh(target("a"));
  const b = c.refresh(target("b"));
  const newA = c.refresh(target("a"));
  calls[0].reject(new Error("obsolete failure"));
  await oldA;
  assert.equal(c.busy, true);
  assert.equal(c.error, null);
  calls[1].resolve(snapshot("b"));
  calls[2].resolve(snapshot("a"));
  await Promise.all([b, newA]);
});

test("changing the session label in the same terminal clears preview and replay immediately", async () => {
  const { controller: c, calls } = pendingReader();
  let read = c.refresh(target("a", { session_id: "one" }));
  calls[0].resolve(snapshot());
  await read;
  let preview = c.inspect(c.data.events[0]);
  calls[1].resolve({ version: 1, status: "detail", text: "old preview" });
  await preview;
  c.cutoff = 0;
  read = c.refresh(target("a", { session_id: "two" }));
  assert.equal(c.pinned, null);
  assert.equal(c.details, null);
  assert.equal(c.cutoff, null);
  assert.equal(c.data, null);
  calls[2].resolve(snapshot("two"));
  await read;
});

test("automatic resolution to a different session clears old state even without a label", async () => {
  const { controller: c, calls } = pendingReader();
  let read = c.refresh(target());
  calls[0].resolve(snapshot());
  await read;
  c.pinned = "0";
  c.details = "old preview";
  c.cutoff = 0;
  read = c.refresh(target());
  calls[1].resolve(snapshot("two"));
  await read;
  assert.equal(c.pinned, null);
  assert.equal(c.details, null);
  assert.equal(c.cutoff, null);
});

test("a rewritten event invalidates its cached preview and replay position", async () => {
  const { controller: c, calls } = pendingReader();
  let read = c.refresh(target());
  calls[0].resolve(snapshot());
  await read;
  const preview = c.inspect(c.data.events[0]);
  assert.equal(calls[1].request.record_hash, "original");
  calls[1].resolve({ version: 1, status: "detail", text: "original text" });
  await preview;
  c.cutoff = 0;
  read = c.refresh(target());
  calls[2].resolve(snapshot("one", { revision: "rewritten", events: [event("replacement")] }));
  await read;
  assert.equal(c.pinned, null);
  assert.equal(c.details, null);
  assert.equal(c.cutoff, null);
});

test("appending records preserves a still-valid pinned preview and replay position", async () => {
  const { controller: c, calls } = pendingReader();
  let read = c.refresh(target());
  calls[0].resolve(snapshot());
  await read;
  const preview = c.inspect(c.data.events[0]);
  calls[1].resolve({ version: 1, status: "detail", text: "original text" });
  await preview;
  c.cutoff = 0;
  read = c.refresh(target());
  calls[2].resolve(
    snapshot("one", {
      revision: "appended",
      events: [event(), event("second", { id: "1", line: 2 })],
    }),
  );
  await read;
  assert.equal(c.pinned, "0");
  assert.equal(c.details, "original text");
  assert.equal(c.cutoff, 0);
});

test("an unchanged response retains the snapshot and includes its revision in the next request", async () => {
  const { controller: c, calls } = pendingReader();
  let read = c.refresh(target());
  calls[0].resolve(snapshot());
  await read;
  read = c.refresh(target());
  assert.equal(calls[1].request.revision, "revision-one");
  calls[1].resolve({
    version: 1,
    status: "unchanged",
    session: c.data.session,
    revision: "revision-one",
    candidates: [],
  });
  await read;
  assert.equal(c.data.events.length, 1);
});

test("force refresh supersedes an in-flight read and closing invalidates late work", async () => {
  const { controller: c, calls } = pendingReader();
  const old = c.refresh(target());
  const forced = c.refresh(target(), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].request.revision, null);
  calls[1].resolve(snapshot("one", { revision: "forced" }));
  await forced;
  c.close();
  calls[0].resolve(snapshot("one", { revision: "obsolete" }));
  await old;
  assert.equal(c.data.revision, "forced");
  assert.equal(c.busy, false);
});

test("a late preview cannot reappear after its record is replaced", async () => {
  const { controller: c, calls } = pendingReader();
  let read = c.refresh(target());
  calls[0].resolve(snapshot());
  await read;
  const preview = c.inspect(c.data.events[0]);
  read = c.refresh(target());
  calls[2].resolve(snapshot("one", { revision: "rewritten", events: [event("replacement")] }));
  await read;
  calls[1].resolve({ version: 1, status: "detail", text: "obsolete preview" });
  await preview;
  assert.equal(c.pinned, null);
  assert.equal(c.details, null);
});

test("manual selection and a restarted process invalidate prior terminal reads", async () => {
  const { controller: c, calls } = pendingReader();
  const old = c.refresh(target("a", { pid: 1 }));
  c.manual.a = "/manual/session.jsonl";
  const current = c.refresh(target("a", { pid: 2 }));
  assert.equal(calls[1].request.path, "/manual/session.jsonl");
  calls[1].resolve(snapshot("manual"));
  await current;
  calls[0].resolve(snapshot("old"));
  await old;
  assert.equal(c.data.session.id, "manual");
});

test("an unchanged response for a different session is rejected", async () => {
  const { controller: c, calls } = pendingReader();
  let read = c.refresh(target());
  calls[0].resolve(snapshot());
  await read;
  read = c.refresh(target());
  calls[1].resolve({
    version: 1,
    status: "unchanged",
    session: snapshot("other").session,
    revision: "revision-one",
  });
  await read;
  assert.match(c.error, /another session/);
  assert.equal(c.data.session.id, "one");
});

test("a failed preview can be selected again, while a successful preview stays cached", async () => {
  const { controller: c, calls } = pendingReader();
  const read = c.refresh(target());
  calls[0].resolve(snapshot());
  await read;
  const failed = c.inspect(c.data.events[0]);
  calls[1].reject(new Error("Temporary preview failure"));
  await failed;
  assert.equal(c.pinned, "0");
  assert.equal(c.details, "Temporary preview failure");
  const retry = c.inspect(c.data.events[0]);
  assert.equal(calls.length, 3);
  assert.equal(c.details, null);
  calls[2].resolve({ version: 1, status: "detail", text: "Recovered preview" });
  await retry;
  await c.inspect(c.data.events[0]);
  assert.equal(calls.length, 3);
  assert.equal(c.details, "Recovered preview");
});

test("refresh preserves failed-preview recovery and in-flight retries are deduplicated", async () => {
  const { controller: c, calls } = pendingReader();
  let read = c.refresh(target());
  calls[0].resolve(snapshot());
  await read;
  const failed = c.inspect(c.data.events[0]);
  calls[1].reject(new Error("Temporary preview failure"));
  await failed;
  read = c.refresh(target(), true);
  calls[2].resolve(snapshot());
  await read;
  assert.equal(calls.length, 3);
  const retry = c.inspect(c.data.events[0]);
  await c.inspect(c.data.events[0]);
  assert.equal(calls.length, 4);
  calls[3].resolve({ version: 1, status: "detail", text: "Recovered preview" });
  await retry;
  assert.equal(c.details, "Recovered preview");
});

test("a late failure cannot make a newer successful preview retry unnecessarily", async () => {
  const { controller: c, calls } = pendingReader();
  const read = c.refresh(target());
  calls[0].resolve(snapshot("one", { events: [event(), event("other", { id: "1", line: 2 })] }));
  await read;
  const old = c.inspect(c.data.events[0]);
  const current = c.inspect(c.data.events[1]);
  calls[2].resolve({ version: 1, status: "detail", text: "Current preview" });
  await current;
  calls[1].reject(new Error("Obsolete failure"));
  await old;
  await c.inspect(c.data.events[1]);
  assert.equal(calls.length, 3);
  assert.equal(c.pinned, "1");
  assert.equal(c.details, "Current preview");
});
