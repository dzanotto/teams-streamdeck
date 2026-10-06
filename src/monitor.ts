import type { Snapshot, ActionResult } from "./status.ts";
import type { PressTiming } from "./timing.ts";

type Listener = (snapshot: Snapshot) => void;

/** Serializes reads and toggles for one control and executable, shared by its visible keys. */
export class StatusMonitor {
  private listeners = new Set<Listener>();
  private polling?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<Snapshot>;
  private readAbort?: AbortController;
  private toggling = false;
  private current: Snapshot = { status: "checking" };
  private receivedAt = 0;
  private generation = 0;
  private readonly read: (signal: AbortSignal) => Promise<Snapshot>;
  private readonly pollMs: number;
  private readonly staleMs: number;

  constructor(
    read: (signal: AbortSignal) => Promise<Snapshot>, pollMs = 1000, staleMs = 3500
  ) { this.read = read; this.pollMs = pollMs; this.staleMs = staleMs; }

  subscribe(listener: Listener): () => void {
    const wasEmpty = this.listeners.size === 0;
    this.listeners.add(listener);
    if (wasEmpty || Date.now() - this.receivedAt >= this.staleMs) this.current = { status: this.toggling ? "toggling" : "checking" };
    listener(this.current);
    if (wasEmpty) void this.poll();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearTimeout(this.polling);
        clearTimeout(this.expiry);
        this.generation++;
        this.current = { status: "checking" };
        this.readAbort?.abort();
        // Retain the in-flight guard until the read closes; never cancel actions.
      }
    };
  }

  async execute(command: () => Promise<ActionResult | undefined>, isCurrent = () => true, timing?: PressTiming): Promise<ActionResult | undefined> {
    if (this.toggling) { timing?.ignore("busy"); return; }
    if (!this.listeners.size || !isCurrent()) { timing?.ignore("unavailable"); return; }
    this.toggling = true;
    timing?.mark("accepted");
    const generation = this.generation;
    let published = false;
    let result: ActionResult | undefined;
    clearTimeout(this.polling);
    clearTimeout(this.expiry);
    this.publish({ status: "toggling" });
    try {
      if (this.inFlight) {
        timing?.mark("poll_cancel_requested");
        this.readAbort?.abort();
        await this.inFlight.catch(() => {});
        timing?.mark("poll_settled");
      }
      if (!this.listeners.size || generation !== this.generation || !isCurrent()) return;
      timing?.mark("command_started");
      try { result = await command(); }
      catch { result = { success: false, snapshot: { status: "unknown", reason: "toggle_failed" } }; }
      timing?.mark("command_completed");
      if (!result) return;
      if (this.listeners.size && generation === this.generation) {
        this.accept(result.snapshot);
        published = true;
      }
      return result;
    } finally {
      this.toggling = false;
      timing?.ready(result);
      if (this.listeners.size && !published) void this.poll();
    }
  }

  private publish(snapshot: Snapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  private async poll(): Promise<void> {
    if (this.inFlight || this.toggling || !this.listeners.size) return;
    const generation = this.generation;
    const abort = new AbortController();
    this.readAbort = abort;
    let result: Snapshot;
    try { this.inFlight = this.read(abort.signal); result = await this.inFlight; }
    catch { result = { status: "unknown", reason: "read_failed" }; }
    this.inFlight = undefined;
    this.readAbort = undefined;
    if (this.toggling || !this.listeners.size) return;
    if (generation !== this.generation) {
      void this.poll();
      return;
    }
    this.accept(result);
  }

  private accept(result: Snapshot): void {
    this.receivedAt = Date.now();
    clearTimeout(this.expiry);
    this.publish(result);
    if (["muted", "unmuted", "on", "off", "raised", "lowered"].includes(result.status)) {
      this.expiry = setTimeout(() => this.publish({ status: "stale" }), this.staleMs);
    }
    const interval = ["setup", "permission_denied", "not_running"].includes(result.status) ? 5000 : this.pollMs;
    this.polling = setTimeout(() => void this.poll(), interval);
  }
}
