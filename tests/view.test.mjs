import assert from "node:assert/strict";
import test from "node:test";
import { event, snapshot, find, walk, text, nativeView } from "./helpers/native-view.mjs";

test("view ordering is numeric, Largest ties are stable and source events are unchanged", async () => {
  const { view, context } = await nativeView();
  const inspector = view();
  const events = [event(2, 10), event(10, 10), event(1, 20)];
  const original = events.map((item) => item.id);
  let list = find(inspector.rows(events, context()), "context-events");
  assert.deepEqual(
    Array.from({ length: list.list.count }, (_, i) => list.list.key(i)),
    ["10", "2", "1"],
  );
  inspector.sort = "largest";
  list = find(inspector.rows(events, context()), "context-events");
  assert.deepEqual(
    Array.from({ length: list.list.count }, (_, i) => list.list.key(i)),
    ["1", "2", "10"],
  );
  assert.deepEqual(
    events.map((item) => item.id),
    original,
  );
});

test("category and text filters compose and row clicks use stable keys and the callback context", async () => {
  const { view, context } = await nativeView();
  const inspector = view();
  const events = [
    event(0, 1, "user", "Alpha", "needle"),
    event(1, 2, "results", "Beta", "needle"),
    event(2, 3, "results", "Other", "missing"),
  ];
  inspector.filter = "results";
  inspector.query = "needle";
  let list = find(inspector.rows(events, context()), "context-events");
  assert.equal(list.list.count, 1);
  assert.equal(list.list.key(0), "1");
  assert.equal(list.list.render({ start: 0, end: 1 }).length, 1);
  let selected;
  inspector.inspect = (item, cx) => {
    selected = { item, cx };
  };
  const fresh = context();
  list.ops.on_item_click[0]("1", fresh);
  assert.equal(selected.item, events[1]);
  assert.equal(selected.cx, fresh);
  inspector.query = "tool results";
  list = find(inspector.rows(events, context()), "context-events");
  assert.equal(list.list.count, 2);
  inspector.query = "unmatched";
  assert(text(inspector.rows(events, context())).includes("No events match these filters."));
});

test("usage preserves 75/90 thresholds, unknowns, custom labels and unclamped percentage text", async () => {
  const { view, colors } = await nativeView();
  const inspector = view();
  for (const [input, color] of [
    [0, "#82ac65"],
    [74.9, "#82ac65"],
    [75, "#d4a75c"],
    [89.9, "#d4a75c"],
    [90, colors.blocked],
    [120, colors.blocked],
  ]) {
    const tree = inspector.gauge({ input, window: 100 });
    assert(
      walk(tree).some(
        (node) => node.ops.text_size?.[0] === 22 && node.ops.text_color?.[0] === color,
      ),
    );
    const fill = walk(tree).find((node) => typeof node.ops.w?.[0] === "string");
    assert.equal(fill.ops.w[0], Math.min(input, 100) + "%");
    if (input === 120) assert(text(tree).some((value) => value.includes("120.0%")));
  }
  let tree = inspector.gauge(null);
  assert(text(tree).includes("—"));
  assert(text(tree).includes("Window size not recorded"));
  assert(!walk(tree).some((node) => typeof node.ops.w?.[0] === "string"));
  inspector.session.cutoff = 0;
  tree = inspector.gauge({ input: 0 });
  assert(text(tree).includes("REPORTED BY THIS POINT"));
  assert(text(tree).includes("0"));
  tree = inspector.gauge({ input: 10, kind: "context", label: "CONTEXT ESTIMATE" });
  assert(text(tree).includes("CONTEXT ESTIMATE"));
  assert(text(tree).some((value) => value.startsWith("Grok's recorded context estimate")));
});

test("a snapshot and pinned preview remain visible during refresh and after a current failure", async () => {
  const { SessionController, host, view, context } = await nativeView();
  let reject;
  let calls = 0;
  const controller = new SessionController(() =>
    ++calls === 1
      ? Promise.resolve(snapshot())
      : new Promise((_, failure) => {
          reject = failure;
        }),
  );
  const target = { address: "synthetic", provider: "codex", title: "Synthetic" };
  await controller.refresh(target);
  controller.pinned = "0";
  controller.details = "Retained preview";
  controller.detailKey = "original-key";
  host.props = { target };
  const inspector = view();
  inspector.session = controller;
  const pending = controller.refresh(target);
  let tree = inspector.render(context());
  assert(text(tree).includes("Reading…"));
  assert(find(tree, "context-events"));
  assert(text(tree).includes("Unpin"));
  reject(new Error("Synthetic refresh failure"));
  await pending;
  tree = inspector.render(context());
  assert(text(tree).includes("Synthetic refresh failure"));
  assert(find(tree, "context-events"));
  assert(text(tree).includes("Unpin"));
  inspector.close();
});

