import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("settings UI registers and routes settings/status messages to the selected action", () => {
  const sent: Record<string, unknown>[] = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    static instance: Socket;
    onopen!: () => void;
    onmessage!: (ev: { data: string }) => void;
    constructor() { Socket.instance = this; }
    send(data: string) { sent.push(JSON.parse(data)); }
  }
  class Element {
    value = ""; disabled = false; textContent = ""; style = {}; validity = "";
    onsubmit!: (event: { preventDefault(): void }) => void;
    setCustomValidity(value: string) { this.validity = value; }
    reportValidity() { return !this.validity; }
  }
  const elements = new Map<string, Element>();
  const element = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)!; };
  const window: Record<string, (...args: string[]) => void> = {};
  runInNewContext(readFileSync("com.dario.teams-cli.sdPlugin/ui/settings.js", "utf8"), {
    window, WebSocket: Socket, document: { getElementById: element, activeElement: null }
  });
  window.connectElgatoStreamDeckSocket("123", "inspector-id", "registerPropertyInspector", "{}", JSON.stringify({
    action: "com.dario.teams-cli.mic-status", context: "key-a", payload: { settings: { cliPath: "/old/teams", extra: "preserved" } }
  }));
  Socket.instance.onopen();
  assert.deepEqual(sent[0], { event: "registerPropertyInspector", uuid: "inspector-id" });
  assert.deepEqual(sent[1], { event: "getSettings", action: "com.dario.teams-cli.mic-status", context: "key-a" });
  assert.deepEqual(sent[2], { event: "sendToPlugin", action: "com.dario.teams-cli.mic-status", context: "key-a", payload: { request: "status" } });
  element("cliPath").value = "/new path/teams";
  element("settings").onsubmit({ preventDefault() {} });
  assert.deepEqual(sent[3], { event: "setSettings", action: "com.dario.teams-cli.mic-status", context: "key-a", payload: { cliPath: "/new path/teams", extra: "preserved" } });
  element("cliPath").value = "relative/path";
  element("settings").onsubmit({ preventDefault() {} });
  assert.equal(sent.length, 4);
});
