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
];
export const categoryOf = (id) =>
  categories.find((category) => category.id === id) ?? categories[0];

export function formatCount(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

/**
 * @typedef {object} DisplayEvent
 * @property {string} id Recorded ordinal, compared numerically for Timeline.
 * @property {string} category
 * @property {string} label
 * @property {string} teaser
 * @property {number} tokens Estimated text tokens, independent of reported usage.
 */

/**
 * @template {DisplayEvent} T
 * @param {T[]} events
 * @param {{category?: string|null, query?: string, sort?: "timeline"|"largest"}} options
 *   The input handler supplies lowercase query text; whitespace remains significant.
 * @returns {T[]} A new array containing the original event objects.
 */
export function selectVisibleEvents(
  events,
  { category = null, query = "", sort = "timeline" } = {},
) {
  return events
    .filter(
      (event) =>
        (!category || event.category === category) &&
        (!query ||
          `${event.label} ${event.teaser} ${categoryOf(event.category).label}`
            .toLowerCase()
            .includes(query)),
    )
    .sort((a, b) => (sort === "largest" ? b.tokens - a.tokens : Number(b.id) - Number(a.id)));
}

/**
 * @typedef {object} RecordedUsage
 * @property {number} input Provider-recorded request input or context estimate.
 * @property {number|null} [window] Absent capacity remains unknown.
 * @property {string} [kind]
 * @property {string} [label]
 */

/**
 * Display decisions only: the native view resolves severity to current theme colors.
 * @param {RecordedUsage|null|undefined} usage
 * @param {number|null} cutoff Null means live; zero is a valid replay position.
 */
export function usagePresentation(usage, cutoff = null) {
  const percentage = usage?.window ? (usage.input / usage.window) * 100 : null;
  return {
    label: usage?.label ?? (cutoff === null ? "LAST REPORTED INPUT" : "REPORTED BY THIS POINT"),
    inputText: usage ? formatCount(usage.input) : "—",
    percentage,
    fill: percentage === null ? null : `${Math.min(100, Math.max(0, percentage))}%`,
    windowText: usage?.window
      ? `${formatCount(usage.window)} window · ${percentage.toFixed(1)}%`
      : "Window size not recorded",
    severity:
      percentage !== null && percentage >= 90
        ? "critical"
        : percentage !== null && percentage >= 75
          ? "warning"
          : "normal",
    note: usage
      ? usage.kind === "context"
        ? "Grok's recorded context estimate; an in-flight turn may be ahead."
        : "Reported by the last model request; an in-flight turn may be ahead."
      : "No model usage sample is recorded yet.",
  };
}

// "Segment" is recorded evidence since the last logged compaction, with the
// latest persistent instruction/tool snapshots. It is not a reconstructed prompt.
export function selectEvents(data, cutoff = null, history = false) {
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

export function estimatedTotals(events) {
  const counts = Object.fromEntries(categories.map((category) => [category.id, 0]));
  for (const event of events) {
    counts[event.category] = (counts[event.category] ?? 0) + event.tokens;
  }
  return { counts, sum: Object.values(counts).reduce((sum, value) => sum + value, 0) };
}

export function reportedUsageAt(data, cutoff) {
  if (cutoff === null) return data?.reported;
  return (data?.usage_samples ?? []).filter((sample) => sample.afterId <= cutoff).at(-1) ?? null;
}
