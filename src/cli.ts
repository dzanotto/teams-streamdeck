import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { parseStatus, parseToggle, parseHandAction, parseCallEnd, type Media, type Snapshot, type ActionResult } from "./status.ts";

export async function readMedia(cliPath: string, media: Media, timeoutMs = 12_000): Promise<Snapshot> {
  const result = await runCommand(cliPath, [media, "status", "--json"], timeoutMs);
  return "failure" in result ? result.failure : parseStatus(result.stdout, result.exitCode, media);
}

export async function toggleMedia(cliPath: string, media: Exclude<Media, "hand">, timeoutMs = 20_000): Promise<ActionResult> {
  const result = await runCommand(cliPath, [media, "toggle", "--json"], timeoutMs);
  return "failure" in result ? { success: false, snapshot: result.failure } : parseToggle(result.stdout, result.exitCode, media);
}

export async function toggleHand(cliPath: string, isCurrent = () => true, timeoutMs = 20_000): Promise<ActionResult | undefined> {
  // The CLI exposes explicit raise/lower commands. Choose from a fresh read,
  // never the displayed state, and let the CLI recheck and verify the target.
  const snapshot = await readMedia(cliPath, "hand", Math.min(timeoutMs, 12_000));
  if (!isCurrent()) return;
  if (snapshot.status !== "raised" && snapshot.status !== "lowered") return { success: false, snapshot };
  const action = snapshot.status === "raised" ? "lower" : "raise";
  const result = await runCommand(cliPath, ["hand", action, "--json"], timeoutMs);
  return "failure" in result ? { success: false, snapshot: result.failure } : parseHandAction(result.stdout, result.exitCode, action);
}

export async function endCall(cliPath: string, timeoutMs = 20_000): Promise<ActionResult> {
  const result = await runCommand(cliPath, ["call", "end", "--json"], timeoutMs);
  return "failure" in result ? { success: false, snapshot: result.failure } : parseCallEnd(result.stdout, result.exitCode);
}

type Command = [Media, "status", "--json"] | [Exclude<Media, "hand">, "toggle", "--json"] |
  ["hand", "raise" | "lower", "--json"] | ["call", "end", "--json"];
type CommandResult = { stdout: string; exitCode: number } | { failure: Snapshot };

function runCommand(cliPath: string, args: Command, timeoutMs: number): Promise<CommandResult> {
  if (!isAbsolute(cliPath)) return Promise.resolve({ failure: { status: "setup", reason: "absolute_path_required" } });
  return new Promise((resolve) => {
    execFile(cliPath, args, {
      encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      shell: false
    }, (error, stdout) => {
      if (error?.code === "ENOENT" || error?.code === "EACCES") {
        resolve({ failure: { status: "setup", reason: error.code === "ENOENT" ? "executable_missing" : "executable_not_allowed" } });
      } else if (error?.killed || error?.signal) {
        resolve({ failure: { status: "unknown", reason: "command_terminated" } });
      } else if (error && typeof error.code !== "number") {
        resolve({ failure: { status: "unknown", reason: "command_failed" } });
      } else {
        resolve({ stdout, exitCode: typeof error?.code === "number" ? error.code : 0 });
      }
    });
  });
}
