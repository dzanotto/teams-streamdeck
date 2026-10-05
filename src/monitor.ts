import type { Snapshot } from "./status.ts";

type Listener = (snapshot: Snapshot) => void;

/** One in-flight read per executable, shared by every visible key using it. */
export class StatusMonitor {
  private listeners = new Set<Listener>();
  private polling?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  private inFlight = false;
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
    if (wasEmpty || Date.now() - this.receivedAt >= this.staleMs) this.current = { status: "checking" };
    listener(this.current);
    if (wasEmpty) void this.poll();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearTimeout(this.polling);
        clearTimeout(this.expiry);
        this.generation++;
        this.current = { status: "checking" };
        // Let the bounded read finish. Reappearing keys wait for it before starting another.
      }
    };
  }

  private publish(snapshot: Snapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }

  private async poll(): Promise<void> {
    if (this.inFlight || !this.listeners.size) return;
    this.inFlight = true;
    const generation = this.generation;
    let result: Snapshot;
    try { result = await this.read(); }
    catch { result = { status: "unknown", reason: "read_failed" }; }
    this.inFlight = false;
    if (!this.listeners.size) return;
    if (generation !== this.generation) {
      void this.poll();
      return;
    }
    this.receivedAt = Date.now();
    clearTimeout(this.expiry);
    this.publish(result);
    if (result.status === "muted" || result.status === "unmuted") {
      this.expiry = setTimeout(() => this.publish({ status: "stale" }), this.staleMs);
    }
    const interval = ["setup", "permission_denied", "not_running"].includes(result.status) ? 5000 : this.pollMs;
    this.polling = setTimeout(() => void this.poll(), interval);
  }
}
