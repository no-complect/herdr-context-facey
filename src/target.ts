// Source: src/target.ts. Run npm run build to update the runtime JavaScript.
import type { Focus, Pane, ProgramEntry, Provider, Target, Terminal } from "./contracts.js";

export const providerNames = {
  codex: "Codex",
  claude: "Claude Code",
  grok: "Grok Build",
  agy: "Antigravity CLI",
} as const satisfies Record<Provider, string>;

function providerFor(entry: ProgramEntry | null | undefined): Provider | null {
  for (const key of [entry?.app, entry?.report?.app, entry?.program?.key]) {
    if (typeof key !== "string") continue;
    if (/^codex(?:-|$)/.test(key)) return "codex";
    if (/^claude(?:-|$)/.test(key)) return "claude";
    if (/^grok(?:-build)?$/.test(key)) return "grok";
    if (/^(?:agy|antigravity(?:-cli)?)$/.test(key)) return "agy";
  }
  return null;
}

const supported = (entry: ProgramEntry | null | undefined) => providerFor(entry) !== null;

function selectedAgent(candidates: Pane[], selectedAddress: string | null | undefined) {
  const selected = candidates.find((pane) => pane.terminal === selectedAddress);
  if (selected) return selected;

  const working = candidates.filter((pane) => pane.status === "working");
  if (working.length === 1) return working[0];
  return candidates.length === 1 ? candidates[0] : null;
}

// Opening a shell or the inspector should preserve the selected agent, while
// moving to another tab must never carry an unrelated conversation along.
export function focusedSession(
  focus: Focus | null,
  allPanes: Pane[],
  allTerminals: Terminal[],
  previous: Target | null | undefined,
): Target | null {
  if (!focus) return null;

  const previousInTab =
    previous?.space === focus.space && previous?.tab === focus.tab ? (previous ?? null) : null;
  let pane: Pane | null | undefined = allPanes.find((candidate) => candidate.pane === focus.pane);
  let address = focus.shown || focus.terminal || pane?.terminal;
  let terminal = allTerminals.find((candidate) => candidate.address === address);

  if (!(pane?.terminal === address && supported(pane)) && !supported(terminal)) {
    const candidates = allPanes.filter(
      (candidate) => candidate.tab === focus.tab && supported(candidate),
    );
    pane = selectedAgent(candidates, focus.agent);
    if (!pane) return previousInTab;
    address = pane.terminal;
    terminal = allTerminals.find((candidate) => candidate.address === address);
  }
  if (!address) return previousInTab;

  const provider = providerFor(terminal) ?? (pane?.terminal === address ? providerFor(pane) : null);
  return {
    address,
    space: focus.space,
    tab: focus.tab,
    pid: terminal?.foreground?.pid,
    title: terminal?.report?.title || pane?.title || terminal?.title || "",
    cwd: terminal?.foreground?.cwd || pane?.cwd || focus.cwd || terminal?.cwd,
    session_id: terminal?.labels?.["agent.session"],
    provider,
  };
}
