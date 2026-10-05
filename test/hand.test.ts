import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMedia, toggleHand } from "../src/cli.ts";
import { parseStatus, parseHandAction, presentation, renderSvg } from "../src/status.ts";

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

test("hand actions require the requested action, matching final state, and preserved focus", () => {
  for (const [action, hand, opposite] of [["raise", "raised", "lowered"], ["lower", "lowered", "raised"]] as const) {
    const confirmed = { hand, action, success: true, focus_unchanged: true };
    // The CLI can confirm a no-op if another controller already reached the target.
    assert.deepEqual(parseHandAction(JSON.stringify({ ...confirmed, changed: false, action_attempted: false }), 0, action), {
      success: true, snapshot: { status: hand, reason: undefined }
    });
    for (const [state, code] of [["unknown", 6], ["ambiguous", 6], ["permission_denied", 3], ["not_running", 4], ["unknown", 5]] as const) {
      assert.deepEqual(parseHandAction(JSON.stringify({ hand: state, action, success: false, reason: "example" }), code, action), {
        success: false, snapshot: { status: state, reason: "example" }
      });
    }
    for (const [data, code] of [
      [null, 0], [{ hand }, 0], [confirmed, 6], [confirmed, 64],
      [{ ...confirmed, hand: opposite }, 0], [{ ...confirmed, success: false }, 0],
      [{ ...confirmed, action: "toggle" }, 0], [{ ...confirmed, action: action === "raise" ? "lower" : "raise" }, 0],
      [{ ...confirmed, focus_unchanged: false }, 0], [{ ...confirmed, focus_unchanged: undefined }, 0],
      [{ ...confirmed, hand: undefined, camera: "on" }, 0]
    ] as const) {
      assert.deepEqual(parseHandAction(JSON.stringify(data), code, action), {
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

test("hand presses read fresh state and invoke exactly one raise or lower without a shell", async (t) => {
  for (const [initial, action, target] of [["lowered", "raise", "raised"], ["raised", "lower", "lowered"]]) {
    const { file, calls } = await fakeCli(t, `
if (args[1] === 'status') console.log(JSON.stringify({hand:'${initial}'}));
else console.log(JSON.stringify({hand:'${target}',action:'${action}',success:true,focus_unchanged:true}));`);
    assert.deepEqual(await toggleHand(file), { success: true, snapshot: { status: target, reason: undefined } });
    assert.deepEqual(await calls(), [["hand", "status", "--json"], ["hand", action, "--json"]]);
  }
});

test("unknown, ambiguous, malformed, and failed hand reads never dispatch an action", async (t) => {
  for (const [hand, code, expected] of [["unknown", 2, "unknown"], ["ambiguous", 2, "ambiguous"], ["permission_denied", 3, "permission_denied"], ["not_running", 4, "not_running"], ["unknown", 5, "unknown"], ["off", 0, "unknown"]] as const) {
    const { file, calls } = await fakeCli(t, `console.log(JSON.stringify({hand:'${hand}',reason:'example'}));process.exit(${code});`);
    assert.equal((await toggleHand(file))?.success, false);
    assert.equal((await readMedia(file, "hand")).status, expected);
    assert.deepEqual(await calls(), [["hand", "status", "--json"], ["hand", "status", "--json"]]);
  }
  assert.equal((await toggleHand("teams"))?.snapshot.reason, "absolute_path_required");
  assert.equal((await toggleHand("/does-not-exist/teams"))?.snapshot.reason, "executable_missing");
});

test("a hand press is canceled if the key disappears or changes path during its fresh read", async (t) => {
  const { file, calls } = await fakeCli(t, "console.log('{\"hand\":\"lowered\"}');");
  assert.equal(await toggleHand(file, () => false), undefined);
  assert.deepEqual(await calls(), [["hand", "status", "--json"]]);
});

test("a refused hand action is surfaced without retrying", async (t) => {
  const { file, calls } = await fakeCli(t, `
if (args[1] === 'status') console.log('{"hand":"lowered"}');
else { console.log('{"hand":"unknown","action":"raise","success":false,"reason":"verification_timeout"}'); process.exit(6); }`);
  assert.deepEqual(await toggleHand(file), { success: false, snapshot: { status: "unknown", reason: "verification_timeout" } });
  assert.deepEqual(await calls(), [["hand", "status", "--json"], ["hand", "raise", "--json"]]);
});

test("a hung hand read or action never trusts partial output or retries", async (t) => {
  for (const hungOperation of ["status", "raise"]) {
    const { file, calls } = await fakeCli(t, `
console.log(JSON.stringify(args[1] === 'status' ? {hand:'lowered'} : {hand:'raised',action:'raise',success:true,focus_unchanged:true}));
if (args[1] === '${hungOperation}') setInterval(()=>{},1000);`);
    assert.deepEqual(await toggleHand(file, () => true, 300), {
      success: false, snapshot: { status: "unknown", reason: "command_terminated" }
    });
    assert.deepEqual(await calls(), hungOperation === "status" ? [["hand", "status", "--json"]] : [["hand", "status", "--json"], ["hand", "raise", "--json"]]);
  }
});
