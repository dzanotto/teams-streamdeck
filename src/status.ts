export type Status = "muted" | "unmuted" | "unknown" | "ambiguous" |
  "permission_denied" | "not_running" | "setup" | "checking" | "stale";

export type Snapshot = { status: Status; reason?: string };

const exitStates: Record<number, readonly string[]> = {
  0: ["muted", "unmuted"], 2: ["unknown", "ambiguous"],
  3: ["permission_denied"], 4: ["not_running"], 5: ["unknown"]
};

export function parseStatus(stdout: string, exitCode: number): Snapshot {
  try {
    const data: unknown = JSON.parse(stdout);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    const record = data as Record<string, unknown>;
    if (typeof record.microphone !== "string" ||
        !exitStates[exitCode]?.includes(record.microphone) ||
        (record.reason !== undefined && typeof record.reason !== "string")) throw new Error();
    return { status: record.microphone as Status, reason: record.reason as string | undefined };
  } catch {
    return { status: "unknown", reason: "invalid_cli_response" };
  }
}

export function presentation(snapshot: Snapshot): { label: string; color: string; detail: string } {
  switch (snapshot.status) {
    case "muted": return { label: "MUTED", color: "#f07178", detail: "Teams reports the microphone muted." };
    case "unmuted": return { label: "LIVE", color: "#62d6ac", detail: "Teams reports the microphone unmuted." };
    case "not_running": return { label: "TEAMS OFF", color: "#8b98a9", detail: "Microsoft Teams is not running." };
    case "permission_denied": return { label: "ACCESS", color: "#f5c56b", detail: "Enable Accessibility for Stream Deck in System Settings → Privacy & Security → Accessibility. If macOS attributes access to the teams executable, authorize that executable instead, then retry." };
    case "ambiguous": return { label: "MULTIPLE", color: "#f5c56b", detail: "Teams exposes multiple possible calls or conflicting microphone controls." };
    case "setup": return { label: "SETUP", color: "#f5c56b", detail: "Choose an existing, executable teams-cli binary using its absolute path." };
    case "checking": return { label: "CHECKING", color: "#8b98a9", detail: "Reading microphone status…" };
    case "stale": return { label: "UNKNOWN", color: "#f5c56b", detail: "The last observation has expired. Waiting for a fresh read." };
    default: return { label: "UNKNOWN", color: "#f5c56b", detail: snapshot.reason === "all_calls_on_hold" ? "All detected calls are on hold." : "Teams microphone status is unavailable. Missing controls do not prove the microphone is muted or that no call exists." };
  }
}

export function renderSvg(snapshot: Snapshot): string {
  const { color, label } = presentation(snapshot);
  const showMicrophone = snapshot.status === "muted" || snapshot.status === "unmuted" || snapshot.status === "unknown" || snapshot.status === "stale";
  const mic = '<rect x="58" y="25" width="28" height="49" rx="14"/><path d="M46 60v7a26 26 0 0 0 52 0v-7M72 93v15M57 108h30"/>';
  const symbol = showMicrophone ? mic + (snapshot.status === "muted" ? '<path d="M39 28l66 76" stroke="#151c28" stroke-width="12"/><path d="M39 28l66 76"/>' : "") : '<circle cx="72" cy="61" r="34"/><path d="M61 49a12 12 0 1 1 18 11c-7 4-7 7-7 12M72 83v1"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="18" fill="#151c28"/><g fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${symbol}</g><text x="72" y="133" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="17" fill="${color}">${label}</text></svg>`;
}
