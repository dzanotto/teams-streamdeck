import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMedia, toggleMedia } from "../src/cli.ts";
import { parseStatus, parseToggle, presentation, renderSvg } from "../src/status.ts";
import { PressTiming } from "../src/timing.ts";

test("hand status accepts only hand states and preserves read failures", () => {
  for (const [hand, code] of [["raised", 0], ["lowered", 0], ["unknown", 2], ["ambiguous", 2], ["permission_denied", 3], ["not_running", 4], ["unknown", 5]] as const) {
    assert.deepEqual(parseStatus(JSON.stringify({ hand, reason: "example" }), code, "hand"), { status: hand, reason: "example" });
  }
  for (const [data, code] of [
    [null, 0], [[], 0], [{ camera: "off" }, 0], [{ hand: "off" }, 0],
    [{ hand: "lowered" }, 5], [{ hand: "unknown" }, 0], [{ hand: "raised", reason: {} }, 0], [{ hand: "unknown" }, 64]
  ] as const) {
    assert.deepEqual(parseStatus(JSON.stringify(data), code, "hand"), { status: "unknown", reason: "invalid_cli_response" });
  }
  assert.equal(parseStatus("not JSON", 0, "hand").reason, "invalid_cli_response");
  const all = '{"microphone":"muted","camera":"on","hand":"raised"}';
  assert.equal(parseStatus(all, 0, "hand").status, "raised");
  assert.equal(parseStatus(all, 0, "mic").status, "muted");
  assert.equal(parseStatus(all, 0, "camera").status, "on");
});

test("hand toggles require the toggle action, a known hand state, and preserved focus", () => {
  for (const hand of ["raised", "lowered"] as const) {
    const confirmed = { hand, action: "toggle", success: true, focus_unchanged: true };
    // The CLI can confirm a no-op if another controller already reached the target.
    assert.deepEqual(parseToggle(JSON.stringify({ ...confirmed, changed: false, action_attempted: false }), 0, "hand"), {
      success: true, snapshot: { status: hand, reason: undefined }
    });
    for (const [state, code] of [["unknown", 6], ["ambiguous", 6], ["permission_denied", 3], ["not_running", 4], ["unknown", 5]] as const) {
      assert.deepEqual(parseToggle(JSON.stringify({ hand: state, action: "toggle", success: false, reason: "example" }), code, "hand"), {
        success: false, snapshot: { status: state, reason: "example" }
      });
    }
    for (const [data, code] of [
      [null, 0], [{ hand }, 0], [confirmed, 6], [confirmed, 64],
      [{ ...confirmed, hand: "unknown" }, 0], [{ ...confirmed, success: false }, 0],
      [{ ...confirmed, action: "raise" }, 0], [{ ...confirmed, action: "lower" }, 0],
      [{ ...confirmed, focus_unchanged: false }, 0], [{ ...confirmed, focus_unchanged: undefined }, 0],
      [{ ...confirmed, hand: undefined, camera: "on" }, 0]
    ] as const) {
      assert.deepEqual(parseToggle(JSON.stringify(data), code, "hand"), {
        success: false, snapshot: { status: "unknown", reason: "invalid_cli_response" }
      });
    }
  }
});

test("hand feedback distinguishes raised, lowered, and unknown using a hand icon", () => {
  assert.equal(presentation({ status: "raised" }, "hand").label, "RAISED");
  assert.equal(presentation({ status: "lowered" }, "hand").label, "LOWERED");
  for (const status of ["unknown", "stale"] as const) {
    assert.equal(presentation({ status }, "hand").label, "UNKNOWN");
    const svg = renderSvg({ status }, "hand");
    assert.ok(!svg.includes('<circle'));
    assert.notEqual(svg, renderSvg({ status }, "mic"));
    assert.notEqual(svg, renderSvg({ status }, "camera"));
  }
  for (const status of ["raised", "lowered", "unknown", "checking", "toggling", "ambiguous"] as const) {
    assert.match(presentation({ status }, "hand").detail, /hand/);
  }
  assert.notEqual(renderSvg({ status: "raised" }, "hand"), renderSvg({ status: "lowered" }, "hand"));
});

