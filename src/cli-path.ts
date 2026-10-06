import { accessSync, constants, statSync } from "node:fs";

export type CliSettings = { cliPath?: string; cliPathManual?: boolean };

// Only this exact default from the original package is eligible for migration.
export const LEGACY_CLI_PATH = "/path/to/teams-cli/.build/release/teams";
export const HOMEBREW_CLI_PATHS = ["/opt/homebrew/bin/teams-cli", "/usr/local/bin/teams-cli"] as const;

export function findHomebrewCli(candidates: readonly string[] = HOMEBREW_CLI_PATHS): string | undefined {
  return candidates.find((path) => {
    try {
      if (!statSync(path).isFile()) return false;
      accessSync(path, constants.X_OK);
      // Keep the stable symlink, not its versioned Cellar target.
      return true;
    } catch { return false; }
  });
}

export function resolveCliPath(settings: CliSettings, discover = findHomebrewCli): string {
  const configured = typeof settings.cliPath === "string" ? settings.cliPath.trim() : "";
  if (configured && (configured !== LEGACY_CLI_PATH || settings.cliPathManual === true)) return configured;
  // Preserve a working legacy installation when Homebrew is not installed yet.
  // New keys get a conventional path and SETUP feedback if the binary is missing.
  return discover() ?? (configured || HOMEBREW_CLI_PATHS[process.arch === "arm64" ? 0 : 1]);
}
