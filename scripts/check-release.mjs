import { readFile } from "node:fs/promises";

try {
  const [tag, ...extra] = process.argv.slice(2);
  if (!tag || extra.length || !/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(tag)) {
    throw new Error("Expected one stable version tag such as v0.1.0 (no prerelease, build suffix, or leading zeros).");
  }
  const version = tag.slice(1);
  const [pkg, lock, manifest] = await Promise.all([
    "package.json", "package-lock.json", "com.dario.teams-cli.sdPlugin/manifest.json"
  ].map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  for (const [field, actual, expected] of [
    ["package.json version", pkg.version, version],
    ["package-lock.json version", lock.version, version],
    ["package-lock.json root package version", lock.packages?.[""]?.version, version],
    ["manifest.json Version", manifest.Version, `${version}.0`]
  ]) {
    if (actual !== expected) throw new Error(`${field}: expected ${expected}, found ${JSON.stringify(actual)}.`);
  }
  console.log(`Release ${tag}: package, lockfile, and plug-in versions match.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
