import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const plugin = "com.dario.teams-cli.sdPlugin";
await mkdir(`${plugin}/bin`, { recursive: true });
await build({
  entryPoints: ["src/plugin.ts"], outfile: `${plugin}/bin/plugin.js`,
  bundle: true, platform: "node", target: "node24", format: "esm",
  sourcemap: false,
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  external: ["bufferutil", "utf-8-validate"]
});
await writeFile(`${plugin}/bin/package.json`, '{"type":"module"}\n');
console.log(`Built ${plugin}; teams-cli is discovered at runtime`);
