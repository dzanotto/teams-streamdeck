import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, parseToggle, parseCallEnd, presentation, renderSvg } from "../src/status.ts";

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

test("camera status uses only camera states and keeps failures distinct from OFF", () => {
  for (const [camera, code] of [["on", 0], ["off", 0], ["unknown", 2], ["ambiguous", 2], ["permission_denied", 3], ["not_running", 4], ["unknown", 5]] as const) {
    assert.deepEqual(parseStatus(JSON.stringify({ camera, reason: "example" }), code, "camera"), { status: camera, reason: "example" });
  }
  for (const [output, code] of [
    ["not JSON", 0], ["null", 0], ['{"microphone":"muted"}', 0], ['{"camera":"muted"}', 0],
    ['{"camera":"off"}', 5], ['{"camera":"off","reason":{}}', 0], ['{"camera":"unknown"}', 64]
  ] as const) {
    assert.equal(parseStatus(output, code, "camera").status, "unknown");
  }
  const both = '{"microphone":"muted","camera":"on"}';
  assert.equal(parseStatus(both, 0, "camera").status, "on");
  assert.equal(parseStatus(both, 0, "mic").status, "muted");
  assert.equal(parseStatus('{"microphone":"on"}', 0).status, "unknown");
});

test("camera toggles require confirmed camera results and preserve refusal reasons", () => {
  for (const camera of ["on", "off"]) {
    assert.deepEqual(parseToggle(JSON.stringify({ camera, action: "toggle", success: true, focus_unchanged: true }), 0, "camera"), {
      success: true, snapshot: { status: camera, reason: undefined }
    });
  }
  for (const [camera, code] of [["unknown", 6], ["ambiguous", 6], ["permission_denied", 3], ["not_running", 4], ["unknown", 5]] as const) {
    assert.deepEqual(parseToggle(JSON.stringify({ camera, action: "toggle", success: false, reason: "example" }), code, "camera"), {
      success: false, snapshot: { status: camera, reason: "example" }
    });
  }
  for (const [data, code] of [
    [{ camera: "on" }, 0],
    [{ camera: "on", action: "toggle", success: false }, 0],
    [{ camera: "on", action: "toggle", success: true, focus_unchanged: true }, 6],
    [{ camera: "on", action: "toggle", success: true, focus_unchanged: false }, 0],
    [{ camera: "on", action: "toggle", success: true }, 0],
    [{ camera: "on", action: "on", success: true, focus_unchanged: true }, 0],
    [{ microphone: "unmuted", action: "toggle", success: true, focus_unchanged: true }, 0]
  ] as const) {
    assert.deepEqual(parseToggle(JSON.stringify(data), code, "camera"), {
      success: false, snapshot: { status: "unknown", reason: "invalid_cli_response" }
    });
  }
});

test("camera presentation distinguishes ON, OFF, and unknown without microphone copy", () => {
  assert.equal(presentation({ status: "on" }, "camera").label, "ON");
  assert.equal(presentation({ status: "off" }, "camera").label, "OFF");
  for (const status of ["unknown", "stale"] as const) {
    assert.equal(presentation({ status }, "camera").label, "UNKNOWN");
    assert.notEqual(renderSvg({ status }, "camera"), renderSvg({ status }, "mic"));
  }
  for (const status of ["on", "off", "unknown", "checking", "toggling", "ambiguous"] as const) {
    const detail = presentation({ status }, "camera").detail;
    assert.ok(detail.includes("camera"));
    assert.ok(!detail.includes("microphone"));
  }
  assert.notEqual(renderSvg({ status: "on" }, "camera"), renderSvg({ status: "off" }, "camera"));
});

test("call end accepts verified completion even when closing Teams changes focus", () => {
  for (const focus of [true, false, undefined]) {
    assert.deepEqual(parseCallEnd(JSON.stringify({
      call: "ended", action: "end", success: true, changed: true, action_attempted: true, focus_unchanged: focus
    }), 0), { success: true, snapshot: { status: "ended", reason: undefined } });
  }
  for (const [call, code, reason] of [
    ["unknown", 6, "verification_timeout"], ["ambiguous", 6, "multiple_call_windows"],
    ["unknown", 6, "all_calls_on_hold"], ["unknown", 6, "command_in_progress"],
    ["unknown", 6, "no_call_controls"], ["permission_denied", 3, "accessibility_permission_required"],
    ["not_running", 4, "teams_not_running"], ["unknown", 5, "read_failed"]
  ] as const) {
    assert.deepEqual(parseCallEnd(JSON.stringify({ call, action: "end", success: false, reason }), code), {
      success: false, snapshot: { status: call, reason }
    });
  }
});

test("call end rejects malformed or contradictory results instead of claiming completion", () => {
  const confirmed = { call: "ended", action: "end", success: true, changed: true, action_attempted: true };
  for (const [data, code] of [
    [null, 0], [[], 0], [{ call: "ended" }, 0], [confirmed, 6], [confirmed, 64],
    [{ ...confirmed, success: false }, 0], [{ ...confirmed, call: "unknown" }, 0],
    [{ ...confirmed, call: "active" }, 0], [{ ...confirmed, action: "toggle" }, 0],
    [{ ...confirmed, changed: false }, 0], [{ ...confirmed, action_attempted: false }, 0],
    [{ ...confirmed, reason: {} }, 0],
    [{ microphone: "muted", action: "end", success: true, changed: true, action_attempted: true }, 0]
  ] as const) {
    assert.deepEqual(parseCallEnd(JSON.stringify(data), code), {
      success: false, snapshot: { status: "unknown", reason: "invalid_cli_response" }
    });
  }
  assert.equal(parseCallEnd("not JSON", 0).success, false);
  assert.equal(presentation({ status: "ready" }, "call").label, "END CALL");
  assert.equal(presentation({ status: "ending" }, "call").label, "ENDING");
  assert.equal(presentation({ status: "ended" }, "call").label, "ENDED");
  assert.match(presentation({ status: "unknown" }, "call").detail, /not confirmed/);
});
