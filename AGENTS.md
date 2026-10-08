# Repository Guidelines

## Project Structure & Module Organization

- `src/plugin.ts` registers Stream Deck actions. Supporting modules handle CLI execution/discovery (`cli.ts`, `cli-path.ts`), polling (`monitor.ts`), call termination (`call.ts`), presentation/parsing (`status.ts`), and timing (`timing.ts`).
- `test/` contains unit, process, UI, and bundled-plugin integration tests.
- `com.dario.teams-cli.sdPlugin/` contains `manifest.json`, icons in `imgs/`, and the property inspector in `ui/`.
- `scripts/build.mjs` bundles the backend into the plugin's generated `bin/` directory. Do not commit generated bundles, logs, or `.streamDeckPlugin` packages.

## Build, Test, and Development Commands

Use Node 24+ (`nvm use`), macOS 13+, and Stream Deck 7.1+ for local development. Install `teams-cli` separately for live use.

- `npm ci`: install locked dependencies.
- `npm run typecheck`: check strict TypeScript without emitting files.
- `npm test`: run TypeScript unit, process, and UI tests.
- `npm run test:integration`: build and test the bundled plugin against a fake CLI and local WebSocket server.
- `npm run build`: bundle with esbuild.
- `npm run validate`: validate the plugin with Elgato's CLI.
- `npm run pack`: build an installable package.

For local installation, run `npm exec streamdeck dev`, then `npm run link`. After changes, rebuild and run `npm run restart`. The link depends on this checkout remaining in place.

## Coding Style & Naming Conventions

Follow existing two-space indentation, double quotes, semicolons, and ES modules. Use explicit `.ts` extensions for local TypeScript imports, camelCase for functions/variables, PascalCase for classes/types, and descriptive lowercase filenames. TypeScript uses strict mode; no dedicated formatter or linter is configured.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Name files `test/*.test.ts` and describe observable behavior in test names; bundled integration coverage lives in `test/plugin.test.mjs`. Coverage should be above 80%. Cover changed contracts, cancellation, duplicate presses, and failure handling. Run typechecking and both suites for code changes; validate manifest/assets changes. Integration tests require localhost listeners and never operate Teams.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects, matching history: `Add Teams end-call button`. Keep commits focused. PRs should describe behavior changes, relevant issues, validation results, and screenshots for visual changes. Distinguish automated checks from live-device verification.

## CLI and Interaction Constraints

Invoke `teams-cli` through shell-free `execFile`. Keep atomic toggle decisions in the CLI; never infer actions from cached display state or automatically retry uncertain actions. Preserve saved executable paths and stable Homebrew symlinks. Obtain explicit approval before live Teams state changes; microphone, camera, and hand actions must preserve focus.
