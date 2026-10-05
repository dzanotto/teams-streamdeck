import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, presentation, renderSvg } from "../src/status.ts";

test("preserves recognized and nonzero status results", () => {
  for (const [state, code] of [["muted", 0], ["unmuted", 0], ["ambiguous", 2], ["unknown", 2], ["permission_denied", 3], ["not_running", 4], ["unknown", 5]] as const) {
    assert.deepEqual(parseStatus(JSON.stringify({ microphone: state, reason: "example" }), code), { status: state, reason: "example" });
  }
});

test("malformed output and status/exit mismatches never imply muted", () => {
  for (const [output, code] of [["not JSON", 0], ["null", 0], ['{"camera":"off"}', 0], ['{"microphone":"muted"}', 5], ['{"microphone":"muted","reason":{}}', 0], ['{"microphone":"new_state"}', 0], ['{"microphone":"unknown"}', 64]] as const) {
    assert.equal(parseStatus(output, code).status, "unknown");
  }
});

test("missing controls, stale reads, and held calls remain visibly unknown", () => {
  assert.equal(presentation({ status: "unknown", reason: "no_call_controls" }).label, "UNKNOWN");
  assert.equal(presentation({ status: "stale" }).label, "UNKNOWN");
  assert.match(presentation({ status: "unknown", reason: "all_calls_on_hold" }).detail, /on hold/);
  assert.notEqual(renderSvg({ status: "muted" }), renderSvg({ status: "unmuted" }));
  assert.ok(!renderSvg({ status: "unknown", reason: '<script>alert(1)</script>' }).includes("script"));
});
