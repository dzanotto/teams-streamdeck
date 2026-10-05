import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { parseStatus, parseToggle, type Snapshot, type ToggleResult } from "./status.ts";

export async function readMicrophone(cliPath: string, timeoutMs = 12_000): Promise<Snapshot> {
  const result = await runMicrophone(cliPath, "status", timeoutMs);
  return "failure" in result ? result.failure : parseStatus(result.stdout, result.exitCode);
}

export async function toggleMicrophone(cliPath: string, timeoutMs = 20_000): Promise<ToggleResult> {
  const result = await runMicrophone(cliPath, "toggle", timeoutMs);
  return "failure" in result ? { success: false, snapshot: result.failure } : parseToggle(result.stdout, result.exitCode);
}

type CommandResult = { stdout: string; exitCode: number } | { failure: Snapshot };

function runMicrophone(cliPath: string, operation: "status" | "toggle", timeoutMs: number): Promise<CommandResult> {
  if (!isAbsolute(cliPath)) return Promise.resolve({ failure: { status: "setup", reason: "absolute_path_required" } });
  return new Promise((resolve) => {
    execFile(cliPath, ["mic", operation, "--json"], {
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
