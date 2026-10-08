import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, chmod, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";

test("built plug-in includes the project license and complete bundled dependency licenses", async () => {
  const bin = "com.dario.teams-cli.sdPlugin/bin";
  assert.deepEqual(await readFile(`${bin}/LICENSE`), await readFile("LICENSE"));
  const notices = await readFile(`${bin}/THIRD_PARTY_NOTICES.txt`, "utf8");
  for (const name of ["@elgato/streamdeck", "@elgato/utils", "@elgato/schemas", "ws", "zod"]) {
    const root = `node_modules/${name}`;
    const { version } = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
    assert.ok(notices.includes(`${name}@${version}\n`), `Missing attribution for ${name}`);
    assert.ok(notices.includes(await readFile(`${root}/LICENSE`, "utf8")), `Missing full license for ${name}`);
  }
});

test("end-call button dispatches once, reports results, and never polls or retries", { timeout: 20000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-streamdeck-call-end-"));
  const cli = join(dir, "fake teams"), calls = join(dir, "calls.jsonl");
  const response = join(dir, "response.json"), release = join(dir, "release-end");
  const confirmed = { code: 0, data: { call: "ended", action: "end", success: true, changed: true, action_attempted: true, focus_unchanged: false } };
  await writeFile(calls, "");
  await writeFile(response, JSON.stringify(confirmed));
  await writeFile(cli, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (JSON.stringify(args) !== '["call","end","--json"]') process.exit(64);
async function end() {
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(${JSON.stringify(release)})) {
    if (Date.now() > deadline) process.exit(70);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const response = JSON.parse(fs.readFileSync(${JSON.stringify(response)}, 'utf8'));
  console.log(JSON.stringify(response.data));
  process.exit(response.code);
}
end();
`);
  await chmod(cli, 0o755);
  const { messages, waitFor, send, imageHas, payload } = await launchPlugin(t, dir, cli, "com.dario.teams-cli.call-end");
  const invocations = async () => (await readFile(calls, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  send("willAppear");
  send("willAppear", "key-b");
  await waitFor((m) => imageHas(m, "key-a", "END CALL"));
  await waitFor((m) => imageHas(m, "key-b", "END CALL"));
  send("keyUp");
  send("propertyInspectorDidAppear");
  send("sendToPlugin", "key-a", { payload: { request: "status" } });
  await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload.label === "END CALL");
  await delay(1100);
  assert.deepEqual(await invocations(), []);

  messages.length = 0;
  send("keyDown"); send("keyUp");
  await waitFor((m) => imageHas(m, "key-a", "ENDING"));
  await waitFor((m) => imageHas(m, "key-b", "ENDING"));
  send("keyDown"); send("keyDown", "key-b"); send("keyUp", "key-b");
  await delay(100);
  await writeFile(release, "");
  await waitFor((m) => imageHas(m, "key-a", "ENDED"));
  await waitFor((m) => imageHas(m, "key-b", "ENDED"));
  await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload.label === "ENDED");
  assert.deepEqual(await invocations(), [["call", "end", "--json"]]);
  assert.ok(!messages.some((m) => m.event === "showAlert"));
  messages.length = 0;
  await waitFor((m) => imageHas(m, "key-a", "END CALL"));
  await waitFor((m) => imageHas(m, "key-b", "END CALL"));
  assert.equal((await invocations()).length, 1);

  await writeFile(response, JSON.stringify({ code: 6, data: { call: "unknown", action: "end", success: false, reason: "verification_timeout" } }));
  messages.length = 0;
  send("keyDown"); send("keyUp");
  await waitFor((m) => imageHas(m, "key-a", "UNKNOWN"));
  await waitFor((m) => imageHas(m, "key-b", "UNKNOWN"));
  await waitFor((m) => m.event === "showAlert" && m.context === "key-a");
  await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload.reason === "verification_timeout");
  await delay(1100);
  assert.equal((await invocations()).length, 2);

  messages.length = 0;
  send("didReceiveSettings", "key-a", { payload: { ...payload, settings: { cliPath: "/missing/teams" } } });
  await waitFor((m) => imageHas(m, "key-a", "END CALL"));
  send("keyDown"); send("keyUp");
  await waitFor((m) => imageHas(m, "key-a", "SETUP"));
  await waitFor((m) => m.event === "showAlert" && m.context === "key-a");
  assert.equal((await invocations()).length, 2);
  send("willDisappear");

  // Leaving a profile during dispatch cannot repeat the command or leak its success into a new key.
  await rm(release);
  await writeFile(response, JSON.stringify(confirmed));
  messages.length = 0;
  send("keyDown", "key-b"); send("keyUp", "key-b");
  await waitFor((m) => imageHas(m, "key-b", "ENDING"));
  send("willDisappear", "key-b");
  send("willAppear", "key-new");
  await waitFor((m) => imageHas(m, "key-new", "ENDING"));
  send("keyDown", "key-new"); send("keyUp", "key-new");
  await delay(100);
  await writeFile(release, "");
  await waitFor((m) => imageHas(m, "key-new", "END CALL"));
  assert.ok(!messages.some((m) => imageHas(m, "key-new", "ENDED")));
  send("willDisappear", "key-new");
  send("keyDown", "key-new");
  await delay(100);
  const sent = await invocations();
  assert.equal(sent.length, 3);
  for (const args of sent) assert.deepEqual(args, ["call", "end", "--json"]);
});

async function launchPlugin(t, dir, cli, action, cliFixtures) {
  const runtime = join(dir, "com.dario.teams-cli.sdPlugin");
  await cp(resolve("com.dario.teams-cli.sdPlugin"), runtime, {
    recursive: true, filter: (source) => !source.includes("/logs")
  });
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const info = {
    application: { font: "Arial", language: "en", platform: "mac", platformVersion: "27.0", version: "7.6.0" },
    colors: {}, devicePixelRatio: 2,
    devices: [{ id: "test-device", name: "Test device", type: 0, size: { columns: 5, rows: 3 } }],
    plugin: { uuid: "com.dario.teams-cli", version: "0.1.0.0" }
  };
  const preload = [];
  if (cliFixtures) {
    // Redirect discovery and execution in this child only. These tests must never
    // invoke the developer's actual Homebrew Teams executables.
    const mapping = {
      "/opt/homebrew/bin/teams-cli": join(dir, "missing-homebrew-cli"),
      "/usr/local/bin/teams-cli": join(dir, "missing-homebrew-cli"),
      ...cliFixtures
    };
    const shim = join(dir, "cli-fixtures.mjs");
    await writeFile(shim, `
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const mapping = ${JSON.stringify(mapping)};
const redirect = path => typeof path === 'string' && Object.hasOwn(mapping, path) ? mapping[path] : path;
for (const method of ['statSync', 'accessSync']) {
  const original = fs[method];
  fs[method] = (path, ...args) => original(redirect(path), ...args);
}
const execFile = childProcess.execFile;
childProcess.execFile = (path, ...args) => execFile(redirect(path), ...args);
syncBuiltinESMExports();
`);
    preload.push("--import", pathToFileURL(shim).href);
  }
  const child = spawn(process.execPath, [...preload, join(runtime, "bin/plugin.js"),
    "-port", String(server.address().port), "-pluginUUID", "test-plugin", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)
  ], { cwd: runtime, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stderr.on("data", (data) => { output += data; });
  child.stdout.on("data", (data) => { output += data; });
  t.after(async () => {
    child.kill("SIGTERM");
    for (const socket of server.clients) socket.terminate();
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const [socket] = await once(server, "connection");
  const messages = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const found = messages.find(predicate);
      if (found) return found;
      if (child.exitCode !== null) throw new Error(`Plug-in exited: ${output}`);
      await delay(20);
    }
    throw new Error(`Timed out waiting for plug-in message. ${output}`);
  }
  await waitFor((m) => m.event === "registerPlugin" && m.uuid === "test-plugin");
  const payload = { controller: "Keypad", settings: { cliPath: cli }, resources: {}, coordinates: { column: 0, row: 0 }, isInMultiAction: false };
  function send(event, context = "key-a", extra = {}) {
    socket.send(JSON.stringify({ event, action, context, device: "test-device", payload, ...extra }));
  }
  function imageHas(message, context, label) {
    return message.event === "setImage" && message.context === context &&
      Buffer.from(message.payload.image.split(",")[1], "base64").toString().includes(`>${label}</text>`);
  }
  async function waitForTiming(predicate) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const files = await readdir(join(runtime, "logs")).catch(() => []);
      const logs = await Promise.all(files.filter((file) => file.endsWith(".log")).map((file) => readFile(join(runtime, "logs", file), "utf8")));
      for (const line of logs.join("\n").split("\n")) {
        const match = line.match(/button_timing (\{.*\})$/);
        if (match) { const record = JSON.parse(match[1]); if (predicate(record)) return record; }
      }
      await delay(20);
    }
    throw new Error(`Timed out waiting for button timing log. ${output}`);
  }
  return { messages, waitFor, waitForTiming, send, imageHas, payload };
}

for (const homebrewPath of ["/opt/homebrew/bin/teams-cli", "/usr/local/bin/teams-cli"]) {
  test(`Homebrew ${homebrewPath}: unconfigured keys share the detected CLI; saved paths survive`, { timeout: 15000 }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "teams-streamdeck-homebrew-"));
    const cli = join(dir, "teams-cli"), calls = join(dir, "calls.jsonl");
    const customPath = join(dir, "missing-custom-cli");
    await writeFile(cli, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (JSON.stringify(args) === '["mic","status","--json"]') console.log('{"microphone":"muted"}');
else if (JSON.stringify(args) === '["mic","toggle","--json"]') console.log('{"microphone":"unmuted","action":"toggle","success":true,"focus_unchanged":true}');
else process.exit(64);
`, { mode: 0o755 });
    const { messages, waitFor, send, imageHas, payload } = await launchPlugin(t, dir, cli, "com.dario.teams-cli.mic-status", { [homebrewPath]: cli });
    const withSettings = (settings) => ({ payload: { ...payload, settings } });
    send("willAppear", "new", withSettings({ extra: "preserved" }));
    send("willAppear", "empty", withSettings({ cliPath: "  ", extra: "preserved" }));
    send("willAppear", "custom", withSettings({ cliPath: customPath, cliPathManual: false }));
    for (const key of ["new", "empty"]) {
      const saved = await waitFor((m) => m.event === "setSettings" && m.context === key);
      assert.deepEqual(saved.payload, { cliPath: homebrewPath, extra: "preserved" });
      await waitFor((m) => imageHas(m, key, "MUTED"));
      send("didReceiveSettings", key, withSettings(saved.payload));
    }
    const callsBefore = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(callsBefore, [["mic", "status", "--json"]], "keys must share the resolved executable's poll");
    await waitFor((m) => imageHas(m, "custom", "SETUP"));
    assert.ok(!messages.some((m) => m.event === "setSettings" && m.context === "custom"));
    send("keyDown", "empty");
    await waitFor((m) => imageHas(m, "empty", "LIVE"));
    await waitFor((m) => imageHas(m, "new", "LIVE"));
    const invocations = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(invocations.filter((args) => args[1] === "toggle"), [["mic", "toggle", "--json"]]);
    assert.equal(messages.filter((m) => m.event === "setSettings").length, 2, "echoed settings must not cause a write loop");

    // A saved override must take effect even when the executable is missing.
    messages.length = 0;
    send("didReceiveSettings", "empty", withSettings({ cliPath: customPath, cliPathManual: true }));
    await waitFor((m) => imageHas(m, "empty", "SETUP"));
    assert.ok(!messages.some((m) => m.event === "setSettings"));
    send("willDisappear", "empty");
    send("willDisappear", "custom");
    send("willDisappear", "new");
  });
}

