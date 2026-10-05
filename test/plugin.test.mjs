import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, chmod, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";

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

async function launchPlugin(t, dir, cli, action) {
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
  const child = spawn(process.execPath, [join(runtime, "bin/plugin.js"),
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
  return { messages, waitFor, send, imageHas, payload };
}

const mediaStates = {
  mic: { field: "microphone", inactive: "muted", active: "unmuted", inactiveLabel: "MUTED", activeLabel: "LIVE" },
  camera: { field: "camera", inactive: "off", active: "on", inactiveLabel: "OFF", activeLabel: "ON" },
  hand: { field: "hand", inactive: "lowered", active: "raised", inactiveLabel: "LOWERED", activeLabel: "RAISED" }
};

test("hand button uses a fresh read, refuses unknown state, and cancels before dispatch on path change", { timeout: 20000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-streamdeck-hand-"));
  const cli = join(dir, "fake teams"), calls = join(dir, "calls.jsonl"), state = join(dir, "state");
  const block = join(dir, "block-read"), reading = join(dir, "reading");
  await writeFile(state, "lowered");
  await writeFile(cli, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');
if (args.length !== 3 || args[0] !== 'hand' || args[2] !== '--json') process.exit(64);
async function run() {
  if (args[1] === 'status') {
    if (fs.existsSync(${JSON.stringify(block)})) {
      fs.writeFileSync(${JSON.stringify(reading)}, '');
      const deadline = Date.now()+5000;
      while (fs.existsSync(${JSON.stringify(block)})) {
        if (Date.now()>deadline) process.exit(70);
        await new Promise(resolve=>setTimeout(resolve,10));
      }
    }
    const hand=fs.readFileSync(${JSON.stringify(state)},'utf8');
    console.log(JSON.stringify({hand}));
    process.exit(hand==='unknown'?2:0);
  }
  if (!['raise','lower'].includes(args[1])) process.exit(64);
  const hand=args[1]==='raise'?'raised':'lowered';
  fs.writeFileSync(${JSON.stringify(state)},hand);
  console.log(JSON.stringify({hand,action:args[1],success:true,focus_unchanged:true}));
}
run();
`);
  await chmod(cli, 0o755);
  const { messages, waitFor, send, imageHas, payload } = await launchPlugin(t, dir, cli, "com.dario.teams-cli.hand-status");
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
  assert.deepEqual(await actions(), [["hand", "lower", "--json"]]);

  await writeFile(block, "");
  messages.length = 0;
  send("keyDown");
  await waitFor((m) => imageHas(m, "key-a", "TOGGLING"));
  const deadline = Date.now() + 5000;
  while (await readFile(reading).then(() => false, () => true)) {
    assert.ok(Date.now() < deadline, "fresh hand read did not start");
    await delay(10);
  }
  send("keyDown", "key-b");
  send("didReceiveSettings", "key-a", { payload: { ...payload, settings: { cliPath: "/missing/teams" } } });
  await waitFor((m) => imageHas(m, "key-a", "SETUP"));
  await rm(block);
  await waitFor((m) => imageHas(m, "key-b", "LOWERED"));
  assert.deepEqual(await actions(), [["hand", "lower", "--json"]]);
  assert.ok(!messages.some((m) => m.event === "showAlert"));

  await writeFile(state, "unknown");
  await waitFor((m) => imageHas(m, "key-b", "UNKNOWN"));
  send("keyDown", "key-b");
  await waitFor((m) => m.event === "showAlert" && m.context === "key-b");
  assert.deepEqual(await actions(), [["hand", "lower", "--json"]]);
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
  if (args[1] !== 'status' && !(args[0] === 'hand' ? ['raise','lower'] : ['toggle']).includes(args[1])) process.exit(64);
  if (args[1] === 'status') {
    const current = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
    console.log(JSON.stringify({[field]: current[field]}));
  } else if (['toggle','raise','lower'].includes(args[1])) {
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
      const next = args[0] === 'hand' ? (args[1] === 'raise' ? 'raised' : 'lowered') : (previous[field] === inactive ? active : inactive);
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
      assert.ok(args[1] === "status" || (args[0] === "hand" ? ["raise", "lower"] : ["toggle"]).includes(args[1]));
      assert.ok(["mic", "camera", "hand"].includes(args[0]));
      assert.deepEqual(args, [args[0], args[1], "--json"]);
    }
  });
}