async function fakeCli(t: { after(fn: () => Promise<void>): void }, body: string) {
  const dir = await mkdtemp(join(tmpdir(), "teams-hand-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "fake teams;$(nothing)"), log = join(dir, "calls.jsonl");
  await writeFile(file, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n');
${body}
`);
  await chmod(file, 0o755);
  return { file, calls: async () => (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line)) };
}

test("hand presses invoke exactly one native toggle and record one command span", async (t) => {
  for (const target of ["raised", "lowered"]) {
    const { file, calls } = await fakeCli(t, `
if (JSON.stringify(args) !== '["hand","toggle","--json"]') process.exit(64);
console.log(JSON.stringify({hand:'${target}',action:'toggle',success:true,focus_unchanged:true}));`);
    const timing = new PressTiming();
    assert.deepEqual(await toggleMedia(file, "hand", undefined, timing), { success: true, snapshot: { status: target, reason: undefined } });
    assert.deepEqual(await calls(), [["hand", "toggle", "--json"]]);
    assert.deepEqual(timing.report("hand").commands.map((span) => span.command), ["hand toggle --json"]);
    assert.ok(timing.report("hand").commands[0].complete_ms! >= 0);
  }
});

test("unknown, ambiguous, malformed, and failed hand toggles never confirm success", async (t) => {
  for (const [hand, code, expected] of [["unknown", 2, "unknown"], ["ambiguous", 2, "ambiguous"], ["permission_denied", 3, "permission_denied"], ["not_running", 4, "not_running"], ["unknown", 5, "unknown"], ["off", 0, "unknown"]] as const) {
    const { file, calls } = await fakeCli(t, `console.log(JSON.stringify({hand:'${hand}',action:'toggle',success:${code === 0},reason:'example'}));process.exit(${code});`);
    assert.equal((await toggleMedia(file, "hand")).success, false);
    assert.equal((await readMedia(file, "hand")).status, expected);
    assert.deepEqual(await calls(), [["hand", "toggle", "--json"], ["hand", "status", "--json"]]);
  }
  assert.equal((await toggleMedia("teams", "hand")).snapshot.reason, "absolute_path_required");
  assert.equal((await toggleMedia("/does-not-exist/teams", "hand")).snapshot.reason, "executable_missing");
});

test("an older CLI without hand toggle support fails without fallback or retry", async (t) => {
  const { file, calls } = await fakeCli(t, "console.error('Usage: teams hand <raise|lower>');process.exit(64);");
  assert.deepEqual(await toggleMedia(file, "hand"), { success: false, snapshot: { status: "unknown", reason: "invalid_cli_response" } });
  assert.deepEqual(await calls(), [["hand", "toggle", "--json"]]);
});

test("a refused hand action is surfaced without retrying", async (t) => {
  const { file, calls } = await fakeCli(t, `
console.log('{"hand":"unknown","action":"toggle","success":false,"reason":"verification_timeout"}'); process.exit(6);`);
  assert.deepEqual(await toggleMedia(file, "hand"), { success: false, snapshot: { status: "unknown", reason: "verification_timeout" } });
  assert.deepEqual(await calls(), [["hand", "toggle", "--json"]]);
});

test("a hung hand read or action never trusts partial output or retries", async (t) => {
  for (const hungOperation of ["status", "toggle"]) {
    const { file, calls } = await fakeCli(t, `
console.log(JSON.stringify(args[1] === 'status' ? {hand:'lowered'} : {hand:'raised',action:'toggle',success:true,focus_unchanged:true}));
if (args[1] === '${hungOperation}') setInterval(()=>{},1000);`);
    const result = hungOperation === "status" ? await readMedia(file, "hand", 300) : (await toggleMedia(file, "hand", 300)).snapshot;
    assert.deepEqual(result, { status: "unknown", reason: "command_terminated" });
    assert.deepEqual(await calls(), [["hand", hungOperation, "--json"]]);
  }
});