test("without Homebrew, configured keys keep their path and new keys show SETUP", { timeout: 10000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-streamdeck-no-homebrew-"));
  const cli = join(dir, "teams-cli");
  await writeFile(cli, `#!${process.execPath}\nconsole.log('{"microphone":"muted"}');\n`, { mode: 0o755 });
  const { messages, waitFor, send, imageHas, payload } = await launchPlugin(t, dir, cli, "com.dario.teams-cli.mic-status", {});
  send("willAppear", "configured", { payload: { ...payload, settings: { cliPath: cli } } });
  send("willAppear", "new", { payload: { ...payload, settings: {} } });
  await waitFor((m) => imageHas(m, "configured", "MUTED"));
  await waitFor((m) => imageHas(m, "new", "SETUP"));
  const saved = await waitFor((m) => m.event === "setSettings" && m.context === "new");
  assert.equal(saved.payload.cliPath, process.arch === "arm64" ? "/opt/homebrew/bin/teams-cli" : "/usr/local/bin/teams-cli");
  assert.ok(!messages.some((m) => m.event === "setSettings" && m.context === "configured"));
  send("willDisappear", "configured");
  send("willDisappear", "new");
});

const mediaStates = {
  mic: { field: "microphone", inactive: "muted", active: "unmuted", inactiveLabel: "MUTED", activeLabel: "LIVE" },
  camera: { field: "camera", inactive: "off", active: "on", inactiveLabel: "OFF", activeLabel: "ON" },
  hand: { field: "hand", inactive: "lowered", active: "raised", inactiveLabel: "LOWERED", activeLabel: "RAISED" }
};

