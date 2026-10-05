import { test } from "node:test";
import assert from "node:assert/strict";
import { StatusMonitor } from "../src/monitor.ts";
import type { Snapshot, ToggleResult } from "../src/status.ts";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred<T = Snapshot>() {
  let resolve!: (snapshot: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

  for (const [inactive, active] of [["muted", "unmuted"], ["off", "on"]] as const) {
  test(`${inactive}/${active}: multiple subscribers share reads, no overlaps, and stale status expires`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
    const first = deferred(), second = deferred();
    let calls = 0;
    const monitor = new StatusMonitor(() => (++calls === 1 ? first.promise : second.promise));
    const a: Snapshot[] = [], b: Snapshot[] = [];
    const stopA = monitor.subscribe((value) => a.push(value));
    const stopB = monitor.subscribe((value) => b.push(value));
    t.after(() => { stopA(); stopB(); });
    assert.equal(calls, 1);
    first.resolve({ status: inactive });
    await flush();
    assert.equal(a.at(-1)?.status, inactive);
    assert.equal(b.at(-1)?.status, inactive);
    t.mock.timers.tick(1000);
    assert.equal(calls, 2);
    t.mock.timers.tick(2500);
    assert.equal(a.at(-1)?.status, "stale");
    t.mock.timers.tick(5000);
    assert.equal(calls, 2);
    second.resolve({ status: active });
    await flush();
    assert.equal(a.at(-1)?.status, active);
    stopA(); stopB();
    t.mock.timers.tick(10000);
    assert.equal(calls, 2);
  });
}

test("toggle waits for reads, suppresses duplicate presses, and shares the confirmed result", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const oldRead = deferred(), action = deferred<ToggleResult>();
  let reads = 0, toggles = 0;
  const monitor = new StatusMonitor(() => { reads++; return oldRead.promise; });
  const a: Snapshot[] = [], b: Snapshot[] = [];
  const stopA = monitor.subscribe((value) => a.push(value));
  const stopB = monitor.subscribe((value) => b.push(value));
  t.after(() => { stopA(); stopB(); });
  const command = () => { toggles++; return action.promise; };
  const pending = monitor.toggle(command);
  assert.equal(a.at(-1)?.status, "toggling");
  assert.equal(toggles, 0);
  assert.equal(await monitor.toggle(command), undefined);
  oldRead.resolve({ status: "muted" });
  await flush();
  assert.equal(toggles, 1);
  assert.equal(a.some((value) => value.status === "muted"), false);
  t.mock.timers.tick(10000);
  assert.equal(reads, 1);
  assert.equal(a.at(-1)?.status, "toggling");
  assert.equal(await monitor.toggle(command), undefined);
  action.resolve({ success: true, snapshot: { status: "unmuted" } });
  assert.equal((await pending)?.success, true);
  assert.equal(a.at(-1)?.status, "unmuted");
  assert.equal(b.at(-1)?.status, "unmuted");
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(reads, 2);
  assert.equal(toggles, 1);
});

test("failed toggles resume status polling without repeating the action", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let reads = 0, toggles = 0;
  const monitor = new StatusMonitor(async () => { reads++; return { status: "muted" }; });
  const seen: Snapshot[] = [];
  const stop = monitor.subscribe((value) => seen.push(value));
  t.after(stop);
  await flush();
  const result = await monitor.toggle(async () => {
    toggles++;
    return { success: false, snapshot: { status: "unknown", reason: "verification_timeout" } };
  });
  assert.equal(result?.success, false);
  assert.equal(seen.at(-1)?.reason, "verification_timeout");
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(reads, 2);
  assert.equal(toggles, 1);
  assert.equal(seen.at(-1)?.status, "muted");
  const thrown = await monitor.toggle(async () => { throw new Error("failed"); });
  assert.equal(thrown?.snapshot.reason, "toggle_failed");
  t.mock.timers.tick(1000);
  await flush();
  assert.equal(reads, 3);
});

test("a pending toggle is canceled when the initiating key disappears or changes path", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const read = deferred();
  let current = true, toggles = 0, reads = 0;
  const monitor = new StatusMonitor(() => { reads++; return read.promise; });
  const stop = monitor.subscribe(() => {});
  t.after(stop);
  const pending = monitor.toggle(async () => {
    toggles++;
    return { success: true, snapshot: { status: "unmuted" } };
  }, () => current);
  current = false;
  read.resolve({ status: "muted" });
  assert.equal(await pending, undefined);
  await flush();
  assert.equal(toggles, 0);
  assert.equal(reads, 2);
});

test("a completed toggle cannot publish into a later profile generation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const action = deferred<ToggleResult>();
  let reads = 0;
  const monitor = new StatusMonitor(async () => { reads++; return { status: "muted" }; });
  const stopOld = monitor.subscribe(() => {});
  await flush();
  const pending = monitor.toggle(() => action.promise);
  await flush();
  stopOld();
  const seen: Snapshot[] = [];
  const stopNew = monitor.subscribe((value) => seen.push(value));
  t.after(stopNew);
  action.resolve({ success: true, snapshot: { status: "unmuted" } });
  await pending;
  await flush();
  assert.equal(reads, 2);
  assert.equal(seen.some((value) => value.status === "unmuted"), false);
  assert.equal(seen.at(-1)?.status, "muted");
});

test("hiding and reappearing before dispatch cancels the pending toggle", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const read = deferred();
  let toggles = 0, reads = 0;
  const monitor = new StatusMonitor(() => { reads++; return read.promise; });
  const command = async (): Promise<ToggleResult> => {
    toggles++;
    return { success: true, snapshot: { status: "unmuted" } };
  };
  assert.equal(await monitor.toggle(command), undefined);
  const stopOld = monitor.subscribe(() => {});
  const pending = monitor.toggle(command);
  stopOld();
  const seen: Snapshot[] = [];
  const stopNew = monitor.subscribe((value) => seen.push(value));
  t.after(stopNew);
  read.resolve({ status: "muted" });
  assert.equal(await pending, undefined);
  await flush();
  assert.equal(toggles, 0);
  assert.equal(reads, 2);
  assert.equal(seen.at(-1)?.status, "muted");
});

test("hiding and reappearing during a read discards that old result without overlapping", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const old = deferred(), fresh = deferred();
  let calls = 0;
  const monitor = new StatusMonitor(() => (++calls === 1 ? old.promise : fresh.promise));
  monitor.subscribe(() => {})();
  const seen: Snapshot[] = [];
  const stop = monitor.subscribe((value) => seen.push(value));
  t.after(stop);
  assert.equal(calls, 1);
  old.resolve({ status: "muted" });
  await flush();
  assert.equal(calls, 2);
  assert.deepEqual(seen, [{ status: "checking" }]);
  fresh.resolve({ status: "unmuted" });
  await flush();
  assert.equal(seen.at(-1)?.status, "unmuted");
});

test("permission errors replace previous status and use a slower retry interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let calls = 0;
  const monitor = new StatusMonitor(async () => { calls++; return { status: "permission_denied" }; });
  const seen: Snapshot[] = [];
  const stop = monitor.subscribe((value) => seen.push(value));
  t.after(stop);
  await flush();
  assert.equal(seen.at(-1)?.status, "permission_denied");
  t.mock.timers.tick(4999);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  assert.equal(calls, 2);
  await flush();
});
