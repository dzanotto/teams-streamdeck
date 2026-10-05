import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const plugin = "com.dario.teams-cli.sdPlugin";
await mkdir(`${plugin}/bin`, { recursive: true });
// Pin this local build's sibling CLI as the initial setting; it remains editable in Stream Deck.
const cliPath = resolve("../teams-cli/.build/release/teams");
await build({
  entryPoints: ["src/plugin.ts"], outfile: `${plugin}/bin/plugin.js`,
  bundle: true, platform: "node", target: "node24", format: "esm",
  sourcemap: false, define: { __DEFAULT_CLI_PATH__: JSON.stringify(cliPath) },
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  external: ["bufferutil", "utf-8-validate"]
});
await writeFile(`${plugin}/bin/package.json`, '{"type":"module"}\n');
console.log(`Built ${plugin}; default CLI: ${cliPath}`);
