import { spawnSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const usage = "Usage: npm run release -- <patch|minor|major|X.Y.Z|vX.Y.Z> [--dry-run]";
const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const files = ["package.json", "package-lock.json", "com.dario.teams-cli.sdPlugin/manifest.json"];
const checker = fileURLToPath(new URL("./check-release.mjs", import.meta.url));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout || result.signal}`);
  }
  return result.stdout.trim();
}

function git(...args) {
  return run("git", args);
}

function requireCleanTree() {
  if (git("status", "--porcelain", "--untracked-files=all")) {
    throw new Error("Commit or remove pending changes, including untracked files, before releasing.");
  }
}

function nextVersion(current, requested) {
  if (!stableVersion.test(current)) throw new Error(`Invalid current package version: ${current}`);
  const parts = current.split(".").map(BigInt);
  const bump = ["major", "minor", "patch"].indexOf(requested);
  let version = requested.replace(/^v/, "");
  if (bump !== -1) {
    parts[bump] += 1n;
    for (let index = bump + 1; index < parts.length; index++) parts[index] = 0n;
    version = parts.join(".");
  }
  if (!stableVersion.test(version)) throw new Error(usage);
  const previous = current.split(".").map(BigInt);
  const next = version.split(".").map(BigInt);
  const different = next.findIndex((part, index) => part !== previous[index]);
  if (different === -1 || next[different] < previous[different]) {
    throw new Error(`Release version ${version} must be newer than ${current}.`);
  }
  return version;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log(usage);
    return;
  }
  const requested = args.filter((arg) => arg !== "--dry-run");
  if (requested.length !== 1 || args.length > 2) throw new Error(usage);
  const dryRun = args.includes("--dry-run");
  const metadata = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const [pkg, lock, manifest] = metadata;
  const version = nextVersion(pkg.version, requested[0]);
  const tag = `v${version}`;

  if (await realpath(process.cwd()) !== await realpath(git("rev-parse", "--show-toplevel"))) {
    throw new Error("Run the release script from the repository root.");
  }
  if (git("symbolic-ref", "--quiet", "--short", "HEAD") !== "main") {
    throw new Error("Switch to main before releasing.");
  }
  requireCleanTree();
  git("ls-files", "--error-unmatch", "--", ...files);
  run(process.execPath, [checker, `v${pkg.version}`]);
  if (git("tag", "--list", tag)) throw new Error(`Tag ${tag} already exists locally.`);

  // Check the actual push destination, including configurations with a separate push URL.
  const destinations = git("remote", "get-url", "--push", "--all", "origin").split("\n");
  if (destinations.length !== 1) throw new Error("origin must have exactly one push URL.");
  const refs = git("ls-remote", "--refs", destinations[0], "refs/heads/main", `refs/tags/${tag}`)
    .split("\n").filter(Boolean).map((line) => line.split(/\s+/));
  if (refs.some(([, ref]) => ref === `refs/tags/${tag}`)) {
    throw new Error(`Tag ${tag} already exists on origin.`);
  }
  const remoteHead = refs.find(([, ref]) => ref === "refs/heads/main")?.[0];
  if (!remoteHead) throw new Error("origin must already contain a main branch.");
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", remoteHead, "HEAD"], { encoding: "utf8" });
  if (ancestor.error) throw ancestor.error;
  if (ancestor.status !== 0) {
    throw new Error("Local main does not include origin's main. Fetch and integrate remote changes before releasing.");
  }

  const pushArgs = ["-c", "push.followTags=false", "push", "--atomic", "origin",
    "refs/heads/main:refs/heads/main", `refs/tags/${tag}:refs/tags/${tag}`];
  console.log(`${dryRun ? "Would release" : "Releasing"} ${pkg.version} -> ${version}`);
  console.log(`Update ${files.join(", ")} (manifest Version: ${version}.0).`);
  console.log(`Commit and annotate ${tag}, then push main and ${tag} atomically to origin.`);
  if (dryRun) {
    console.log("Dry run complete; no files, commits, tags, or remote refs changed.");
    return;
  }

  pkg.version = version;
  lock.version = version;
  lock.packages[""].version = version;
  manifest.Version = `${version}.0`;
  for (let index = 0; index < files.length; index++) {
    await writeFile(files[index], `${JSON.stringify(metadata[index], null, 2)}\n`);
  }
  console.log(run(process.execPath, [checker, tag]));
  git("diff", "--check");
  git("add", "--", ...files);
  git("commit", "--only", "-m", `Release ${tag}`, "--", ...files);
  // Hooks must not leave changes or alter the checked version before tagging.
  requireCleanTree();
  run(process.execPath, [checker, tag]);
  git("tag", "-a", tag, "-m", `Release ${tag}`);
  try {
    git(...pushArgs);
  } catch (error) {
    throw new Error(`${error.message}\nLocal release commit and ${tag} were retained. Inspect the remote refs before retrying:\ngit ${pushArgs.join(" ")}\nDo not bump again or move an existing release tag.`);
  }
  console.log(`Pushed ${tag} (${git("rev-parse", "--short", "HEAD")}) and main. Check the GitHub Release workflow for publication status.`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
