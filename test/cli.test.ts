import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMedia, toggleMedia } from "../src/cli.ts";

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
