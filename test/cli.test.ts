import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMicrophone, toggleMicrophone } from "../src/cli.ts";

test("spawns a spaced/metacharacter executable path and passes only read-only arguments", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-cli-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "fake teams;$(nothing)");
  await writeFile(file, `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== '["mic","status","--json"]') process.exit(64);\nconsole.log(JSON.stringify({microphone:"permission_denied",reason:"accessibility_permission_required"}));process.exit(3);\n`);
  await chmod(file, 0o755);
  assert.deepEqual(await readMicrophone(file), { status: "permission_denied", reason: "accessibility_permission_required" });
});

test("reports missing/relative executables as setup problems", async () => {
  assert.equal((await readMicrophone("teams")).status, "setup");
  assert.equal((await readMicrophone("/does-not-exist/teams")).reason, "executable_missing");
  assert.deepEqual(await toggleMicrophone("teams"), { success: false, snapshot: { status: "setup", reason: "absolute_path_required" } });
  assert.equal((await toggleMicrophone("/does-not-exist/teams")).snapshot.reason, "executable_missing");
});

test("terminates a hung status process and does not trust partial output", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-cli-timeout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "teams");
  await writeFile(file, `#!${process.execPath}\nconsole.log('{"microphone":"muted"}');setInterval(()=>{},1000);\n`);
  await chmod(file, 0o755);
  assert.deepEqual(await readMicrophone(file, 150), { status: "unknown", reason: "command_terminated" });
});

test("toggle passes exact arguments without a shell and preserves refused actions", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-cli-toggle-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "fake teams;$(nothing)");
  await writeFile(file, `#!${process.execPath}\nif (JSON.stringify(process.argv.slice(2)) !== '["mic","toggle","--json"]') process.exit(64);\nconsole.log(JSON.stringify({microphone:"unknown",action:"toggle",success:false,reason:"verification_timeout"}));process.exit(6);\n`);
  await chmod(file, 0o755);
  assert.deepEqual(await toggleMicrophone(file), {
    success: false, snapshot: { status: "unknown", reason: "verification_timeout" }
  });
});

test("a timed-out toggle is not trusted or retried even after emitting success", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-cli-toggle-timeout-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "teams"), calls = join(dir, "calls");
  await writeFile(file, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)}, 'toggle\\n');\nconsole.log('{"microphone":"unmuted","action":"toggle","success":true,"focus_unchanged":true}');setInterval(()=>{},1000);\n`);
  await chmod(file, 0o755);
  assert.deepEqual(await toggleMicrophone(file, 300), {
    success: false, snapshot: { status: "unknown", reason: "command_terminated" }
  });
  assert.equal(await readFile(calls, "utf8"), "toggle\n");
});
