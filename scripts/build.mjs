import { build } from "esbuild";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

const plugin = "com.dario.teams-cli.sdPlugin";
await mkdir(`${plugin}/bin`, { recursive: true });
const result = await build({
  entryPoints: ["src/plugin.ts"], outfile: `${plugin}/bin/plugin.js`,
  bundle: true, platform: "node", target: "node24", format: "esm",
  sourcemap: false, metafile: true,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  external: ["bufferutil", "utf-8-validate"]
});

// Use the bundle's inputs so notices follow the dependencies actually shipped.
const packageRoots = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
    if (bytesInOutput === 0) continue;
    const parts = resolve(input).split(sep);
    const index = parts.lastIndexOf("node_modules");
    if (index < 0) continue;
    const end = index + (parts[index + 1].startsWith("@") ? 3 : 2);
    packageRoots.add(parts.slice(0, end).join(sep));
  }
}
const notices = [];
for (const root of packageRoots) {
  const { name, version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const files = (await readdir(root, { withFileTypes: true }))
    .filter((file) => file.isFile() && /^(licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(file.name))
    .map((file) => file.name).sort();
  if (!files.some((file) => /^(licen[cs]e|copying)(?:[.-].*)?$/i.test(file))) {
    throw new Error(`Missing license text for bundled dependency ${name}@${version}`);
  }
  const texts = await Promise.all(files.map(async (file) => `${file}\n\n${await readFile(join(root, file), "utf8")}`));
  notices.push(`${name}@${version}\n${"=".repeat(72)}\n\n${texts.join("\n\n")}`);
}
await copyFile("LICENSE", `${plugin}/bin/LICENSE`);
await writeFile(`${plugin}/bin/THIRD_PARTY_NOTICES.txt`, `Third-party software included in this plug-in\n\n${notices.sort().join("\n\n")}\n`);
await writeFile(`${plugin}/bin/package.json`, '{"type":"module"}\n');
console.log(`Built ${plugin}; teams-cli is discovered at runtime`);
