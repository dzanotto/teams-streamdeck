import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, parseToggle, presentation, renderSvg } from "../src/status.ts";

test("preserves recognized and nonzero status results", () => {
  for (const [state, code] of [["muted", 0], ["unmuted", 0], ["ambiguous", 2], ["unknown", 2], ["permission_denied", 3], ["not_running", 4], ["unknown", 5]] as const) {
    assert.deepEqual(parseStatus(JSON.stringify({ microphone: state, reason: "example" }), code), { status: state, reason: "example" });
  }
});

test("toggle results require explicit success, a known state, and preserved focus", () => {
  for (const microphone of ["muted", "unmuted"]) {
    assert.deepEqual(parseToggle(JSON.stringify({ microphone, action: "toggle", success: true, focus_unchanged: true }), 0), {
      success: true, snapshot: { status: microphone, reason: undefined }
    });
  }
  for (const [microphone, code, reason] of [
    ["unknown", 6, "verification_timeout"], ["ambiguous", 6, "multiple_call_windows"],
    ["unknown", 6, "command_in_progress"], ["permission_denied", 3, "accessibility_permission_required"],
    ["not_running", 4, "teams_not_running"], ["unknown", 5, "read_failed"]
  ] as const) {
    assert.deepEqual(parseToggle(JSON.stringify({ microphone, action: "toggle", success: false, reason }), code), {
      success: false, snapshot: { status: microphone, reason }
    });
  }
  for (const [data, code] of [
    [null, 0], [{ microphone: "muted" }, 0],
    [{ microphone: "muted", action: "toggle", success: false }, 0],
    [{ microphone: "muted", action: "toggle", success: true, focus_unchanged: true }, 6],
    [{ microphone: "muted", action: "toggle", success: false }, 6],
    [{ microphone: "muted", action: "toggle", success: true, focus_unchanged: false }, 0],
    [{ microphone: "muted", action: "toggle", success: true }, 0],
    [{ microphone: "muted", action: "mute", success: true, focus_unchanged: true }, 0],
    [{ microphone: "unknown", action: "toggle", success: false }, 64]
  ] as const) {
    assert.deepEqual(parseToggle(JSON.stringify(data), code), {
      success: false, snapshot: { status: "unknown", reason: "invalid_cli_response" }
    });
  }
  assert.equal(parseToggle("not JSON", 0).success, false);
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
