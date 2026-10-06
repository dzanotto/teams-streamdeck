import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { parseStatus, parseToggle, parseCallEnd, type Media, type Snapshot, type ActionResult } from "./status.ts";
import type { PressTiming } from "./timing.ts";

export async function readMedia(cliPath: string, media: Media, timeoutMs = 12_000, signal?: AbortSignal, timing?: PressTiming): Promise<Snapshot> {
  const result = await runCommand(cliPath, [media, "status", "--json"], timeoutMs, signal, timing);
  return "failure" in result ? result.failure : parseStatus(result.stdout, result.exitCode, media);
}

export async function toggleMedia(cliPath: string, media: Media, timeoutMs = 20_000, timing?: PressTiming): Promise<ActionResult> {
  const result = await runCommand(cliPath, [media, "toggle", "--json"], timeoutMs, undefined, timing);
  return "failure" in result ? { success: false, snapshot: result.failure } : parseToggle(result.stdout, result.exitCode, media);
}

export async function endCall(cliPath: string, timeoutMs = 20_000, timing?: PressTiming): Promise<ActionResult> {
  const result = await runCommand(cliPath, ["call", "end", "--json"], timeoutMs, undefined, timing);
  return "failure" in result ? { success: false, snapshot: result.failure } : parseCallEnd(result.stdout, result.exitCode);
}

type Command = [Media, "status" | "toggle", "--json"] | ["call", "end", "--json"];
type CommandResult = { stdout: string; exitCode: number } | { failure: Snapshot };

function runCommand(cliPath: string, args: Command, timeoutMs: number, signal?: AbortSignal, timing?: PressTiming): Promise<CommandResult> {
  const canceled: CommandResult = { failure: { status: "unknown", reason: "command_canceled" } };
  if (signal?.aborted) return Promise.resolve(canceled);
  if (!isAbsolute(cliPath)) return Promise.resolve({ failure: { status: "setup", reason: "absolute_path_required" } });
  return new Promise((resolve) => {
    let result: CommandResult = { failure: { status: "unknown", reason: "command_failed" } };
    let cancellationRequested = false;
    const finishTiming = timing?.beginCommand(args.join(" "));
    const child = execFile(cliPath, args, {
      encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      shell: false
    }, (error, stdout) => {
      if (error?.code === "ENOENT" || error?.code === "EACCES") {
        result = { failure: { status: "setup", reason: error.code === "ENOENT" ? "executable_missing" : "executable_not_allowed" } };
      } else if (error?.killed || error?.signal) {
        result = { failure: { status: "unknown", reason: "command_terminated" } };
      } else if (error && typeof error.code !== "number") {
        result = { failure: { status: "unknown", reason: "command_failed" } };
      } else {
        result = { stdout, exitCode: typeof error?.code === "number" ? error.code : 0 };
      }
    });
    const cancel = () => {
      cancellationRequested = true;
      child.kill("SIGKILL");
    };
    // An abort notification alone does not prove that the process has exited.
    // Settle only after close, so the action cannot overlap the canceled read.
    child.once("close", () => {
      signal?.removeEventListener("abort", cancel);
      finishTiming?.();
      resolve(cancellationRequested ? canceled : result);
    });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
}
