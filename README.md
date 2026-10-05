# Teams CLI for Stream Deck

One **Microphone status** key for Microsoft Teams on macOS.
It uses the existing `teams-cli` executable to show the state Teams reports.
Press the key to toggle mute through `teams mic toggle --json`.

## Use

Install the packaged `com.dario.teams-cli.streamDeckPlugin`, or use the development
link described below. In Stream Deck, expand **Teams CLI** and drag **Microphone
status** onto an empty key. The executable path is prefilled for the sibling
`teams-cli` checkout at build time. Change it in the key's settings if needed.

| Key | Meaning |
| --- | --- |
| MUTED | Teams reports the microphone muted |
| LIVE | Teams reports the microphone unmuted |
| TEAMS OFF | Teams is not running |
| ACCESS | macOS Accessibility permission is unavailable |
| MULTIPLE | Multiple eligible calls or conflicting controls |
| SETUP | The executable path needs attention |
| CHECKING | Awaiting an initial observation |
| TOGGLING | A microphone toggle is pending; additional presses are ignored |
| UNKNOWN | Inconclusive, failed, or expired observation |

Select the key in Stream Deck to see details. For **ACCESS**, enable Stream Deck
in **System Settings → Privacy & Security → Accessibility**. If macOS instead
attributes the request to the `teams` binary, add that executable. This launch
path must be checked independently of terminal permission. The plug-in never
opens permission dialogs or activates Teams.

## Build and develop

Requires Node 24+, Stream Deck 7.1+, macOS 13+, and a compiled `teams-cli`.
Development dependencies are local to this project; no global Elgato CLI is needed.

```sh
nvm use
npm ci
npm run typecheck
npm test
npm run test:integration
npm run build
npm run validate
npm run pack
```

`npm run pack` produces the installable `.streamDeckPlugin` in this directory.
For a local development installation:

```sh
npm exec streamdeck dev
npm run link
open -g 'streamdeck://plugins/restart/com.dario.teams-cli'
```

Developer mode is required for the restart URL. If Stream Deck was already
running when developer mode was enabled, an app restart may be needed.

The link points from Stream Deck's per-user plug-in directory to
`com.dario.teams-cli.sdPlugin` here. Keep this checkout in place while using it.
After source changes, rebuild and repeat the background restart command. The
standard `npm run restart` is also available through Elgato's CLI.

The compiled Node backend and its dependencies are bundled; `teams` remains an
external executable. A package built here initially points at this machine's
CLI path, so a different machine needs its own path set in the key inspector.
Logs are in `com.dario.teams-cli.sdPlugin/logs/`; they contain state/reason
transitions and toggle outcomes, not full CLI output or meeting text.

## Behavior and limits

- Runs `teams mic status --json` for observations and `teams mic toggle --json`
  on key-down through `execFile`, with no shell. Key-up does not dispatch a command.
- Uses the CLI's fresh-state toggle rather than choosing mute/unmute from a cached
  icon. The CLI requires one eligible non-held call and verifies the resulting state.
- Polling pauses during toggles. An existing read finishes first and its result is
  discarded; all visible keys using that executable share the toggle result.
  Additional presses while busy are ignored, never queued. A pending toggle is
  canceled before dispatch if its key disappears or its executable path changes.
- A refused, failed, or unverified toggle displays a key alert and the CLI's status
  and reason. Actions are never automatically retried; normal status polling resumes.
  Toggle subprocesses have a 20-second timeout; a timeout does not prove no change
  occurred. Only a successful CLI result is treated as a confirmed toggle.
- One read per executable path is shared across visible keys. Polls wait one
  second after completion; permission/setup/Teams-not-running results retry
  after five seconds. There is no polling when the last key disappears.
- Known status expires after 3.5 seconds without another completed observation.
  A hung status subprocess is terminated after 12 seconds; stale/invalid results
  never become MUTED. An in-flight read may finish after a key disappears, but
  its result is discarded and no further read starts while all keys are hidden.
- Background changes made in Teams appear on the next successful read. This is
  polling, not an instantaneous media signal. While the computer or Stream Deck
  is suspended, the plug-in cannot update the physical key.
- Uses the CLI's held-call filtering and ambiguity result, without selecting
  window indices or guessing which call to use.
- Missing controls remain UNKNOWN. LIVE/MUTED describe Teams UI state, not
  physical hardware switches, audio capture, or delivery to other participants.
- Teams updates can change the Accessibility interface. The CLI's existing
  version/language/minimized-window limits also apply here.

## Validation

Unit/process tests cover the status/toggle JSON and exit-code contracts, executable
paths with spaces and shell metacharacters, exact arguments, subprocess timeouts,
shared polling and toggles, duplicate presses, stale observations, profile changes,
permission backoff, and settings-panel message routing.

The integration test launches the actual bundled SDK plug-in against a local
WebSocket host and a fake CLI. It verifies registration, shared reads, MUTED/LIVE
image changes, toggles in both directions, duplicate-press handling, failed-toggle
alerts, inspector messages, changed paths, and stopping polls when keys disappear.
It never connects to Teams or a physical Stream Deck.

Initial read-only validation on 2026-10-05: all 10 unit/process/UI tests and the
built-plug-in integration test passed. Elgato manifest validation and packaging
passed. The development link was installed, developer mode enabled, and Stream
Deck 7.6.0 confirmed the plug-in connected.

Toggle validation on 2026-10-05: all 18 unit/process/UI tests and the built-plug-in
integration test passed, along with type checking and Elgato manifest validation.
The configured release CLI's help confirms support for `mic toggle --json`.

The user subsequently confirmed live that the Stream Deck key correctly shows
LIVE and MUTED during an active call, and UNKNOWN when no call is active. This
confirms the basic display and Stream Deck-to-CLI Accessibility path for the
tested setup. UNKNOWN outside a call is intentional: the CLI does not reliably
distinguish absent calls from inaccessible controls.

Background focus preservation, held-call behavior, and recovery after restarting
Teams remain separate live checks; they were not reported in this validation.
The user also confirmed on 2026-10-05 that pressing the physical Stream Deck
button successfully toggles the microphone in the tested setup. The sibling
CLI's own toggle has been tested separately (see its README).

Reference: [Elgato SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/)
and [teams-cli](../teams-cli/README.md).
