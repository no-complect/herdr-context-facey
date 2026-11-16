import { providerNames } from "./target.js";

function sessionKey(data) {
  const session = data?.session;
  return session ? JSON.stringify([session.provider, session.id, session.path]) : null;
}

function eventKey(data, event) {
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
  constructor(readSession) {
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

  targetIdentity(target) {
    return JSON.stringify([
      target?.address,
      target?.provider,
      target?.session_id,
      target?.pid,
      target?.title,
      target?.cwd,
      this.manual[target?.address],
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

  acceptSnapshot(data) {
    const previous = this.data;
    const sameSession = sessionKey(previous) === sessionKey(data);
    const preserved = (id) => {
      const before = previous?.events?.find((event) => event.id === String(id));
      const after = data.events?.find((event) => event.id === String(id));
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

  async refresh(target, force = false) {
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
    if (!Object.keys(providerNames).includes(target.provider)) {
      this.error =
        "Focus a Codex, Claude Code, Grok Build or Antigravity CLI session to inspect it.";
      return;
    }
    const requestId = ++this.requestId;
    this.busy = true;
    try {
      const data = await this.readSession({
        ...target,
        path: this.manual[target.address],
        revision: force ? null : this.data?.revision,
      });
      if (this.closed || requestId !== this.requestId) return;
      if (data.status === "unchanged") {
        if (sessionKey(data) !== sessionKey(this.data) || data.revision !== this.data?.revision) {
          throw new Error(
            "The reader returned an unchanged response for another session. Refresh again.",
          );
        }
        this.data = { ...this.data, ...data, status: "snapshot" };
      } else {
        this.acceptSnapshot(data);
      }
      this.error = null;
    } catch (error) {
      if (!this.closed && requestId === this.requestId) {
        this.error = String(error.message || error);
      }
    } finally {
      if (requestId === this.requestId) this.busy = false;
    }
  }

  async inspect(event) {
    if (this.closed || !this.data?.session) return;
    const current = this.data.events.find((candidate) => candidate.id === event.id);
    const key = eventKey(this.data, event);
    if (!current || key !== eventKey(this.data, current)) return;
    this.pinned = event.id;
    if (key === this.detailKey) return;
    const requestId = ++this.detailRequestId;
    this.detailKey = key;
    this.details = null;
    try {
      const detail = await this.readSession(
        {
          action: "detail",
          session: this.data.session,
          revision: this.data.revision,
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
        this.details = String(error.message || "The source could not be previewed.");
      }
    }
  }
}
