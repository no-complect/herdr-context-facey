import { readFile } from "node:fs/promises";
import vm from "node:vm";

const modRoot = new URL("../../mods/herdr-context-facey/", import.meta.url);

// Record descriptions and deferred callbacks. Native layout, handle validity and
// drawing still require herdr-app check and a live native preview.
class Element {
  constructor(kind) {
    this.kind = kind;
    this.ops = {};
    this.nodes = [];
    return new Proxy(this, {
      get(object, key, receiver) {
        if (key === "then") return undefined;
        if (Reflect.has(object, key)) return Reflect.get(object, key, receiver);
        return (...args) => {
          object.ops[key] = args;
          return receiver;
        };
      },
    });
  }
  child(value) {
    this.nodes.push(value);
    return this;
  }
  children(values) {
    this.nodes.push(...values);
    return this;
  }
  when(condition, body) {
    return condition ? body(this) : this;
  }
}

export function event(id, tokens = 10, category = "user", label = "Prompt", teaser = "sample") {
  return {
    id: String(id),
    tokens,
    category,
    label,
    teaser,
    segment: 0,
    turn: 1,
    bytes: 20,
    source: "/synthetic/session.jsonl",
    line: Number(id) + 1,
    field: "content",
    record_hash: "a".repeat(64),
    timestamp: "",
  };
}

export function snapshot() {
  return {
    version: 1,
    status: "snapshot",
    session: { provider: "codex", id: "synthetic", path: "/synthetic/session.jsonl" },
    revision: "one",
    events: [event(0)],
    candidates: [],
    partial: false,
    notes: [],
    usage_samples: [],
    reported: { input: 80, window: 100 },
    model: "synthetic",
    method: "Synthetic fixture",
    match: "Explicit fixture",
    files: 1,
    capabilities: { compaction: true, historical_usage: true },
  };
}

export function walk(node) {
  return node && typeof node === "object" ? [node, ...node.nodes.flatMap(walk)] : [];
}
export const find = (node, id) => walk(node).find((item) => item.ops.id?.[0] === id);
export function text(node) {
  return node && typeof node === "object" ? node.nodes.flatMap(text) : [String(node)];
}

export async function nativeView() {
  const host = {
    props: {},
    layout: { children: [] },
    focus: null,
    panes: [],
    terminals: [],
    editors: [],
    overlays: [],
    closedOverlays: [],
    timers: [],
    tasks: [],
    notifications: 0,
    execute: async () => ({ code: 0, stdout: JSON.stringify(snapshot()) }),
  };
  const colors = Object.fromEntries(
    [
      "background",
      "surface",
      "foreground",
      "muted",
      "dim",
      "border",
      "selected",
      "hover",
      "blocked",
    ].map((key, index) => [key, `#${String(index + 1).repeat(6)}`]),
  );
  const element = (kind) => new Element(kind);
  const context = () => ({
    notify() {
      host.notifications++;
    },
    spawn(body) {
      const pending = body(context());
      host.tasks.push(pending);
      return pending;
    },
    timer: {
      every(ms, body) {
        host.timers.push({ ms, body });
      },
    },
  });
  const builtins = {
    "gpui-kit": {
      View: class {},
      div: () => element("div"),
      svg: () => element("svg"),
      uniform_list(id, count, key, render) {
        const node = element("list");
        node.ops.id = [id];
        node.list = { count, key, render };
        return node;
      },
    },
    "gpui-base": {
      h_flex: () => element("h"),
      v_flex: () => element("v"),
      InputState: {
        new: () => ({
          text: "",
          on(_name, handler) {
            this.change = handler;
          },
          value() {
            return this.text;
          },
        }),
      },
      Input: { new: () => element("input") },
      EditorState: {
        new(options) {
          const editor = {
            options,
            releases: 0,
            release() {
              this.releases++;
            },
          };
          host.editors.push(editor);
          return editor;
        },
      },
      Editor: { new: () => element("editor") },
      Scrollbar: { vertical: () => element("scrollbar") },
    },
    herdr: {
      appHome: () => "/synthetic/app",
      exec: (...args) => host.execute(...args),
      focused: () => host.focus,
      panes: () => host.panes,
      terminals: () => host.terminals,
      layout: () => host.layout,
      props: () => host.props,
      theme: () => colors,
      settings: () => ({ font_family: "monospace" }),
      openOverlay: (options) => host.overlays.push(options),
      closeOverlay: (id) => host.closedOverlays.push(id),
    },
  };
  const realm = vm.createContext({});
  const modules = new Map();
  function load(url) {
    const key = String(url);
    if (!modules.has(key)) {
      modules.set(
        key,
        (async () => {
          if (builtins[key]) {
            const values = builtins[key];
            return new vm.SyntheticModule(
              Object.keys(values),
              function () {
                for (const [name, value] of Object.entries(values)) this.setExport(name, value);
              },
              { context: realm, identifier: key },
            );
          }
          if (!key.startsWith(String(modRoot))) throw new Error(`Unexpected module: ${key}`);
          return new vm.SourceTextModule(await readFile(new URL(key), "utf8"), {
            context: realm,
            identifier: key,
          });
        })(),
      );
    }
    return modules.get(key);
  }
  const entry = await load(new URL("main.js", modRoot));
  await entry.link((specifier, parent) =>
    load(builtins[specifier] ? specifier : new URL(specifier, parent.identifier)),
  );
  await entry.evaluate();
  const Inspector = entry.namespace.default;
  const { SessionController } = (await load(new URL("session-controller.js", modRoot))).namespace;
  function view(data = snapshot()) {
    const instance = new Inspector();
    Object.assign(instance, {
      session: new SessionController(async () => data),
      width: 450,
      filter: null,
      sort: "timeline",
      history: false,
      query: "",
      search: {},
      closed: false,
      picker: false,
      about: false,
    });
    instance.session.data = data;
    instance.session.identity = instance.session.targetIdentity(null);
    return instance;
  }
  async function flush() {
    while (host.tasks.length) await Promise.all(host.tasks.splice(0));
  }
  return { Inspector, SessionController, host, context, colors, view, flush };
}
