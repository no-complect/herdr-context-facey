import assert from "node:assert/strict";
import test from "node:test";
import { focusedSession } from "../mods/herdr-context-facey/target.js";

const focus = {
  space: "space-one",
  tab: "tab-one",
  pane: "shell-pane",
  agent: "claude-terminal",
};
const codex = {
  pane: "codex-pane",
  terminal: "codex-terminal",
  tab: focus.tab,
  program: { key: "codex" },
  status: "working",
};
const claude = {
  pane: "claude-pane",
  terminal: "claude-terminal",
  tab: focus.tab,
  program: { key: "claude" },
  status: "idle",
};
const terminals = [
  { address: "codex-terminal", program: { key: "codex" }, report: { title: "Codex session" } },
  {
    address: "claude-terminal",
    program: { key: "claude" },
    report: { title: "Claude session" },
    labels: { "agent.session": "session-identifier" },
  },
];

test("the selected agent wins over another working agent while a shell is focused", () => {
  const target = focusedSession(focus, [codex, claude], terminals);
  assert.equal(target.provider, "claude");
  assert.equal(target.session_id, "session-identifier");
});

test("a focused agent takes precedence over the sidebar selection", () => {
  const target = focusedSession({ ...focus, pane: codex.pane }, [codex, claude], terminals);
  assert.equal(target.address, codex.terminal);
});

test("terminal blocks work without a model pane", () => {
  const target = focusedSession({ ...focus, shown: claude.terminal }, [], terminals);
  assert.equal(target.provider, "claude");
});

test("a retained target stays within its original space and tab", () => {
  const previous = { ...focus, address: codex.terminal, provider: "codex" };
  assert.equal(focusedSession(focus, [], [], previous), previous);
  assert.equal(focusedSession({ ...focus, tab: "another-tab" }, [], [], previous), null);
  assert.equal(focusedSession({ ...focus, space: "another-space" }, [], [], previous), null);
  assert.equal(focusedSession(null, [codex], terminals, previous), null);
});

test("ambiguous agents require selection rather than guessing", () => {
  const target = focusedSession(
    { ...focus, agent: null },
    [codex, { ...claude, status: "working" }],
    terminals,
  );
  assert.equal(target, null);
});
