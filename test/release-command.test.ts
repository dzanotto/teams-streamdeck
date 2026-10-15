import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve("scripts/release.mjs");
const files = ["package.json", "package-lock.json", "com.dario.teams-cli.sdPlugin/manifest.json"];
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };

function git(dir: string, ...args: string[]) {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
  assert.equal(result.status, 0, result.stderr || result.error?.message || "git failed");
  return result.stdout.trim();
}

function release(dir: string, ...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", env });
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "teams-streamdeck-release-command-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "checkout with spaces");
  const remote = join(root, "origin.git");
  await mkdir(join(dir, "com.dario.teams-cli.sdPlugin"), { recursive: true });
  const metadata = [
    { name: "test-plugin", version: "1.2.3", private: true },
    { version: "1.2.3", lockfileVersion: 3, packages: { "": { version: "1.2.3" }, "node_modules/example": { version: "1.2.3", integrity: "unchanged" } } },
    { UUID: "test.plugin", Version: "1.2.3.0", Nodejs: { Version: "24" } }
  ];
  for (let index = 0; index < files.length; index++) {
    await writeFile(join(dir, files[index]), `${JSON.stringify(metadata[index], null, 2)}\n`);
  }
  git(dir, "init", "--initial-branch=main");
  git(dir, "config", "user.name", "Release Test");
  git(dir, "config", "user.email", "release@example.invalid");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "Initial version");
  git(dir, "init", "--bare", "--initial-branch=main", remote);
  git(dir, "remote", "add", "origin", remote);
  git(dir, "push", "-u", "origin", "main");
  return { root, dir, remote, initial: git(dir, "rev-parse", "HEAD") };
}

async function snapshot(dir: string, remote: string) {
  return {
    contents: await Promise.all(files.map((file) => readFile(join(dir, file), "utf8"))),
    status: git(dir, "status", "--porcelain", "--untracked-files=all"),
    refs: git(dir, "show-ref"),
    remoteRefs: git(remote, "show-ref")
  };
}

test("release command updates all versions, commits, annotates, and pushes only main and its tag", async (t) => {
  for (const [argument, version] of [["patch", "1.2.4"], ["minor", "1.3.0"], ["major", "2.0.0"], ["1.10.0", "1.10.0"], ["v2.3.4", "2.3.4"]]) {
    const { dir, remote } = await fixture(t);
    git(dir, "tag", "-a", "unrelated", "-m", "Do not publish");
    git(dir, "config", "push.followTags", "true");
    const result = release(dir, argument);
    assert.equal(result.status, 0, result.stderr);
    const [pkg, lock, manifest] = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(dir, file), "utf8"))));
    assert.deepEqual(pkg, { name: "test-plugin", version, private: true });
    assert.deepEqual(lock, { version, lockfileVersion: 3, packages: { "": { version }, "node_modules/example": { version: "1.2.3", integrity: "unchanged" } } });
    assert.deepEqual(manifest, { UUID: "test.plugin", Version: `${version}.0`, Nodejs: { Version: "24" } });
    const tag = `v${version}`;
    const commit = git(dir, "rev-parse", "HEAD");
    assert.equal(git(dir, "log", "-1", "--format=%s"), `Release ${tag}`);
    assert.deepEqual(git(dir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split("\n").sort(), [...files].sort());
    assert.equal(git(dir, "cat-file", "-t", tag), "tag");
    assert.equal(git(dir, "rev-parse", `${tag}^{}`), commit);
    assert.equal(git(remote, "rev-parse", "refs/heads/main"), commit);
    assert.equal(git(remote, "rev-parse", `refs/tags/${tag}^{}`), commit);
    assert.equal(git(remote, "tag", "--list"), tag);
    assert.equal(git(dir, "status", "--porcelain"), "");
  }
});

test("release dry run previews the change without altering files or local and remote refs", async (t) => {
  const { dir, remote } = await fixture(t);
  const before = await snapshot(dir, remote);
  for (const args of [["minor", "--dry-run"], ["--dry-run", "major"]]) {
    const result = release(dir, ...args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Would release 1\.2\.3 ->/);
    assert.deepEqual(await snapshot(dir, remote), before);
  }
});

test("release command rejects invalid, repeated, and lower versions without changes", async (t) => {
  const { dir, remote } = await fixture(t);
  const before = await snapshot(dir, remote);
  for (const args of [[], ["--dry-run"], ["patch", "extra"], ["patch", "--dry-run", "--dry-run"], ["--force"], ["v01.2.4"], ["1.2"], ["1.2.4-beta"], ["1.2.4+build"], ["1.2.4.0"], ["1.2.3"], ["1.2.2"], ["0.10.0"]]) {
    const result = release(dir, ...args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /Usage:|must be newer/);
    assert.deepEqual(await snapshot(dir, remote), before);
  }
  assert.equal(release(dir, "--help").status, 0);
});

test("release command refuses unstaged, staged, and untracked changes", async (t) => {
  for (const state of ["unstaged", "staged", "untracked"]) {
    const { dir, remote } = await fixture(t);
    await writeFile(join(dir, state === "untracked" ? "notes.txt" : "package.json"), '{"version":"1.2.3"}\n');
    if (state === "staged") git(dir, "add", "package.json");
    const before = await snapshot(dir, remote);
    const result = release(dir, "patch");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pending changes/);
    assert.deepEqual(await snapshot(dir, remote), before);
  }
});

