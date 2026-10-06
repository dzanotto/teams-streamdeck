import { test } from "node:test";
import assert from "node:assert/strict";
import { PressTiming } from "../src/timing.ts";
import { CallEndController } from "../src/call.ts";

test("native hand toggle timing uses one span and elapsed monotonic time", () => {
  let now = 1000;
  const timing = new PressTiming(() => now);
  now = 1010;
  const actionDone = timing.beginCommand("hand toggle --json");
  now = 1512;
  actionDone();
  timing.ready({ success: true, snapshot: { status: "raised" } });
  const report = timing.report("hand");
  assert.deepEqual(report.commands, [
    { command: "hand toggle --json", dispatch_ms: 10, complete_ms: 512, duration_ms: 502 }
  ]);
  assert.equal(report.stages_ms.ready, 512);
  assert.equal(report.outcome, "confirmed");
  assert.equal(report.status, "raised");
  assert.notEqual(report.press_id, new PressTiming().report("hand").press_id);
});

test("call readiness timing excludes the ENDED display interval and permits another press", async (t) => {
  let now = 0;
  const controller = new CallEndController();
  const stop = controller.subscribe(() => {});
  t.after(stop);
  const timing = new PressTiming(() => now);
  await controller.execute(async () => {
    now = 250;
    return { success: true, snapshot: { status: "ended" } };
  }, undefined, timing);
  assert.deepEqual(timing.report("call").stages_ms, { accepted: 0, command_started: 0, command_completed: 250, ready: 250 });
  const failureTiming = new PressTiming(() => now);
  const next = await controller.execute(async () => { throw new Error("failure"); }, undefined, failureTiming);
  assert.equal(next?.success, false);
  assert.equal(failureTiming.report("call").outcome, "failed");
  assert.equal(failureTiming.report("call").reason, "call_end_failed");
});
