import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { parseStatus, type Snapshot } from "./status.ts";

// This adapter intentionally has no operation argument: it can only read status.
export function readMicrophone(cliPath: string, timeoutMs = 12_000): Promise<Snapshot> {
  if (!isAbsolute(cliPath)) return Promise.resolve({ status: "setup", reason: "absolute_path_required" });
  return new Promise((resolve) => {
    execFile(cliPath, ["mic", "status", "--json"], {
      encoding: "utf8", timeout: timeoutMs, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      shell: false
    }, (error, stdout) => {
      if (error?.code === "ENOENT" || error?.code === "EACCES") {
        resolve({ status: "setup", reason: error.code === "ENOENT" ? "executable_missing" : "executable_not_allowed" });
      } else if (error?.killed || error?.signal) {
        resolve({ status: "unknown", reason: "command_terminated" });
      } else if (error && typeof error.code !== "number") {
        resolve({ status: "unknown", reason: "command_failed" });
      } else {
        resolve(parseStatus(stdout, typeof error?.code === "number" ? error.code : 0));
      }
    });
  });
}