test("preview editors are reused and released on replacement, unpin and close", async () => {
  const { view, host } = await nativeView();
  const inspector = view();
  inspector.session.pinned = "0";
  inspector.session.detailKey = "key";
  inspector.session.details = "First";
  inspector.syncPreview();
  const first = inspector.code;
  inspector.syncPreview();
  assert.equal(host.editors.length, 1);
  inspector.session.details = "Updated";
  inspector.syncPreview();
  const second = inspector.code;
  assert.equal(first.releases, 1);
  inspector.session.clearDetail();
  inspector.syncPreview();
  assert.equal(second.releases, 1);
  assert.equal(inspector.code, null);
  inspector.session.pinned = "0";
  inspector.session.detailKey = "key";
  inspector.session.details = "Third";
  inspector.syncPreview();
  const third = inspector.code;
  inspector.close();
  assert.equal(third.releases, 1);
  assert.equal(inspector.session.closed, true);
});

test("hidden panels skip automatic reads while explicit refresh overrides visibility", async () => {
  const { view, host, context, flush } = await nativeView();
  host.props = { blockId: "context" };
  host.layout = { id: "context", hidden: true, content: { mod: "herdr-context-facey" } };
  const inspector = view();
  let reads = 0;
  inspector.session.refresh = async () => {
    reads++;
  };
  inspector.refresh(context());
  assert.equal(reads, 0);
  inspector.refresh(context(), true);
  await flush();
  assert.equal(reads, 1);
  inspector.close();
});

test("a late read cannot recreate editors or notify after the view closes", async () => {
  const { view, host, context, flush } = await nativeView();
  const inspector = view();
  let complete;
  inspector.session.refresh = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  inspector.refresh(context(), true);
  inspector.close();
  complete();
  await flush();
  assert.equal(host.notifications, 0);
  assert.equal(host.editors.length, 0);
});

test("dialogs inherit manual attachment, while a different explicit target stays independent", async () => {
  const { Inspector, host, context, flush } = await nativeView();
  const target = { address: "synthetic", provider: "codex", title: "Synthetic" };
  host.props = { target, selectedPath: "/synthetic/session.jsonl" };
  const panel = new Inspector();
  panel.init({}, context());
  await flush();
  assert(host.timers.some((timer) => timer.ms === 5000));
  panel.expand();
  const opened = host.overlays.at(-1);
  assert.equal(opened.props.target, target);
  assert.equal(opened.props.selectedPath, "/synthetic/session.jsonl");
  host.props = { overlay: "dialog" };
  const inherited = new Inspector();
  inherited.init({}, context());
  assert.equal(inherited.expandedTarget, target);
  assert.equal(inherited.session.manual.synthetic, "/synthetic/session.jsonl");
  host.props = { overlay: "other-dialog", target: { ...target, address: "other" } };
  const other = new Inspector();
  other.init({}, context());
  assert.equal(other.session.manual.other, undefined);
  await flush();
  other.close();
  inherited.close();
  panel.close();
});

test("legend and body preserve their exact 400px and 720px layout boundaries", async () => {
  const { view, context } = await nativeView();
  const inspector = view();
  inspector.width = 399;
  assert.equal(inspector.breakdown(inspector.session.data.events, context()).nodes[2].kind, "v");
  inspector.width = 400;
  assert.equal(inspector.breakdown(inspector.session.data.events, context()).nodes[2].kind, "h");
  inspector.session.pinned = "0";
  inspector.session.details = "Preview";
  inspector.session.detailKey = "key";
  for (const [width, kind] of [
    [720, "v"],
    [721, "h"],
  ]) {
    inspector.width = width;
    const body = walk(inspector.render(context())).find(
      (node) =>
        node.nodes.length === 2 &&
        find(node.nodes[0], "context-events") &&
        find(node.nodes[1], "context-replay-event"),
    );
    assert(body);
    assert.equal(body.kind, kind);
  }
  inspector.close();
});

test("replay zero is valid and providers without compaction retain Recorded history controls", async () => {
  const { view, context } = await nativeView();
  const inspector = view();
  inspector.session.cutoff = 0;
  let tree = inspector.render(context());
  assert(text(tree).includes("REPLAY"));
  const back = find(tree, "context-live");
  assert(back);
  back.ops.on_click[0]({}, context());
  assert.equal(inspector.session.cutoff, null);
  inspector.session.data.capabilities.compaction = false;
  tree = inspector.render(context());
  assert(text(tree).includes("Recorded history"));
  assert(!find(tree, "context-segment"));
  assert(!find(tree, "context-history"));
  inspector.close();
});