test("release command refuses other branches and detached HEAD", async (t) => {
  for (const args of [["switch", "-c", "topic"], ["checkout", "--detach"]]) {
    const { dir, remote } = await fixture(t);
    git(dir, ...args);
    const before = await snapshot(dir, remote);
    assert.equal(release(dir, "patch").status, 1);
    assert.deepEqual(await snapshot(dir, remote), before);
  }
});

test("release command refuses existing local and remote tags even during a dry run", async (t) => {
  for (const location of ["local", "remote"]) {
    const { dir, remote } = await fixture(t);
    git(dir, "tag", "v1.2.4");
    if (location === "remote") {
      git(dir, "push", "origin", "refs/tags/v1.2.4");
      git(dir, "tag", "-d", "v1.2.4");
    }
    const before = await snapshot(dir, remote);
    const result = release(dir, "patch", "--dry-run");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already exists/);
    assert.deepEqual(await snapshot(dir, remote), before);
  }
});

test("release command refuses missing or divergent remote history before editing", async (t) => {
  const { root, dir, remote } = await fixture(t);
  const other = join(root, "other");
  git(root, "clone", remote, other);
  git(other, "config", "user.name", "Other Test");
  git(other, "config", "user.email", "other@example.invalid");
  await writeFile(join(other, "remote.txt"), "Remote work\n");
  git(other, "add", ".");
  git(other, "commit", "-m", "Advance remote");
  git(other, "push", "origin", "main");
  for (const state of ["unknown", "behind", "diverged"]) {
    if (state === "behind") git(dir, "fetch", "origin");
    if (state === "diverged") {
      await writeFile(join(dir, "local.txt"), "Local work\n");
      git(dir, "add", ".");
      git(dir, "commit", "-m", "Advance local");
    }
    const before = await snapshot(dir, remote);
    const result = release(dir, "patch");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Fetch and integrate/);
    assert.deepEqual(await snapshot(dir, remote), before);
  }
});

test("release command checks the configured push destination and refuses multiple destinations", async (t) => {
  const { root, dir, remote } = await fixture(t);
  const pushRemote = join(root, "push.git");
  git(dir, "init", "--bare", "--initial-branch=main", pushRemote);
  git(dir, "push", pushRemote, "main");
  git(pushRemote, "tag", "v1.2.4");
  git(dir, "remote", "set-url", "--push", "origin", pushRemote);
  const before = await snapshot(dir, remote);
  const duplicate = release(dir, "patch");
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /already exists on origin/);
  git(dir, "remote", "set-url", "--add", "--push", "origin", remote);
  const multiple = release(dir, "patch");
  assert.equal(multiple.status, 1);
  assert.match(multiple.stderr, /exactly one push URL/);
  assert.deepEqual(await snapshot(dir, remote), before);
});

test("release command refuses inconsistent current metadata before editing", async (t) => {
  const { dir, remote } = await fixture(t);
  await writeFile(join(dir, files[2]), '{"Version":"1.2.2.0"}\n');
  git(dir, "add", ".");
  git(dir, "commit", "-m", "Mismatched manifest");
  const before = await snapshot(dir, remote);
  const result = release(dir, "patch");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /manifest.json Version: expected 1\.2\.3\.0/);
  assert.deepEqual(await snapshot(dir, remote), before);
});

test("a rejected atomic push retains the local release and leaves both remote refs unchanged", async (t) => {
  const { dir, remote, initial } = await fixture(t);
  const hook = join(remote, "hooks/update");
  await writeFile(hook, '#!/bin/sh\ncase "$1" in refs/tags/*) exit 1 ;; esac\n');
  await chmod(hook, 0o755);
  const result = release(dir, "patch");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Local release commit and v1\.2\.4 were retained/);
  assert.match(result.stderr, /git -c push.followTags=false push --atomic origin refs\/heads\/main:refs\/heads\/main refs\/tags\/v1\.2\.4:refs\/tags\/v1\.2\.4/);
  assert.notEqual(git(dir, "rev-parse", "HEAD"), initial);
  assert.equal(git(dir, "rev-parse", "v1.2.4^{}"), git(dir, "rev-parse", "HEAD"));
  assert.equal(git(dir, "status", "--porcelain"), "");
  assert.equal(git(remote, "rev-parse", "refs/heads/main"), initial);
  assert.equal(git(remote, "tag", "--list"), "");
  await rm(hook);
  git(dir, "-c", "push.followTags=false", "push", "--atomic", "origin", "refs/heads/main:refs/heads/main", "refs/tags/v1.2.4:refs/tags/v1.2.4");
  assert.equal(git(remote, "rev-parse", "v1.2.4^{}"), git(remote, "rev-parse", "refs/heads/main"));
});

test("release command never falls back when the remote does not support atomic pushes", async (t) => {
  const { dir, remote, initial } = await fixture(t);
  git(remote, "config", "receive.advertiseAtomic", "false");
  const result = release(dir, "patch");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not support --atomic push/);
  assert.equal(git(remote, "rev-parse", "refs/heads/main"), initial);
  assert.equal(git(remote, "tag", "--list"), "");
});

test("a failed release commit leaves edits for inspection without creating or pushing a tag", async (t) => {
  const { dir, remote, initial } = await fixture(t);
  const hook = join(dir, ".git/hooks/pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  const result = release(dir, "patch");
  assert.equal(result.status, 1);
  assert.equal(git(dir, "rev-parse", "HEAD"), initial);
  assert.equal(git(dir, "tag", "--list"), "");
  assert.equal(git(remote, "rev-parse", "refs/heads/main"), initial);
  assert.equal(git(remote, "tag", "--list"), "");
  assert.equal(JSON.parse(await readFile(join(dir, "package.json"), "utf8")).version, "1.2.4");
});
