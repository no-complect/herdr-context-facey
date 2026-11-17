// Source: src/session-controller.ts. Run npm run build to update the runtime JavaScript.
import { providerNames } from "./target.js";
import type {
  ContextEvent,
  PanelData,
  ReadSession,
  Snapshot,
  Target,
  Unchanged,
} from "./contracts.js";

function sessionKey(data: PanelData | Unchanged | null) {
  const session = data && "session" in data ? data.session : null;
  return session ? JSON.stringify([session.provider, session.id, session.path]) : null;
}

function eventKey(data: PanelData | null, event?: ContextEvent) {
  return event
    ? JSON.stringify([
        sessionKey(data),
        event.id,
        event.source,
        event.line,
        event.field,
        event.record_hash,
      ])
    : null;
}

/** Coordinates reads without depending on Herdr, timers, or native editor handles. */
export class SessionController {
  declare readSession: ReadSession;
  declare manual: Record<string, string | undefined>;
  declare identity: string | null;
  declare data: PanelData | null;
  declare busy: boolean;
  declare error: string | null;
  declare cutoff: number | null;
  declare pinned: string | null;
  declare details: string | null;
  declare detailKey: string | null;
  declare requestId: number;
  declare detailRequestId: number;
  declare closed: boolean;

  constructor(readSession: ReadSession) {
    this.readSession = readSession;
    this.manual = {};
    this.identity = null;
    this.data = null;
    this.busy = false;
    this.error = null;
    this.cutoff = null;
    this.pinned = null;
    this.details = null;
    this.detailKey = null;
    this.requestId = 0;
    this.detailRequestId = 0;
    this.closed = false;
  }

  get snapshot(): Snapshot | null {
    return this.data?.status === "snapshot" ? this.data : null;
  }

  targetIdentity(target: Target | null) {
    return JSON.stringify([
      target?.address,
      target?.provider,
      target?.session_id,
      target?.pid,
      target?.title,
      target?.cwd,
      target ? this.manual[target.address] : undefined,
    ]);
  }

  clearDetail() {
    this.detailRequestId += 1;
    this.pinned = null;
    this.details = null;
    this.detailKey = null;
  }

  close() {
    this.closed = true;
    this.requestId += 1;
    this.detailRequestId += 1;
    this.busy = false;
  }

  acceptSnapshot(data: PanelData) {
    const previous = this.data;
    const previousSnapshot = this.snapshot;
    const nextSnapshot = data.status === "snapshot" ? data : null;
    const sameSession = sessionKey(previous) === sessionKey(data);
    const preserved = (id: string | number) => {
      const before = previousSnapshot?.events.find((event) => event.id === String(id));
      const after = nextSnapshot?.events.find((event) => event.id === String(id));
      return before && after && eventKey(previous, before) === eventKey(data, after);
    };
    if (!sameSession || (this.pinned !== null && !preserved(this.pinned))) {
      this.clearDetail();
    }
    if (!sameSession || (this.cutoff !== null && !preserved(this.cutoff))) {
      this.cutoff = null;
    }
    this.data = data;
  }

  async refresh(target: Target | null, force = false) {
    if (this.closed) return;
    const identity = this.targetIdentity(target);
    if (identity !== this.identity) {
      this.identity = identity;
      this.requestId += 1;
      this.data = null;
      this.error = null;
      this.busy = false;
      this.cutoff = null;
      this.clearDetail();
    }
    if (!target || (this.busy && !force)) return;
    if (target.address.includes("/")) {
      this.error = "Context currently reads local sessions only.";
      return;
    }
    if (!target.provider || !Object.keys(providerNames).includes(target.provider)) {
      this.error =
        "Focus a Codex, Claude Code, Grok Build or Antigravity CLI session to inspect it.";
      return;
    }
    const requestId = ++this.requestId;
    this.busy = true;
    try {
      const data = await this.readSession({
        ...target,
        provider: target.provider,
        path: this.manual[target.address],
        revision: force ? null : this.snapshot?.revision,
      });
      if (this.closed || requestId !== this.requestId) return;
      if (data.status === "unchanged") {
        const previous = this.snapshot;
        if (
          !previous ||
          sessionKey(data) !== sessionKey(previous) ||
          data.revision !== previous.revision
        ) {
          throw new Error(
            "The reader returned an unchanged response for another session. Refresh again.",
          );
        }
        this.data = { ...previous, ...data, status: "snapshot" };
      } else {
        this.acceptSnapshot(data);
      }
      this.error = null;
    } catch (error) {
      if (!this.closed && requestId === this.requestId) {
        this.error = errorMessage(error);
      }
    } finally {
      if (requestId === this.requestId) this.busy = false;
    }
  }

  async inspect(event: ContextEvent) {
    const data = this.snapshot;
    if (this.closed || !data) return;
    const current = data.events.find((candidate) => candidate.id === event.id);
    const key = eventKey(data, event);
    if (!current || key !== eventKey(data, current)) return;
    this.pinned = event.id;
    if (key === this.detailKey) return;
    const requestId = ++this.detailRequestId;
    this.detailKey = key;
    this.details = null;
    try {
      const detail = await this.readSession(
        {
          action: "detail",
          session: data.session,
          revision: data.revision,
          source: event.source,
          line: event.line,
          field: event.field,
          record_hash: event.record_hash,
          protected: event.protected,
        },
        10000,
      );
      if (this.closed || requestId !== this.detailRequestId) return;
      this.details = detail.text || "This event has no text preview.";
      if (detail.truncated) this.details += "\n\n[Preview limited to 24,000 characters]";
    } catch (error) {
      if (!this.closed && requestId === this.detailRequestId) {
        this.details = errorMessage(error, "The source could not be previewed.");
      }
    }
  }
}

function errorMessage(error: unknown, fallback?: string): string {
  const message = error && typeof error === "object" && "message" in error ? error.message : null;
  return String(message || fallback || error);
}
