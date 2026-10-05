import type { Snapshot, ActionResult } from "./status.ts";

type Listener = (snapshot: Snapshot) => void;

/** Serializes reads and toggles for one control and executable, shared by its visible keys. */
export class StatusMonitor {
  private listeners = new Set<Listener>();
  private polling?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<Snapshot>;
  private toggling = false;
  private current: Snapshot = { status: "checking" };
  private receivedAt = 0;
  private generation = 0;
  private readonly read: () => Promise<Snapshot>;
  private readonly pollMs: number;
  private readonly staleMs: number;

  constructor(
    read: () => Promise<Snapshot>, pollMs = 1000, staleMs = 3500
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
        // Let a bounded read or dispatched toggle finish before another operation.
      }
    };
  }

  async execute(command: () => Promise<ActionResult | undefined>, isCurrent = () => true): Promise<ActionResult | undefined> {
    if (this.toggling || !this.listeners.size) return;
    this.toggling = true;
    const generation = this.generation;
    let published = false;
    clearTimeout(this.polling);
    clearTimeout(this.expiry);
    this.publish({ status: "toggling" });
    try {
      // Finish the existing read before dispatching; its result is discarded.
      await this.inFlight?.catch(() => {});
      if (!this.listeners.size || generation !== this.generation || !isCurrent()) return;
      let result: ActionResult | undefined;
      try { result = await command(); }
      catch { result = { success: false, snapshot: { status: "unknown", reason: "toggle_failed" } }; }
      if (!result) return;
      if (this.listeners.size && generation === this.generation) {
        this.accept(result.snapshot);
        published = true;
      }
      return result;
    } finally {
      this.toggling = false;
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
    let result: Snapshot;
    try { this.inFlight = this.read(); result = await this.inFlight; }
    catch { result = { status: "unknown", reason: "read_failed" }; }
    this.inFlight = undefined;
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
