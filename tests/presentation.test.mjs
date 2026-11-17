import assert from "node:assert/strict";
import test from "node:test";
import { selectVisibleEvents, usagePresentation } from "../mods/herdr-context-facey/model.js";

const events = [
  { id: "2", tokens: 10, category: "user", label: "Alpha", teaser: "needle" },
  { id: "10", tokens: 10, category: "results", label: "Beta", teaser: "needle" },
  { id: "1", tokens: 20, category: "results", label: "Other", teaser: "missing" },
];

test("visible-event selection preserves numeric order, stable ties and its input", () => {
  const before = structuredClone(events);
  assert.deepEqual(
    selectVisibleEvents(events).map((event) => event.id),
    ["10", "2", "1"],
  );
  assert.deepEqual(
    selectVisibleEvents(events, { sort: "largest" }).map((event) => event.id),
    ["1", "2", "10"],
  );
  assert.deepEqual(events, before);
  assert.notEqual(selectVisibleEvents(events), events);
});

test("visible-event selection matches labels, teasers and category names together", () => {
  assert.deepEqual(
    selectVisibleEvents(events, { query: "alpha" }).map((event) => event.id),
    ["2"],
  );
  assert.deepEqual(
    selectVisibleEvents(events, { category: "results", query: "needle" }).map((event) => event.id),
    ["10"],
  );
  assert.equal(selectVisibleEvents(events, { query: "tool results" }).length, 2);
  assert.deepEqual(selectVisibleEvents(events, { query: "   " }), []);
  assert.deepEqual(selectVisibleEvents([], { sort: "largest" }), []);
});

test("missing usage stays unknown while a recorded zero stays a measured zero", () => {
  const missing = usagePresentation(null);
  assert.equal(missing.inputText, "—");
  assert.equal(missing.percentage, null);
  assert.equal(missing.fill, null);
  assert.equal(missing.windowText, "Window size not recorded");
  assert.equal(missing.note, "No model usage sample is recorded yet.");
  const zero = usagePresentation({ input: 0, window: 100 });
  assert.equal(zero.inputText, "0");
  assert.equal(zero.percentage, 0);
  assert.equal(zero.fill, "0%");
});

test("usage presentation preserves threshold boundaries and clamps only the bar", () => {
  for (const [input, severity] of [
    [74.9, "normal"],
    [75, "warning"],
    [89.9, "warning"],
    [90, "critical"],
    [120, "critical"],
  ]) {
    const presentation = usagePresentation({ input, window: 100 });
    assert.equal(presentation.severity, severity);
    assert.equal(presentation.percentage, input);
    assert.equal(presentation.fill, `${Math.min(100, input)}%`);
  }
  assert.equal(usagePresentation({ input: 120, window: 100 }).windowText, "100 window · 120.0%");
});

test("replay zero and provider labels keep their existing precedence", () => {
  assert.equal(usagePresentation({ input: 10 }).label, "LAST REPORTED INPUT");
  assert.equal(usagePresentation({ input: 10 }, 0).label, "REPORTED BY THIS POINT");
  const estimate = usagePresentation({ input: 10, kind: "context", label: "CONTEXT ESTIMATE" }, 0);
  assert.equal(estimate.label, "CONTEXT ESTIMATE");
  assert.equal(estimate.percentage, null);
  assert.equal(estimate.note, "Grok's recorded context estimate; an in-flight turn may be ahead.");
  assert.equal(usagePresentation({ input: 10, label: "" }).label, "");
});
