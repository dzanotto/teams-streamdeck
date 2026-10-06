import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findHomebrewCli, resolveCliPath, LEGACY_CLI_PATH, HOMEBREW_CLI_PATHS } from "../src/cli-path.ts";

test("discovery keeps the stable executable symlink across Homebrew upgrades", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-cli-discovery-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stable = join(dir, "teams-cli");
  for (const version of ["0.1.1", "0.1.2"]) {
    const binary = join(dir, `teams-cli-${version}`);
    await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await rm(stable, { force: true });
    await symlink(binary, stable);
    assert.equal(findHomebrewCli([stable, binary]), stable);
  }
});

test("discovery skips missing, broken, non-executable, and directory candidates", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "teams-cli-discovery-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const missing = join(dir, "missing"), broken = join(dir, "broken");
  const denied = join(dir, "denied"), folder = join(dir, "folder"), executable = join(dir, "teams-cli");
  await symlink(missing, broken);
  await writeFile(denied, "not executable", { mode: 0o644 });
  await mkdir(folder);
  await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const candidates = [missing, broken, denied, folder, executable];
  assert.equal(findHomebrewCli(candidates), executable);
  await chmod(executable, 0o644);
  assert.equal(findHomebrewCli(candidates), undefined);
});

test("new or empty settings use either detected Homebrew prefix", () => {
  for (const path of HOMEBREW_CLI_PATHS) {
    for (const cliPath of [undefined, "", "  "]) {
      assert.equal(resolveCliPath({ cliPath }, () => path), path);
    }
  }
});

test("only the exact legacy default migrates, and only when Homebrew is available", () => {
  assert.equal(resolveCliPath({ cliPath: LEGACY_CLI_PATH }, () => HOMEBREW_CLI_PATHS[0]), HOMEBREW_CLI_PATHS[0]);
  assert.equal(resolveCliPath({ cliPath: LEGACY_CLI_PATH }, () => undefined), LEGACY_CLI_PATH);
  assert.equal(resolveCliPath({ cliPath: "/other/teams-cli/.build/release/teams" }, () => HOMEBREW_CLI_PATHS[0]), "/other/teams-cli/.build/release/teams");
});

test("custom paths take precedence even when missing, and manual legacy paths stay selectable", () => {
  const unexpectedDiscovery = () => { throw new Error("Custom settings must not probe Homebrew"); };
  assert.equal(resolveCliPath({ cliPath: " /custom path/teams-cli " }, unexpectedDiscovery), "/custom path/teams-cli");
  assert.equal(resolveCliPath({ cliPath: "/missing/teams-cli" }, unexpectedDiscovery), "/missing/teams-cli");
  assert.equal(resolveCliPath({ cliPath: "relative" }, unexpectedDiscovery), "relative");
  assert.equal(resolveCliPath({ cliPath: LEGACY_CLI_PATH, cliPathManual: true }, unexpectedDiscovery), LEGACY_CLI_PATH);
});

test("without Homebrew a new key gets the native platform's conventional path", () => {
  assert.equal(resolveCliPath({}, () => undefined), process.arch === "arm64" ? "/opt/homebrew/bin/teams-cli" : "/usr/local/bin/teams-cli");
});
