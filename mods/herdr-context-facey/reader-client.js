import { categories } from "./model.js";
import { providerNames } from "./target.js";

export class ReaderError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function validSession(session) {
  return (
    session &&
    typeof session.id === "string" &&
    session.id.length > 0 &&
    typeof session.path === "string" &&
    session.path.length > 0 &&
    Object.keys(providerNames).includes(session.provider)
  );
}

function validEvent(event) {
  return (
    event &&
    /^\d+$/.test(event.id) &&
    typeof event.id === "string" &&
    typeof event.source === "string" &&
    Number.isInteger(event.line) &&
    event.line > 0 &&
    typeof event.field === "string" &&
    /^[a-f0-9]{64}$/.test(event.record_hash) &&
    typeof event.label === "string" &&
    typeof event.teaser === "string" &&
    Number.isInteger(event.segment) &&
    event.segment >= 0 &&
    Number.isInteger(event.turn) &&
    event.turn >= 0 &&
    categories.some((category) => category.id === event.category) &&
    Number.isFinite(event.tokens) &&
    event.tokens >= 0 &&
    Number.isFinite(event.bytes) &&
    event.bytes >= 0
  );
}

const count = (value) => Number.isFinite(value) && value >= 0;
function validUsage(usage) {
  return (
    usage &&
    count(usage.input) &&
    (usage.cached == null || count(usage.cached)) &&
    (usage.output == null || count(usage.output)) &&
    (usage.window == null || (count(usage.window) && usage.window > 0))
  );
}
function validCandidates(candidates) {
  return (
    Array.isArray(candidates) &&
    candidates.every(
      (candidate) =>
        candidate &&
        ["id", "path", "name"].every((key) => typeof candidate[key] === "string") &&
        count(candidate.updated),
    )
  );
}

/** Validate the process boundary before any response reaches panel state. */
export function decodeResponse(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    /* Report one safe protocol error below. */
  }
  const invalid = () => {
    throw new ReaderError(
      "invalid_response",
      "The session reader returned an invalid or incompatible response.",
    );
  };
  if (!data || data.version !== 1) invalid();
  if (data.status !== "error" && data.error !== undefined) invalid();
  if (data.candidates !== undefined && !validCandidates(data.candidates)) invalid();
  switch (data.status) {
    case "error":
      if (typeof data.error?.code !== "string" || typeof data.error?.message !== "string")
        invalid();
      throw new ReaderError(data.error.code, data.error.message);
    case "detail":
      if (
        typeof data.text !== "string" ||
        (data.truncated !== undefined && typeof data.truncated !== "boolean")
      )
        invalid();
      break;
    case "selection_required":
      if (
        !["no_session", "ambiguous_session"].includes(data.code) ||
        typeof data.reason !== "string" ||
        !Array.isArray(data.candidates)
      )
        invalid();
      break;
    case "snapshot":
      if (
        !validSession(data.session) ||
        typeof data.revision !== "string" ||
        !data.revision ||
        typeof data.partial !== "boolean" ||
        !Array.isArray(data.events) ||
        !data.events.every(validEvent) ||
        typeof data.capabilities?.compaction !== "boolean" ||
        typeof data.capabilities?.historical_usage !== "boolean" ||
        !Array.isArray(data.usage_samples) ||
        !Array.isArray(data.notes) ||
        !data.notes.every((note) => typeof note === "string") ||
        (data.reported != null && !validUsage(data.reported)) ||
        !data.usage_samples.every(
          (sample) =>
            validUsage(sample) && Number.isInteger(sample.afterId) && sample.afterId >= -1,
        )
      )
        invalid();
      break;
    case "unchanged":
      if (
        !validSession(data.session) ||
        typeof data.revision !== "string" ||
        !data.revision ||
        data.events !== undefined
      )
        invalid();
      break;
    default:
      invalid();
  }
  return data;
}

export function createReader(exec, readerPath) {
  return async (request, timeout = 15000) => {
    let result;
    try {
      result = await exec(
        "python3",
        [readerPath, "--request", JSON.stringify({ ...request, version: 1 })],
        { timeout },
      );
    } catch {
      throw new ReaderError(
        "reader_unavailable",
        "The local reader could not start or timed out. Check Python 3 and refresh.",
      );
    }
    if (result.code !== 0) {
      throw new ReaderError(
        "reader_failed",
        `The local session reader failed with exit code ${result.code}.`,
      );
    }
    const response = decodeResponse(result.stdout);
    const expected =
      request.action === "detail" ? ["detail"] : ["snapshot", "unchanged", "selection_required"];
    if (!expected.includes(response.status)) {
      throw new ReaderError(
        "invalid_response",
        "The session reader returned a response for another action.",
      );
    }
    return response;
  };
}