for (const media of ["mic", "camera", "hand"]) {
  test(`${media}: pressing during a hung poll kills it before dispatch and logs all stages`, { timeout: 15000 }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "teams-streamdeck-cancel-"));
    const cli = join(dir, "fake teams"), reading = join(dir, "reading"), calls = join(dir, "calls");
    const dispatch = join(dir, "dispatch"), release = join(dir, "release");
    const { field, inactive, active, activeLabel } = mediaStates[media];
    await writeFile(cli, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (args[1] === 'status' && !fs.existsSync(${JSON.stringify(reading)})) {
  process.stdout.write(JSON.stringify({${field}:'${inactive}'})+'\\n', () => fs.writeFileSync(${JSON.stringify(reading)}, String(process.pid)));
  setInterval(() => {}, 1000);
} else if (args[1] === 'status') {
  console.log(JSON.stringify({${field}:'${inactive}'}));
} else {
  const pid = Number(fs.readFileSync(${JSON.stringify(reading)}, 'utf8'));
  try { process.kill(pid, 0); process.exit(74); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  fs.writeFileSync(${JSON.stringify(dispatch)}, '');
  async function run() {
    const deadline = Date.now()+5000;
    while (!fs.existsSync(${JSON.stringify(release)})) {
      if (Date.now()>deadline) process.exit(70);
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    console.log(JSON.stringify({${field}:'${active}',action:args[1],success:true,focus_unchanged:true}));
  }
  run();
}
`);
    await chmod(cli, 0o755);
    const { messages, waitFor, waitForTiming, send, imageHas } = await launchPlugin(t, dir, cli, `com.dario.teams-cli.${media}-status`);
    async function waitForFile(path) {
      const deadline = Date.now() + 5000;
      while (await readFile(path).then(() => false, () => true)) {
        assert.ok(Date.now() < deadline, `Missing ${path}`);
        await delay(10);
      }
    }
    send("willAppear"); send("willAppear", "key-b");
    await waitForFile(reading);
    send("keyDown"); send("keyDown", "key-b");
    await waitFor((m) => imageHas(m, "key-a", "TOGGLING"));
    await waitForFile(dispatch);
    const ignored = await waitForTiming((record) => record.outcome === "ignored_busy");
    assert.deepEqual(ignored.commands, []);
    assert.equal(ignored.stages_ms.ready, undefined);
    await writeFile(release, "");
    await waitFor((m) => imageHas(m, "key-a", activeLabel));
    await waitFor((m) => imageHas(m, "key-b", activeLabel));
    const timing = await waitForTiming((record) => record.outcome === "confirmed");
    assert.equal(timing.control, media);
    assert.notEqual(timing.press_id, ignored.press_id);
    const stages = ["accepted", "poll_cancel_requested", "poll_settled", "command_started", "command_completed", "ready"].map((stage) => timing.stages_ms[stage]);
    assert.ok(stages.every(Number.isFinite));
    assert.deepEqual(stages, [...stages].sort((a, b) => a - b));
    assert.deepEqual(timing.commands.map((span) => span.command), [`${media} toggle --json`]);
    for (const span of timing.commands) {
      assert.ok(span.dispatch_ms >= timing.stages_ms.poll_settled);
      assert.ok(span.complete_ms >= span.dispatch_ms);
      assert.ok(span.complete_ms <= timing.stages_ms.command_completed);
      assert.ok(span.duration_ms >= 0);
    }
    assert.ok(!messages.some((m) => m.event === "showAlert"));
    const invocations = (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(invocations.filter((args) => args[1] !== "status").length, 1);
    send("willDisappear"); send("willDisappear", "key-b");
  });
}

test("hand button delegates fresh state to native toggle and preserves in-flight actions on path change", { timeout: 20000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-streamdeck-hand-"));
  const cli = join(dir, "fake teams"), calls = join(dir, "calls.jsonl"), state = join(dir, "state");
  const block = join(dir, "block-toggle"), dispatch = join(dir, "dispatch");
  await writeFile(state, "lowered");
  await writeFile(cli, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (args.length !== 3 || args[0] !== 'hand' || args[2] !== '--json') process.exit(64);
async function run() {
  if (args[1] === 'status') {
    const hand=fs.readFileSync(${JSON.stringify(state)},'utf8');
    console.log(JSON.stringify({hand}));
    process.exit(hand==='unknown'?2:0);
  }
  if (args[1] !== 'toggle') process.exit(64);
  fs.writeFileSync(${JSON.stringify(dispatch)}, '');
  const deadline = Date.now()+5000;
  while (fs.existsSync(${JSON.stringify(block)})) {
    if (Date.now()>deadline) process.exit(70);
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  const previous=fs.readFileSync(${JSON.stringify(state)},'utf8');
  if (previous==='unknown') {
    console.log(JSON.stringify({hand:'unknown',action:'toggle',success:false,reason:'own_video_missing'}));
    process.exit(6);
  }
  const hand=previous==='raised'?'lowered':'raised';
  fs.writeFileSync(${JSON.stringify(state)},hand);
  console.log(JSON.stringify({hand,action:args[1],success:true,focus_unchanged:true}));
}
run();
`);
  await chmod(cli, 0o755);
  const { messages, waitFor, waitForTiming, send, imageHas, payload } = await launchPlugin(t, dir, cli, "com.dario.teams-cli.hand-status");
  const actions = async () => (await readFile(calls, "utf8")).trim().split("\n").map(JSON.parse).filter((args) => args[1] !== "status");
  send("willAppear");
  await waitFor((m) => imageHas(m, "key-a", "LOWERED"));
  send("willAppear", "key-b");
  await waitFor((m) => imageHas(m, "key-b", "LOWERED"));
  await writeFile(state, "raised");
  messages.length = 0;
  send("keyDown");
  await waitFor((m) => imageHas(m, "key-a", "TOGGLING"));
  await waitFor((m) => imageHas(m, "key-a", "LOWERED"));
  assert.deepEqual(await actions(), [["hand", "toggle", "--json"]]);
  const timing = await waitForTiming((record) => record.outcome === "confirmed");
  assert.deepEqual(timing.commands.map((span) => span.command), ["hand toggle --json"]);

  await rm(dispatch);
  await writeFile(block, "");
  messages.length = 0;
  send("keyDown");
  await waitFor((m) => imageHas(m, "key-a", "TOGGLING"));
  const deadline = Date.now() + 5000;
  while (await readFile(dispatch).then(() => false, () => true)) {
    assert.ok(Date.now() < deadline, "hand toggle did not start");
    await delay(10);
  }
  send("keyDown", "key-b");
  send("didReceiveSettings", "key-a", { payload: { ...payload, settings: { cliPath: "/missing/teams" } } });
  await waitFor((m) => imageHas(m, "key-a", "SETUP"));
  await rm(block);
  await waitFor((m) => imageHas(m, "key-b", "RAISED"));
  assert.deepEqual(await actions(), [["hand", "toggle", "--json"], ["hand", "toggle", "--json"]]);
  assert.ok(!messages.some((m) => imageHas(m, "key-a", "RAISED")));
  assert.ok(!messages.some((m) => m.event === "showAlert"));

  await writeFile(state, "unknown");
  await waitFor((m) => imageHas(m, "key-b", "UNKNOWN"));
  send("keyDown", "key-b");
  await waitFor((m) => m.event === "showAlert" && m.context === "key-b");
  assert.deepEqual(await actions(), Array.from({ length: 3 }, () => ["hand", "toggle", "--json"]));
  const failed = await waitForTiming((record) => record.outcome === "failed" && record.reason === "own_video_missing");
  assert.deepEqual(failed.commands.map((span) => span.command), ["hand toggle --json"]);
  send("willDisappear"); send("willDisappear", "key-b");
});

