export type Media = "mic" | "camera" | "hand";
export type Control = Media | "call";
export type Status = "muted" | "unmuted" | "on" | "off" | "raised" | "lowered" | "unknown" | "ambiguous" |
  "permission_denied" | "not_running" | "setup" | "checking" | "stale" | "toggling" |
  "ready" | "ending" | "ended";

export type Snapshot = { status: Status; reason?: string };
export type ActionResult = { success: boolean; snapshot: Snapshot };

const exitStates: Record<number, readonly string[]> = {
  2: ["unknown", "ambiguous"],
  3: ["permission_denied"], 4: ["not_running"], 5: ["unknown"]
};

const knownStates: Record<Media, readonly string[]> = {
  mic: ["muted", "unmuted"], camera: ["on", "off"], hand: ["raised", "lowered"]
};

export function parseStatus(stdout: string, exitCode: number, media: Media = "mic"): Snapshot {
  try {
    const data: unknown = JSON.parse(stdout);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    const record = data as Record<string, unknown>;
    const state = record[media === "mic" ? "microphone" : media];
    const allowed = exitCode === 0 ? knownStates[media] : exitStates[exitCode];
    if (typeof state !== "string" ||
        !allowed?.includes(state) ||
        (record.reason !== undefined && typeof record.reason !== "string")) throw new Error();
    return { status: state as Status, reason: record.reason as string | undefined };
  } catch {
    return { status: "unknown", reason: "invalid_cli_response" };
  }
}

export function parseToggle(stdout: string, exitCode: number, media: Media = "mic"): ActionResult {
  try {
    const data: unknown = JSON.parse(stdout);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    const record = data as Record<string, unknown>;
    // Exit 6 is specific to refused or unverified actions, never a confirmed state.
    const snapshot = parseStatus(stdout, exitCode === 6 ? 2 : exitCode, media);
    if (snapshot.reason === "invalid_cli_response" || record.action !== "toggle" ||
        typeof record.success !== "boolean" || record.success !== (exitCode === 0) ||
        (record.success && record.focus_unchanged !== true)) throw new Error();
    return { success: record.success, snapshot };
  } catch {
    return { success: false, snapshot: { status: "unknown", reason: "invalid_cli_response" } };
  }
}

export function parseCallEnd(stdout: string, exitCode: number): ActionResult {
  try {
    const data: unknown = JSON.parse(stdout);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    const record = data as Record<string, unknown>;
    const allowed = exitCode === 0 ? ["ended"] : exitStates[exitCode === 6 ? 2 : exitCode];
    if (typeof record.call !== "string" || !allowed?.includes(record.call) ||
        record.action !== "end" || typeof record.success !== "boolean" || record.success !== (exitCode === 0) ||
        (record.reason !== undefined && typeof record.reason !== "string") ||
        (record.success && (record.changed !== true || record.action_attempted !== true))) throw new Error();
    // Call end permits focus changes caused by closing the Teams call window.
    return { success: record.success, snapshot: { status: record.call as Status, reason: record.reason as string | undefined } };
  } catch {
    return { success: false, snapshot: { status: "unknown", reason: "invalid_cli_response" } };
  }
}

export function presentation(snapshot: Snapshot, media: Control = "mic"): { label: string; color: string; detail: string } {
  const control = media === "mic" ? "microphone" : media;
  switch (snapshot.status) {
    case "muted": return { label: "MUTED", color: "#f07178", detail: "Teams reports the microphone muted." };
    case "unmuted": return { label: "LIVE", color: "#62d6ac", detail: "Teams reports the microphone unmuted." };
    case "on": return { label: "ON", color: "#62d6ac", detail: "Teams reports the camera on." };
    case "off": return { label: "OFF", color: "#f07178", detail: "Teams reports the camera off." };
    case "raised": return { label: "RAISED", color: "#62d6ac", detail: "Teams reports your hand raised. Press to lower it." };
    case "lowered": return { label: "LOWERED", color: "#8b98a9", detail: "Teams reports your hand lowered. Press to raise it." };
    case "ready": return { label: "END CALL", color: "#f07178", detail: "Press to leave your active Teams call." };
    case "ending": return { label: "ENDING", color: "#8b98a9", detail: "Leaving your call… Additional presses are ignored until this finishes." };
    case "ended": return { label: "ENDED", color: "#62d6ac", detail: "The CLI confirmed that you left the call." };
    case "not_running": return { label: "TEAMS OFF", color: "#8b98a9", detail: "Microsoft Teams is not running." };
    case "permission_denied": return { label: "ACCESS", color: "#f5c56b", detail: "Enable Accessibility for Stream Deck in System Settings → Privacy & Security → Accessibility. If macOS attributes access to the teams executable, authorize that executable instead, then retry." };
    case "ambiguous": return { label: "MULTIPLE", color: "#f5c56b", detail: `Teams exposes multiple possible calls or conflicting ${control} controls.` };
    case "setup": return { label: "SETUP", color: "#f5c56b", detail: "Choose an existing, executable teams-cli binary using its absolute path." };
    case "checking": return { label: "CHECKING", color: "#8b98a9", detail: `Reading ${control} status…` };
    case "toggling": return { label: "TOGGLING", color: "#8b98a9", detail: `Changing ${control} status… Additional presses are ignored until this finishes.` };
    case "stale": return { label: "UNKNOWN", color: "#f5c56b", detail: "The last observation has expired. Waiting for a fresh read." };
    default: return { label: "UNKNOWN", color: "#f5c56b", detail: snapshot.reason === "all_calls_on_hold" ? "All detected calls are on hold." : media === "call" ? "The call-end command was not confirmed. Check Teams before pressing again." : `Teams ${control} status is unavailable. Missing controls do not prove the ${control} is ${media === "mic" ? "muted" : media === "hand" ? "lowered" : "off"} or that no call exists.` };
  }
}

export function renderSvg(snapshot: Snapshot, media: Control = "mic"): string {
  const { color, label } = presentation(snapshot, media);
  const showControl = media === "call" || ["muted", "unmuted", "on", "off", "raised", "lowered", "unknown", "stale", "toggling"].includes(snapshot.status);
  const mic = '<rect x="58" y="25" width="28" height="49" rx="14"/><path d="M46 60v7a26 26 0 0 0 52 0v-7M72 93v15M57 108h30"/>';
  const camera = '<rect x="30" y="42" width="55" height="50" rx="8"/><path d="M85 57l29-16v52L85 77z"/>';
  const hand = '<path d="M47 70V42a7 7 0 0 1 14 0v21-35a7 7 0 0 1 14 0v35-31a7 7 0 0 1 14 0v34-21a7 7 0 0 1 14 0v34c0 20-11 31-28 31-12 0-19-5-26-14L32 75a7 7 0 0 1 10-10l12 14"/>';
  const handset = '<path d="M29 61Q72 27 115 61v20q0 5-5 5H94q-5 0-5-5V67q-17-9-34 0v14q0 5-5 5H34q-5 0-5-5z"/>';
  const inactive = snapshot.status === "muted" || snapshot.status === "off";
  const symbol = showControl ? (media === "mic" ? mic : media === "camera" ? camera : media === "hand" ? hand : handset) + (inactive ? '<path d="M39 28l66 76" stroke="#151c28" stroke-width="12"/><path d="M39 28l66 76"/>' : "") : '<circle cx="72" cy="61" r="34"/><path d="M61 49a12 12 0 1 1 18 11c-7 4-7 7-7 12M72 83v1"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="18" fill="#151c28"/><g fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${symbol}</g><text x="72" y="133" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="17" fill="${color}">${label}</text></svg>`;
}
