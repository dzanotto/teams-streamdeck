export type Media = "mic" | "camera";
export type Status = "muted" | "unmuted" | "on" | "off" | "unknown" | "ambiguous" |
  "permission_denied" | "not_running" | "setup" | "checking" | "stale" | "toggling";

export type Snapshot = { status: Status; reason?: string };
export type ToggleResult = { success: boolean; snapshot: Snapshot };

const exitStates: Record<number, readonly string[]> = {
  2: ["unknown", "ambiguous"],
  3: ["permission_denied"], 4: ["not_running"], 5: ["unknown"]
};

export function parseStatus(stdout: string, exitCode: number, media: Media = "mic"): Snapshot {
  try {
    const data: unknown = JSON.parse(stdout);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    const record = data as Record<string, unknown>;
    const state = record[media === "mic" ? "microphone" : "camera"];
    const allowed = exitCode === 0 ? (media === "mic" ? ["muted", "unmuted"] : ["on", "off"]) : exitStates[exitCode];
    if (typeof state !== "string" ||
        !allowed?.includes(state) ||
        (record.reason !== undefined && typeof record.reason !== "string")) throw new Error();
    return { status: state as Status, reason: record.reason as string | undefined };
  } catch {
    return { status: "unknown", reason: "invalid_cli_response" };
  }
}

export function parseToggle(stdout: string, exitCode: number, media: Media = "mic"): ToggleResult {
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

export function presentation(snapshot: Snapshot, media: Media = "mic"): { label: string; color: string; detail: string } {
  const control = media === "mic" ? "microphone" : "camera";
  switch (snapshot.status) {
    case "muted": return { label: "MUTED", color: "#f07178", detail: "Teams reports the microphone muted." };
    case "unmuted": return { label: "LIVE", color: "#62d6ac", detail: "Teams reports the microphone unmuted." };
    case "on": return { label: "ON", color: "#62d6ac", detail: "Teams reports the camera on." };
    case "off": return { label: "OFF", color: "#f07178", detail: "Teams reports the camera off." };
    case "not_running": return { label: "TEAMS OFF", color: "#8b98a9", detail: "Microsoft Teams is not running." };
    case "permission_denied": return { label: "ACCESS", color: "#f5c56b", detail: "Enable Accessibility for Stream Deck in System Settings → Privacy & Security → Accessibility. If macOS attributes access to the teams executable, authorize that executable instead, then retry." };
    case "ambiguous": return { label: "MULTIPLE", color: "#f5c56b", detail: `Teams exposes multiple possible calls or conflicting ${control} controls.` };
    case "setup": return { label: "SETUP", color: "#f5c56b", detail: "Choose an existing, executable teams-cli binary using its absolute path." };
    case "checking": return { label: "CHECKING", color: "#8b98a9", detail: `Reading ${control} status…` };
    case "toggling": return { label: "TOGGLING", color: "#8b98a9", detail: `Changing ${control} status… Additional presses are ignored until this finishes.` };
    case "stale": return { label: "UNKNOWN", color: "#f5c56b", detail: "The last observation has expired. Waiting for a fresh read." };
    default: return { label: "UNKNOWN", color: "#f5c56b", detail: snapshot.reason === "all_calls_on_hold" ? "All detected calls are on hold." : `Teams ${control} status is unavailable. Missing controls do not prove the ${control} is ${media === "mic" ? "muted" : "off"} or that no call exists.` };
  }
}

export function renderSvg(snapshot: Snapshot, media: Media = "mic"): string {
  const { color, label } = presentation(snapshot, media);
  const showControl = ["muted", "unmuted", "on", "off", "unknown", "stale", "toggling"].includes(snapshot.status);
  const mic = '<rect x="58" y="25" width="28" height="49" rx="14"/><path d="M46 60v7a26 26 0 0 0 52 0v-7M72 93v15M57 108h30"/>';
  const camera = '<rect x="30" y="42" width="55" height="50" rx="8"/><path d="M85 57l29-16v52L85 77z"/>';
  const inactive = snapshot.status === "muted" || snapshot.status === "off";
  const symbol = showControl ? (media === "mic" ? mic : camera) + (inactive ? '<path d="M39 28l66 76" stroke="#151c28" stroke-width="12"/><path d="M39 28l66 76"/>' : "") : '<circle cx="72" cy="61" r="34"/><path d="M61 49a12 12 0 1 1 18 11c-7 4-7 7-7 12M72 83v1"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="18" fill="#151c28"/><g fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${symbol}</g><text x="72" y="133" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="17" fill="${color}">${label}</text></svg>`;
}