for (const media of ["mic", "camera", "hand"]) {
  test(`${media}: built SDK plug-in shares status, toggles, reports failures, and isolates the other control`, { timeout: 20000 }, async (t) => {
    const { field, inactive, active, inactiveLabel, activeLabel } = mediaStates[media];
    const otherMedia = media === "mic" ? "camera" : "mic";
    const { field: otherField, inactive: otherInactive, inactiveLabel: otherLabel } = mediaStates[otherMedia];
    const otherAction = `com.dario.teams-cli.${otherMedia}-status`;
    const dir = await mkdtemp(join(tmpdir(), "teams-streamdeck-sdk-"));
    const state = join(dir, "state.json"), calls = join(dir, "calls.jsonl"), cli = join(dir, "fake teams");
    const release = join(dir, "release-toggle"), failure = join(dir, "fail-toggle");
    await writeFile(state, '{"microphone":"muted","camera":"off","hand":"lowered"}');
    await writeFile(cli, `#!${process.execPath}
  const fs = require('node:fs');
  const args = process.argv.slice(2);
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
  if (args.length !== 3 || !['mic','camera','hand'].includes(args[0]) || args[2] !== '--json') process.exit(64);
  const {field, inactive, active} = ${JSON.stringify(mediaStates)}[args[0]];
  if (!['status','toggle'].includes(args[1])) process.exit(64);
  if (args[1] === 'status') {
    const current = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
    console.log(JSON.stringify({[field]: current[field]}));
  } else if (args[1] === 'toggle') {
    async function toggle() {
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(${JSON.stringify(release)})) {
        if (Date.now() > deadline) process.exit(70);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      if (fs.existsSync(${JSON.stringify(failure)})) {
        console.log(JSON.stringify({[field]:'unknown',action:args[1],success:false,reason:'verification_timeout'}));
        process.exit(6);
      }
      const previous = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
      const next = previous[field] === inactive ? active : inactive;
      fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify({...previous, [field]:next}));
      console.log(JSON.stringify({[field]:next,action:args[1],success:true,focus_unchanged:true}));
    }
    toggle();
  } else process.exit(64);
  `);
    await chmod(cli, 0o755);
    const action = `com.dario.teams-cli.${media}-status`;
    const { messages, waitFor, send, imageHas, payload } = await launchPlugin(t, dir, cli, action);
    async function toggleCount() {
      return (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line)).filter((args) => args[1] !== "status").length;
    }
    send("willAppear");
    await waitFor((m) => imageHas(m, "key-a", inactiveLabel));
    send("willAppear", "key-b");
    await waitFor((m) => imageHas(m, "key-b", inactiveLabel));
    assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 1);
    send("willAppear", "other-key", { action: otherAction });
    await waitFor((m) => imageHas(m, "other-key", otherLabel));
    send("propertyInspectorDidAppear");
    await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload.label === inactiveLabel);
    // A late or absent disappearance event must not let the old inspector overwrite the new one.
    send("propertyInspectorDidAppear", "other-key", { action: otherAction });
    await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload.label === otherLabel);
    messages.length = 0;
    send("keyDown"); send("keyUp");
    await waitFor((m) => imageHas(m, "key-a", "TOGGLING"));
    await waitFor((m) => imageHas(m, "key-b", "TOGGLING"));
    send("keyDown"); send("keyDown", "key-b"); send("keyUp", "key-b");
    await delay(100);
    await writeFile(release, "");
    await waitFor((m) => imageHas(m, "key-a", activeLabel));
    await waitFor((m) => imageHas(m, "key-b", activeLabel));
    assert.equal(await toggleCount(), 1);
    assert.equal(JSON.parse(await readFile(state, "utf8"))[field], active);
    assert.equal(JSON.parse(await readFile(state, "utf8"))[otherField], otherInactive);
    assert.ok(!messages.some((m) => m.event === "setImage" && m.context === "other-key"));
    assert.ok(!messages.some((m) => m.event === "sendToPropertyInspector"));

    messages.length = 0;
    send("keyDown", "key-b"); send("keyUp", "key-b");
    await waitFor((m) => imageHas(m, "key-a", inactiveLabel));
    await waitFor((m) => imageHas(m, "key-b", inactiveLabel));
    assert.equal(await toggleCount(), 2);

    await writeFile(failure, "");
    messages.length = 0;
    send("keyDown"); send("keyUp");
    await waitFor((m) => m.event === "showAlert" && m.context === "key-a");
    await waitFor((m) => imageHas(m, "key-a", "UNKNOWN"));
    await waitFor((m) => imageHas(m, "key-b", "UNKNOWN"));
    send("propertyInspectorDidAppear");
    await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload.reason === "verification_timeout");
    await waitFor((m) => imageHas(m, "key-a", inactiveLabel));
    assert.equal(await toggleCount(), 3);
    assert.equal(JSON.parse(await readFile(state, "utf8"))[field], inactive);
    assert.equal(JSON.parse(await readFile(state, "utf8"))[otherField], otherInactive);

    // External changes continue to refresh without dispatching a toggle.
    messages.length = 0;
    await writeFile(state, JSON.stringify({ [field]: active, [otherField]: otherInactive }));
    await waitFor((m) => imageHas(m, "key-a", activeLabel));
    await waitFor((m) => imageHas(m, "key-b", activeLabel));
    send("propertyInspectorDidAppear");
    send("sendToPlugin", "key-a", { payload: { request: "status" } });
    await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload.label === activeLabel && m.payload.detail.includes(field));
    send("didReceiveSettings", "key-a", { payload: { ...payload, settings: { cliPath: "/missing/teams" } } });
    await waitFor((m) => imageHas(m, "key-a", "SETUP"));
    messages.length = 0;
    send("keyDown"); send("keyUp");
    await waitFor((m) => m.event === "showAlert" && m.context === "key-a");
    await waitFor((m) => imageHas(m, "key-a", "SETUP"));
    assert.equal(await toggleCount(), 3);
    send("willDisappear"); send("willDisappear", "key-b");
    await delay(100);
    const before = (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    await delay(1200);
    const after = (await readFile(calls, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(after.filter((args) => args[0] === media).length, before.filter((args) => args[0] === media).length);
    assert.ok(after.filter((args) => args[0] === otherMedia).length > before.filter((args) => args[0] === otherMedia).length);
    assert.ok(after.filter((args) => args[0] === otherMedia).every((args) => args[1] === "status"));
    send("willDisappear", "other-key", { action: otherAction });
    await delay(100);
    const reads = (await readFile(calls, "utf8")).trim().split("\n");
    await delay(1200);
    assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, reads.length);
    for (const line of reads) {
      const args = JSON.parse(line);
      assert.ok(["status", "toggle"].includes(args[1]));
      assert.ok(["mic", "camera", "hand"].includes(args[0]));
      assert.deepEqual(args, [args[0], args[1], "--json"]);
    }
  });
}
