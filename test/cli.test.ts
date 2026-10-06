import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEventListeners } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { readMedia, toggleMedia, endCall } from "../src/cli.ts";
import { StatusMonitor } from "../src/monitor.ts";

  for (const media of ["mic", "camera"] as const) {
  const field = media === "mic" ? "microphone" : "camera";
  const inactive = media === "mic" ? "muted" : "off";
  const active = media === "mic" ? "unmuted" : "on";

  test(`${media}: spawns a spaced/metacharacter executable path with exact status arguments`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "teams-cli-test-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "fake teams;$(nothing)");
    await writeFile(file, `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== '["${media}","status","--json"]') process.exit(64);\nconsole.log(JSON.stringify({${field}:"permission_denied",reason:"accessibility_permission_required"}));process.exit(3);\n`);
    await chmod(file, 0o755);
    assert.deepEqual(await readMedia(file, media), { status: "permission_denied", reason: "accessibility_permission_required" });
  });

  test(`${media}: reports missing/relative executables as setup problems`, async () => {
    assert.equal((await readMedia("teams", media)).status, "setup");
    assert.equal((await readMedia("/does-not-exist/teams", media)).reason, "executable_missing");
    assert.deepEqual(await toggleMedia("teams", media), { success: false, snapshot: { status: "setup", reason: "absolute_path_required" } });
    assert.equal((await toggleMedia("/does-not-exist/teams", media)).snapshot.reason, "executable_missing");
  });

  test(`${media}: terminates a hung status process without trusting partial output`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "teams-cli-timeout-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "teams");
    await writeFile(file, `#!${process.execPath}\nconsole.log('{"${field}":"${inactive}"}');setInterval(()=>{},1000);\n`);
    await chmod(file, 0o755);
    assert.deepEqual(await readMedia(file, media, 150), { status: "unknown", reason: "command_terminated" });
  });

  test(`${media}: toggle passes exact arguments without a shell and preserves refused actions`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "teams-cli-toggle-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "fake teams;$(nothing)");
    await writeFile(file, `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== '["${media}","toggle","--json"]') process.exit(64);\nconsole.log(JSON.stringify({${field}:"unknown",action:"toggle",success:false,reason:"verification_timeout"}));process.exit(6);\n`);
    await chmod(file, 0o755);
    assert.deepEqual(await toggleMedia(file, media), {
      success: false, snapshot: { status: "unknown", reason: "verification_timeout" }
    });
  });

  test(`${media}: a timed-out toggle is not trusted or retried after emitting success`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "teams-cli-toggle-timeout-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "teams"), calls = join(dir, "calls");
    await writeFile(file, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)}, 'toggle\\n');\nconsole.log('{"${field}":"${active}","action":"toggle","success":true,"focus_unchanged":true}');setInterval(()=>{},1000);\n`);
    await chmod(file, 0o755);
    assert.deepEqual(await toggleMedia(file, media, 300), {
      success: false, snapshot: { status: "unknown", reason: "command_terminated" }
    });
    assert.equal(await readFile(calls, "utf8"), "toggle\n");
  });
}

test("call end invokes the exact command without a shell and preserves refusal reasons", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-call-end-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "fake teams;$(nothing)");
  await writeFile(file, `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== '["call","end","--json"]') process.exit(64);\nconsole.log(JSON.stringify({call:"unknown",action:"end",success:false,reason:"all_calls_on_hold"}));process.exit(6);\n`);
  await chmod(file, 0o755);
  assert.deepEqual(await endCall(file), { success: false, snapshot: { status: "unknown", reason: "all_calls_on_hold" } });
  assert.equal((await endCall("teams")).snapshot.reason, "absolute_path_required");
  assert.equal((await endCall("/does-not-exist/teams")).snapshot.reason, "executable_missing");
});

for (const media of ["mic", "camera", "hand"] as const) {
  test(`${media}: cancels a hung poll before dispatch, waits for process exit, and discards partial output`, { timeout: 10000 }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "teams-cli-cancel-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "fake teams"), ready = join(dir, "ready");
    await writeFile(file, `#!${process.execPath}
const fs = require('node:fs');
process.stdout.write('{"microphone":"muted","camera":"off","hand":"lowered"}\\n', () => fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid)));
setInterval(() => {}, 1000);
`);
    await chmod(file, 0o755);
    let signal!: AbortSignal;
    const seen: string[] = [];
    const monitor = new StatusMonitor((value) => { signal = value; return readMedia(file, media, 8000, value); });
    const stop = monitor.subscribe((snapshot) => seen.push(snapshot.status));
    t.after(stop);
    const deadline = Date.now() + 4000;
    let pid = 0;
    while (!pid) {
      pid = await readFile(ready, "utf8").then(Number, () => 0);
      assert.ok(Date.now() < deadline, "fake CLI failed to start");
      if (!pid) await delay(10);
    }
    const pending = monitor.execute(async () => {
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, "action overlapped the status process");
      assert.equal(getEventListeners(signal, "abort").length, 0);
      return { success: true, snapshot: { status: "unmuted" } };
    });
    // This deadline is well below the fake read's timeout. The PID assertion,
    // rather than a narrow speed threshold, proves the no-overlap guarantee.
    const timer = new AbortController();
    try {
      const result = await Promise.race([pending, delay(3000, "timed_out", { signal: timer.signal })]);
      assert.notEqual(result, "timed_out");
      assert.deepEqual(seen, ["checking", "toggling", "unmuted"]);
    } finally { timer.abort(); }
  });
}

test("pre-aborted status reads never spawn; completed reads remove their abort handler", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-cli-aborted-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "teams"), calls = join(dir, "calls");
  await writeFile(file, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)}, 'read\\n');console.log('{"microphone":"muted"}');\n`);
  await chmod(file, 0o755);
  const canceled = new AbortController();
  canceled.abort();
  assert.deepEqual(await readMedia(file, "mic", undefined, canceled.signal), { status: "unknown", reason: "command_canceled" });
  await assert.rejects(readFile(calls), { code: "ENOENT" });
  const completed = new AbortController();
  assert.equal((await readMedia(file, "mic", undefined, completed.signal)).status, "muted");
  assert.equal(getEventListeners(completed.signal, "abort").length, 0);
  completed.abort();
  assert.equal(await readFile(calls, "utf8"), "read\n");
});

test("a timed-out call end never trusts partial success or retries the command", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-call-end-timeout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "teams"), calls = join(dir, "calls");
  await writeFile(file, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)}, 'end\\n');\nconsole.log('{"call":"ended","action":"end","success":true,"changed":true,"action_attempted":true}');setInterval(()=>{},1000);\n`);
  await chmod(file, 0o755);
  assert.deepEqual(await endCall(file, 300), { success: false, snapshot: { status: "unknown", reason: "command_terminated" } });
  assert.equal(await readFile(calls, "utf8"), "end\n");
});
