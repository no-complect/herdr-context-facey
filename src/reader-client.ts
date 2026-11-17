// Source: src/reader-client.ts. Run npm run build to update the runtime JavaScript.
import { categories } from "./model.js";
import { providerNames } from "./target.js";
import type {
  Candidate,
  ContextEvent,
  Detail,
  DetailRequest,
  Exec,
  ReaderRequest,
  ReaderResponse,
  SessionIdentity,
  SummaryRequest,
  SummaryResponse,
  Usage,
} from "./contracts.js";

export class ReaderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const optionalString = (value: unknown) => value === undefined || typeof value === "string";

function validSession(session: unknown): session is SessionIdentity {
  return (
    record(session) &&
    typeof session.id === "string" &&
    session.id.length > 0 &&
    typeof session.path === "string" &&
    session.path.length > 0 &&
    typeof session.provider === "string" &&
    Object.keys(providerNames).includes(session.provider)
  );
}

function validEvent(event: unknown): event is ContextEvent {
  return (
    record(event) &&
    typeof event.id === "string" &&
    /^\d+$/.test(event.id) &&
    typeof event.source === "string" &&
    count(event.line) &&
    Number.isInteger(event.line) &&
    event.line > 0 &&
    typeof event.field === "string" &&
    typeof event.record_hash === "string" &&
    /^[a-f0-9]{64}$/.test(event.record_hash) &&
    typeof event.label === "string" &&
    typeof event.teaser === "string" &&
    count(event.segment) &&
    Number.isInteger(event.segment) &&
    event.segment >= 0 &&
    count(event.turn) &&
    Number.isInteger(event.turn) &&
    event.turn >= 0 &&
    categories.some((category) => category.id === event.category) &&
    count(event.tokens) &&
    count(event.bytes) &&
    (event.timestamp == null || optionalString(event.timestamp)) &&
    (event.persistent == null || optionalString(event.persistent)) &&
    (event.protected === undefined || typeof event.protected === "boolean")
  );
}

const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
function validUsage(usage: unknown): usage is Usage {
  return (
    record(usage) &&
    count(usage.input) &&
    (usage.cached == null || count(usage.cached)) &&
    (usage.output == null || count(usage.output)) &&
    (usage.window == null || (count(usage.window) && usage.window > 0)) &&
    optionalString(usage.kind) &&
    optionalString(usage.label)
  );
}
function validCandidates(candidates: unknown): candidates is Candidate[] {
  return (
    Array.isArray(candidates) &&
    candidates.every(
      (candidate) =>
        record(candidate) &&
        ["id", "path", "name"].every((key) => typeof candidate[key] === "string") &&
        count(candidate.updated) &&
        (candidate.cwd == null || optionalString(candidate.cwd)),
    )
  );
}

/** Validate the process boundary before any response reaches panel state. */
export function decodeResponse(raw: string): ReaderResponse {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    /* Report one safe protocol error below. */
  }
  const invalid = (): never => {
    throw new ReaderError(
      "invalid_response",
      "The session reader returned an invalid or incompatible response.",
    );
  };
  if (!record(data) || data.version !== 1) return invalid();
  if (data.status !== "error" && data.error !== undefined) invalid();
  if (data.candidates !== undefined && !validCandidates(data.candidates)) invalid();
  switch (data.status) {
    case "error":
      if (
        !record(data.error) ||
        typeof data.error.code !== "string" ||
        typeof data.error.message !== "string"
      )
        return invalid();
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
        (data.code !== "no_session" && data.code !== "ambiguous_session") ||
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
        !record(data.capabilities) ||
        typeof data.capabilities.compaction !== "boolean" ||
        typeof data.capabilities.historical_usage !== "boolean" ||
        !Array.isArray(data.usage_samples) ||
        !Array.isArray(data.notes) ||
        !data.notes.every((note) => typeof note === "string") ||
        (data.reported != null && !validUsage(data.reported)) ||
        !data.usage_samples.every(
          (sample) =>
            record(sample) &&
            validUsage(sample) &&
            typeof sample.afterId === "number" &&
            Number.isInteger(sample.afterId) &&
            sample.afterId >= -1,
        ) ||
        (data.model != null && typeof data.model !== "string") ||
        !optionalString(data.method) ||
        !optionalString(data.match) ||
        (data.files !== undefined && !count(data.files))
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
  // Each discriminant and the fields consumed by the panel were checked above.
  return data as unknown as ReaderResponse;
}

export function createReader(exec: Exec, readerPath: string) {
  function read(request: DetailRequest, timeout?: number): Promise<Detail>;
  function read(request: SummaryRequest, timeout?: number): Promise<SummaryResponse>;
  async function read(request: ReaderRequest, timeout = 15000): Promise<ReaderResponse> {
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
  }
  return read;
}
