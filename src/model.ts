// Source: src/model.ts. Run npm run build to update the runtime JavaScript.
import type { CategoryId, ContextEvent, Snapshot } from "./contracts.js";

export const categories = [
  { id: "runtime", label: "Runtime", color: "#8b8b84" },
  { id: "instructions", label: "Instructions", color: "#709bc1" },
  { id: "memory", label: "Memory", color: "#bd945d" },
  { id: "skills", label: "Skills", color: "#b4aa5d" },
  { id: "tools", label: "Tool definitions", color: "#a48bbd" },
  { id: "environment", label: "Environment", color: "#619a96" },
  { id: "user", label: "You", color: "#82ac65" },
  { id: "files", label: "File reads", color: "#adada3" },
  { id: "calls", label: "Tool calls", color: "#9aabbd" },
  { id: "results", label: "Tool results", color: "#c7a57a" },
  { id: "assistant", label: "Replies", color: "#ce896b" },
  { id: "summary", label: "Compaction", color: "#d4a75c" },
] as const;
export type Category = (typeof categories)[number];
export const categoryOf = (id: string): Category =>
  categories.find((category) => category.id === id) ?? categories[0];

export function formatCount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

// "Segment" is recorded evidence since the last logged compaction, with the
// latest persistent instruction/tool snapshots. It is not a reconstructed prompt.
export function selectEvents(data: Snapshot | null, cutoff: number | null = null, history = false) {
  const through = (data?.events ?? []).filter(
    (event) => cutoff === null || Number(event.id) <= cutoff,
  );
  const segment = through.at(-1)?.segment ?? 0;
  const latestSnapshots = new Map();
  for (const event of through) {
    if (event.persistent) latestSnapshots.set(event.persistent, event.id);
  }
  if (history) return through;
  return through.filter((event) => {
    if (event.persistent) return latestSnapshots.get(event.persistent) === event.id;
    return event.segment === segment;
  });
}

export function estimatedTotals(events: ContextEvent[]) {
  const counts = Object.fromEntries(categories.map((category) => [category.id, 0])) as Record<
    CategoryId,
    number
  >;
  for (const event of events) {
    counts[event.category] = (counts[event.category] ?? 0) + event.tokens;
  }
  return { counts, sum: Object.values(counts).reduce((sum, value) => sum + value, 0) };
}

export function reportedUsageAt(data: Snapshot | null, cutoff: number | null) {
  if (cutoff === null) return data?.reported;
  return (data?.usage_samples ?? []).filter((sample) => sample.afterId <= cutoff).at(-1) ?? null;
}
