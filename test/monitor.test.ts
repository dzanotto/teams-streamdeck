import { test } from "node:test";
import assert from "node:assert/strict";
import { StatusMonitor } from "../src/monitor.ts";
import type { Snapshot } from "../src/status.ts";

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred() {
  let resolve!: (snapshot: Snapshot) => void;
  const promise = new Promise<Snapshot>((done) => { resolve = done; });
  return { promise, resolve };
}

test("multiple subscribers share reads, no overlaps, and stale status expires", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const first = deferred(), second = deferred();
  let calls = 0;
  const monitor = new StatusMonitor(() => (++calls === 1 ? first.promise : second.promise));
  const a: Snapshot[] = [], b: Snapshot[] = [];
  const stopA = monitor.subscribe((value) => a.push(value));
  const stopB = monitor.subscribe((value) => b.push(value));
  t.after(() => { stopA(); stopB(); });
  assert.equal(calls, 1);
  first.resolve({ status: "muted" });
  await flush();
  assert.equal(a.at(-1)?.status, "muted");
  assert.equal(b.at(-1)?.status, "muted");
  t.mock.timers.tick(1000);
  assert.equal(calls, 2);
  t.mock.timers.tick(2500);
  assert.equal(a.at(-1)?.status, "stale");
  t.mock.timers.tick(5000);
  assert.equal(calls, 2);
  second.resolve({ status: "unmuted" });
  await flush();
  assert.equal(a.at(-1)?.status, "unmuted");
  stopA(); stopB();
  t.mock.timers.tick(10000);
  assert.equal(calls, 2);
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
