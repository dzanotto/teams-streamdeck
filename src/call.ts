import type { ActionResult, Snapshot } from "./status.ts";
import type { PressTiming } from "./timing.ts";

type Listener = (snapshot: Snapshot) => void;

/** One end-call command per executable; never polls or retries the action. */
export class CallEndController {
  private listeners = new Set<Listener>();
  private current: Snapshot = { status: "ready" };
  private busy = false;
  private generation = 0;
  private reset?: ReturnType<typeof setTimeout>;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        clearTimeout(this.reset);
        this.generation++;
        this.current = { status: this.busy ? "ending" : "ready" };
      }
    };
  }

  async execute(command: () => Promise<ActionResult>, isCurrent = () => true, timing?: PressTiming): Promise<ActionResult | undefined> {
    if (this.busy) { timing?.ignore("busy"); return; }
    if (!this.listeners.size || !isCurrent()) { timing?.ignore("unavailable"); return; }
    this.busy = true;
    timing?.mark("accepted");
    const generation = this.generation;
    clearTimeout(this.reset);
    this.publish({ status: "ending" });
    let result: ActionResult;
    timing?.mark("command_started");
    try { result = await command(); }
    catch { result = { success: false, snapshot: { status: "unknown", reason: "call_end_failed" } }; }
    timing?.mark("command_completed");
    this.busy = false;
    timing?.ready(result);
    if (generation === this.generation && this.listeners.size) {
      this.publish(result.snapshot);
      if (result.success) this.reset = setTimeout(() => this.publish({ status: "ready" }), 2000);
    } else {
      this.publish({ status: "ready" });
    }
    return result;
  }

  private publish(snapshot: Snapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}
