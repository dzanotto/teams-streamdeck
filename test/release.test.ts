import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const checker = resolve("scripts/check-release.mjs");
const publisher = resolve("scripts/publish-release.sh");

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "teams-streamdeck-release-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function versions(dir: string, values = ["1.2.3", "1.2.3", "1.2.3", "1.2.3.0"]) {
  await mkdir(join(dir, "com.dario.teams-cli.sdPlugin"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ version: values[0] }));
  await writeFile(join(dir, "package-lock.json"), JSON.stringify({ version: values[1], packages: { "": { version: values[2] } } }));
  await writeFile(join(dir, "com.dario.teams-cli.sdPlugin/manifest.json"), JSON.stringify({ Version: values[3] }));
}

test("release checks accept matching stable versions", async (t) => {
  const dir = await fixture(t);
  for (const version of ["0.1.0", "1.2.3", "10.20.30"]) {
    await versions(dir, [version, version, version, `${version}.0`]);
    const result = spawnSync(process.execPath, [checker, `v${version}`], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("release checks reject malformed tags and extra arguments", async (t) => {
  const dir = await fixture(t);
  await versions(dir);
  for (const args of [[], ["1.2.3"], ["v1.2"], ["v01.2.3"], ["v1.02.3"], ["v1.2.03"], ["v1.2.3-beta.1"], ["v1.2.3+build"], ["v1.2.3.0"], ["v1.2.3", "extra"]]) {
    const result = spawnSync(process.execPath, [checker, ...args], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Expected one stable version tag/);
  }
});

test("release checks reject each version mismatch and unreadable metadata", async (t) => {
  const dir = await fixture(t);
  for (let index = 0; index < 4; index++) {
    const values = ["1.2.3", "1.2.3", "1.2.3", "1.2.3.0"];
    values[index] = index === 3 ? "1.2.3.1" : "1.2.4";
    await versions(dir, values);
    const result = spawnSync(process.execPath, [checker, "v1.2.3"], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected 1\.2\.3/);
  }
  await writeFile(join(dir, "package.json"), "invalid json");
  assert.equal(spawnSync(process.execPath, [checker, "v1.2.3"], { cwd: dir }).status, 1);
  await rm(join(dir, "package.json"));
  assert.equal(spawnSync(process.execPath, [checker, "v1.2.3"], { cwd: dir }).status, 1);
});

async function publish(t: TestContext, scenario: string) {
  const dir = await fixture(t);
  for (const folder of ["bin", "dist", "docs"]) await mkdir(join(dir, folder));
  await writeFile(join(dir, "dist/com.dario.teams-cli.streamDeckPlugin"), "tested installer");
  await writeFile(join(dir, "docs/release-notes.md"), "Requirements and known limitations.\n");
  const log = join(dir, "commands.jsonl");
  await writeFile(log, "");
  const gh = join(dir, "bin/gh");
  await writeFile(gh, `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const calls = fs.readFileSync(process.env.RELEASE_TEST_LOG, "utf8");
fs.appendFileSync(process.env.RELEASE_TEST_LOG, JSON.stringify(args) + "\\n");
const scenario = process.env.RELEASE_TEST_SCENARIO;
if (args[0] === "api") {
  if (args.some(arg => arg.includes("/releases?"))) {
    if (scenario === "api-failure") process.exit(1);
    console.log(scenario === "existing-release" ? "v1.2.3" : "v1.2.2");
  } else if (args.some(arg => arg.includes("/commits/"))) {
    const moved = scenario === "moved-tag" || (scenario === "moved-after-upload" && calls.includes('"create"'));
    console.log(moved ? "different-commit" : process.env.EXPECTED_COMMIT);
  } else process.exit(2);
} else if (args[0] === "release" && args[1] === "create") {
  if (scenario === "upload-failure") process.exit(1);
} else if (args[0] === "release" && args[1] === "edit") {
  if (scenario === "publish-failure") process.exit(1);
} else process.exit(2);
`);
  await chmod(gh, 0o755);
  if (scenario === "missing-installer") await rm(join(dir, "dist/com.dario.teams-cli.streamDeckPlugin"));
  const result = spawnSync("bash", [publisher], {
    cwd: dir, encoding: "utf8",
    env: {
      ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      RELEASE_TAG: "v1.2.3", EXPECTED_COMMIT: "a".repeat(40), GH_REPO: "example/test",
      GH_TOKEN: "test-only", RELEASE_TEST_LOG: log, RELEASE_TEST_SCENARIO: scenario
    }
  });
  const calls = (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
  return { result, calls, dir };
}

test("release publishing uploads an installer and checksum as a draft before publishing", async (t) => {
  const { result, calls, dir } = await publish(t, "success");
  assert.equal(result.status, 0, result.stderr);
  const create = calls.findIndex((args) => args[0] === "release" && args[1] === "create");
  assert.deepEqual(calls[create], ["release", "create", "v1.2.3", "dist/com.dario.teams-cli.streamDeckPlugin", "dist/SHA256SUMS", "--verify-tag", "--draft", "--title", "v1.2.3", "--notes-file", "docs/release-notes.md", "--generate-notes"]);
  assert.ok(calls[create - 1].some((arg) => arg.includes("/commits/")));
  assert.ok(calls[create + 1].some((arg) => arg.includes("/commits/")));
  assert.deepEqual(calls.at(-1), ["release", "edit", "v1.2.3", "--draft=false"]);
  const hash = createHash("sha256").update("tested installer").digest("hex");
  assert.equal(await readFile(join(dir, "dist/SHA256SUMS"), "utf8"), `${hash}  com.dario.teams-cli.streamDeckPlugin\n`);
});

test("release publishing stops on missing assets, API errors, duplicate releases, moved tags, or failed uploads", async (t) => {
  for (const scenario of ["missing-installer", "api-failure", "existing-release", "moved-tag", "upload-failure", "moved-after-upload"]) {
    const { result, calls } = await publish(t, scenario);
    assert.equal(result.status, 1, scenario);
    assert.ok(!calls.some((args) => args[0] === "release" && args[1] === "edit"), scenario);
    if (!["upload-failure", "moved-after-upload"].includes(scenario)) {
      assert.ok(!calls.some((args) => args[0] === "release" && args[1] === "create"), scenario);
    }
  }
});

test("release publishing reports a failed publish without retrying", async (t) => {
  const { result, calls } = await publish(t, "publish-failure");
  assert.equal(result.status, 1);
  assert.equal(calls.filter((args) => args[0] === "release" && args[1] === "create").length, 1);
  assert.equal(calls.filter((args) => args[0] === "release" && args[1] === "edit").length, 1);
});
