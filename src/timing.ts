import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ActionResult, Control } from "./status.ts";

type Stage = "accepted" | "poll_cancel_requested" | "poll_settled" | "command_started" | "command_completed" | "ready";
type CommandTiming = { command: string; dispatch_ms: number; complete_ms?: number; duration_ms?: number };

/** Buffered timings: logging happens after unlocking, never between CLI stages. */
export class PressTiming {
  private readonly id = randomUUID();
  private readonly now: () => number;
  private readonly started: number;
  private readonly stages: Partial<Record<Stage, number>> = {};
  private readonly commands: CommandTiming[] = [];
  private outcome = "canceled";
  private result?: ActionResult;

  constructor(now = () => performance.now()) { this.now = now; this.started = now(); }

  private elapsed(): number { return Math.round((this.now() - this.started) * 1000) / 1000; }

  mark(stage: Stage): void { this.stages[stage] = this.elapsed(); }

  beginCommand(command: string): () => void {
    const span: CommandTiming = { command, dispatch_ms: this.elapsed() };
    this.commands.push(span);
    return () => {
      span.complete_ms = this.elapsed();
      span.duration_ms = Math.round((span.complete_ms - span.dispatch_ms) * 1000) / 1000;
    };
  }

  ignore(reason: "busy" | "unavailable"): void { this.outcome = `ignored_${reason}`; }

  ready(result?: ActionResult): void {
    this.mark("ready");
    this.result = result;
    this.outcome = result ? (result.success ? "confirmed" : "failed") : "canceled";
  }

  report(control: Control) {
    return { press_id: this.id, control, outcome: this.outcome,
      status: this.result?.snapshot.status, reason: this.result?.snapshot.reason,
      stages_ms: { ...this.stages }, commands: this.commands.map((span) => ({ ...span })) };
  }
}
