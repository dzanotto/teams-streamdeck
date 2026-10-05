import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, chmod, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";

test("built SDK plug-in registers, displays CLI changes, ignores presses, and handles settings", { timeout: 15000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-streamdeck-sdk-"));
  const runtime = join(dir, "com.dario.teams-cli.sdPlugin");
  await cp(resolve("com.dario.teams-cli.sdPlugin"), runtime, {
    recursive: true, filter: (source) => !source.includes("/logs")
  });
  const state = join(dir, "state.json"), calls = join(dir, "calls.jsonl"), cli = join(dir, "fake teams");
  await writeFile(state, '{"microphone":"muted"}');
  await writeFile(cli, `#!${process.execPath}\nconst fs = require('node:fs');fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');console.log(fs.readFileSync(${JSON.stringify(state)},'utf8'));\n`);
  await chmod(cli, 0o755);
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
  const action = "com.dario.teams-cli.mic-status";
  const payload = { controller: "Keypad", settings: { cliPath: cli }, resources: {}, coordinates: { column: 0, row: 0 }, isInMultiAction: false };
  function send(event, context = "key-a", extra = {}) {
    socket.send(JSON.stringify({ event, action, context, device: "test-device", payload, ...extra }));
  }
  function imageHas(message, context, label) {
    return message.event === "setImage" && message.context === context &&
      Buffer.from(message.payload.image.split(",")[1], "base64").toString().includes(`>${label}</text>`);
  }
  send("willAppear");
  await waitFor((m) => imageHas(m, "key-a", "MUTED"));
  send("willAppear", "key-b");
  await waitFor((m) => imageHas(m, "key-b", "MUTED"));
  assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 1);
  send("keyDown"); send("keyUp");
  await writeFile(state, '{"microphone":"unmuted"}');
  await waitFor((m) => imageHas(m, "key-a", "LIVE"));
  await waitFor((m) => imageHas(m, "key-b", "LIVE"));
  send("propertyInspectorDidAppear");
  send("sendToPlugin", "key-a", { payload: { request: "status" } });
  await waitFor((m) => m.event === "sendToPropertyInspector" && m.payload.label === "LIVE");
  send("didReceiveSettings", "key-a", { payload: { ...payload, settings: { cliPath: "/missing/teams" } } });
  await waitFor((m) => imageHas(m, "key-a", "SETUP"));
  send("willDisappear"); send("willDisappear", "key-b");
  await delay(100);
  const reads = (await readFile(calls, "utf8")).trim().split("\n");
  await delay(1200);
  assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, reads.length);
  for (const line of reads) assert.deepEqual(JSON.parse(line), ["mic", "status", "--json"]);
});
