import { test } from "node:test";
import assert from "node:assert/strict";
import { CallEndController } from "../src/call.ts";
import type { ActionResult, Snapshot } from "../src/status.ts";

function deferred() {
  let resolve!: (result: ActionResult) => void;
  const promise = new Promise<ActionResult>((done) => { resolve = done; });
  return { promise, resolve };
}

test("end call runs once across shared keys and success feedback expires without another command", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new CallEndController(), action = deferred();
  const a: Snapshot[] = [], b: Snapshot[] = [];
  const stopA = controller.subscribe((snapshot) => a.push(snapshot));
  const stopB = controller.subscribe((snapshot) => b.push(snapshot));
  t.after(() => { stopA(); stopB(); });
  let calls = 0;
  const command = () => { calls++; return action.promise; };
  assert.deepEqual(a, [{ status: "ready" }]);
  const pending = controller.execute(command);
  assert.equal(a.at(-1)?.status, "ending");
  assert.equal(b.at(-1)?.status, "ending");
  assert.equal(await controller.execute(command), undefined);
  t.mock.timers.tick(10000);
  assert.equal(calls, 1);
  action.resolve({ success: true, snapshot: { status: "ended" } });
  assert.equal((await pending)?.success, true);
  assert.equal(a.at(-1)?.status, "ended");
  assert.equal(b.at(-1)?.status, "ended");
  t.mock.timers.tick(1999);
  assert.equal(a.at(-1)?.status, "ended");
  t.mock.timers.tick(1);
  assert.equal(a.at(-1)?.status, "ready");
  assert.equal(b.at(-1)?.status, "ready");
  assert.equal(calls, 1);
});

test("end-call failures stay visible and are never automatically retried", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new CallEndController(), seen: Snapshot[] = [];
  const stop = controller.subscribe((snapshot) => seen.push(snapshot));
  t.after(stop);
  let calls = 0;
  const result = await controller.execute(async () => {
    calls++;
    return { success: false, snapshot: { status: "unknown", reason: "verification_timeout" } };
  });
  assert.equal(result?.success, false);
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
  assert.equal(seen.at(-1)?.reason, "verification_timeout");
  assert.equal((await controller.execute(async () => { throw new Error("failed"); }))?.snapshot.reason, "call_end_failed");
  const retry = await controller.execute(async () => ({ success: true, snapshot: { status: "ended" } }));
  assert.equal(retry?.success, true);
});

test("hidden or rebound keys cannot dispatch an end-call command", async (t) => {
  const controller = new CallEndController();
  let calls = 0;
  const command = async (): Promise<ActionResult> => { calls++; return { success: true, snapshot: { status: "ended" } }; };
  assert.equal(await controller.execute(command), undefined);
  const stop = controller.subscribe(() => {});
  t.after(stop);
  assert.equal(await controller.execute(command, () => false), undefined);
  stop();
  assert.equal(await controller.execute(command), undefined);
  assert.equal(calls, 0);
});

test("profile changes retain the in-flight guard but discard old call-end feedback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new CallEndController(), action = deferred();
  const stopOld = controller.subscribe(() => {});
  const pending = controller.execute(() => action.promise);
  stopOld();
  const seen: Snapshot[] = [];
  const stopNew = controller.subscribe((snapshot) => seen.push(snapshot));
  t.after(stopNew);
  assert.equal(seen.at(-1)?.status, "ending");
  assert.equal(await controller.execute(async () => { throw new Error("must not run"); }), undefined);
  action.resolve({ success: true, snapshot: { status: "ended" } });
  await pending;
  assert.deepEqual(seen, [{ status: "ending" }, { status: "ready" }]);
  t.mock.timers.tick(5000);
  assert.equal(seen.length, 2);
});
