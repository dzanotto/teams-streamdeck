# Teams CLI for Stream Deck

**Microphone status**, **Camera status**, **Hand status**, and **End call** keys for Microsoft Teams
on macOS, using the existing `teams-cli` executable.
Press the microphone key to toggle mute through `teams-cli mic toggle --json`, or
the camera key to turn video on/off through `teams-cli camera toggle --json`.
Press the hand key to raise or lower your hand through `teams-cli hand toggle --json`.
Press **End call** to leave your active call through
`teams-cli call end --json`.

## Use

Install the packaged `com.dario.teams-cli.streamDeckPlugin`, or use the development
link described below. In Stream Deck, expand **Teams CLI** and drag **Microphone
status**, **Camera status**, **Hand status**, or **End call** onto an empty key.
Install `teams-cli` through Homebrew before configuring the keys. The plug-in
checks `/opt/homebrew/bin/teams-cli`, then `/usr/local/bin/teams-cli`, when a key
first appears without a saved path. It uses the first executable file found,
keeping the stable Homebrew symlink so CLI upgrades do not require a path change.
Discovery does not depend on Stream Deck's shell `PATH` or the build machine.
For a custom installation, save its absolute executable path in the key's settings.

Saved executable paths are always preserved. If a key still points to an old
development build, update its path in the key's settings. Without a detected
Homebrew executable, new keys use the conventional Homebrew path for their
architecture. A missing executable produces SETUP when a status read or button
press tries to run it. Install the CLI at the indicated path, or set its actual
path manually.

| Key | Meaning |
| --- | --- |
| MUTED | Teams reports the microphone muted |
| LIVE | Teams reports the microphone unmuted |
| OFF | Teams reports the camera off; red crossed-out camera |
| ON | Teams reports the camera on; green camera |
| RAISED | Teams reports your hand raised; green hand |
| LOWERED | Teams reports your hand lowered; gray hand |
| TEAMS OFF | Teams is not running |
| ACCESS | macOS Accessibility permission is unavailable |
| MULTIPLE | Multiple eligible calls or conflicting controls |
| SETUP | The executable path needs attention |
| CHECKING | Awaiting an initial observation |
| TOGGLING | A toggle is pending for this control; additional presses are ignored |
| END CALL | Press to leave your call; this label does not indicate whether a call exists |
| ENDING | An end-call command is pending; additional presses are ignored |
| ENDED | The CLI confirmed that you left the call; shown for two seconds |
| UNKNOWN | Inconclusive observation or unverified command; amber microphone, camera, hand, or handset |

Select the key in Stream Deck to see details. For **ACCESS**, enable Stream Deck
in **System Settings → Privacy & Security → Accessibility**. If macOS instead
attributes the request to the `teams-cli` binary, add that executable. This launch
path must be checked independently of terminal permission. The plug-in never
opens permission dialogs or explicitly activates Teams. When ending a call,
Teams itself may bring its main window forward as the call window closes.

## Build and develop

Requires Node 24+, Stream Deck 7.1+, macOS 13+, and an installed `teams-cli`.
The hand button requires a CLI version supporting `hand status` and `hand toggle`.
The Homebrew 0.1.1 executable supports these commands. Older CLIs that only
support `hand raise`/`hand lower` must be updated; there is no automatic fallback.
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

The compiled Node backend and its dependencies are bundled; `teams-cli` remains an
external executable. Homebrew discovery runs on the machine using the plug-in;
building and packaging do not require a sibling CLI checkout.
Logs are in `com.dario.teams-cli.sdPlugin/logs/`; they contain state/reason
transitions and command outcomes, not full CLI output or meeting text.

## Behavior and limits

- Runs `teams-cli mic status --json`, `teams-cli camera status --json`, or
  `teams-cli hand status --json` for observations through `execFile`, with no shell.
  Microphone, camera, and hand keys run the corresponding `toggle --json` on key-down.
  Key-up does not dispatch a command.
- **Hand status** runs one `hand toggle --json` command on key-down, without an
  extra plug-in status read. The CLI resolves the opposite of the first confirmed
  own-hand state under its shared action lock, retains call identity, and verifies
  the result. The displayed state is never used to choose the target. Success
  requires a confirmed `raised` or `lowered` result with preserved focus.
- **End call** runs only `teams-cli call end --json`, once on key-down. It leaves your
  participation in the one active, non-held call. The CLI checks call selection
  and verifies completion; missing controls, all-held calls, and multiple active
  calls are refused. The button never automatically retries an uncertain result.
- End-call buttons using the same executable share busy/result feedback. The
  button shows ENDED for two seconds after confirmed success, then returns to
  END CALL. Failures stay visible with a key alert and reason in the settings
  panel until the next press, path change, or profile change. There is no call
  status polling; microphone/camera/hand UNKNOWN states do not establish that a call ended.
- Call-end confirmation follows the CLI's focus policy: a focus change caused by
  leaving the call does not invalidate verified completion. Microphone, camera,
  and hand changes continue to require confirmation that focus was preserved.
- Microphone, camera, and hand keys use the CLI's fresh-state toggle. The CLI requires one eligible non-held call and verifies the resulting state.
- Polling for a control pauses during its toggle. An existing background status
  process is canceled with SIGKILL; dispatch waits for its process and output streams
  to close, and its result is discarded. All visible keys for that control and executable
  share the toggle result. Microphone, camera, and hand observations stay independent.
  Additional presses while busy are ignored, never queued. A pending toggle is
  canceled before dispatch if its key disappears or its executable path changes.
  Cancellation never interrupts a dispatched action. Polling for other controls
  continues independently.
- The CLI shares an action lock across microphone, camera, hand, and end-call commands.
  If controls are pressed at once, a competing command may report busy; it is not
  queued or automatically retried.
- A refused, failed, or unverified action displays a key alert and the CLI's status
  and reason. Actions are never automatically retried; media status polling resumes.
  Action subprocesses have a 20-second timeout; a timeout does not prove no change
  occurred. Only a successful CLI result is treated as a confirmed action.
- One read per control and executable path is shared across visible keys. Polls
  wait one second after completion; permission/setup/Teams-not-running results retry
  after five seconds. There is no polling when the last key disappears.
- Known status expires after 3.5 seconds without another completed observation.
  A hung status subprocess is terminated after 12 seconds; stale/invalid results
  never become MUTED, OFF, or LOWERED. Removing the last visible key also cancels its
  background read. Its result is discarded, and no further read starts while all
  keys are hidden. Reappearing keys wait for the old process to close before reading.
- Background changes made in Teams appear on the next successful read. This is
  polling, not an instantaneous media signal. While the computer or Stream Deck
  is suspended, the plug-in cannot update the physical key.
- Uses the CLI's held-call filtering and ambiguity result, without selecting
  window indices or guessing which call to use.
- Missing controls remain UNKNOWN. LIVE/MUTED, ON/OFF, and RAISED/LOWERED describe Teams UI state,
  not physical hardware switches, audio/video capture, or delivery to other participants.
- Teams updates can change the Accessibility interface. The CLI's existing
  version/language/minimized-window limits also apply here.

## Button timing logs

Each bound key-down produces one `button_timing` JSON record in the plug-in's
`logs/com.dario.teams-cli.*.log` files. Timings use a monotonic clock, start when
the plug-in receives key-down, and are buffered until the controller returns.
They exclude hardware input transport, physical display refresh, and failure-alert display.

- `press_id` identifies one press; `control` identifies the button type.
- `outcome` is `confirmed`, `failed`, `canceled` before action dispatch, or
  `ignored_busy`/`ignored_unavailable`. Confirmed and failed records also include
  the resulting `status` and any `reason`. Compare successful actions separately
  from failures and ignored presses.
- `stages_ms` contains elapsed milliseconds from key-down: `accepted`,
  `poll_cancel_requested` and `poll_settled` when a background read was active,
  `command_started`, `command_completed`, and `ready` when the busy guard clears.
  Absent stages did not occur. `ready` is the total press-to-readiness time for
  accepted presses, including canceled ones; ignored presses have no `ready` stage.
- `commands` contains each subprocess's `command`, `dispatch_ms`, `complete_ms`,
  and `duration_ms`. Dispatch means the spawn request; completion means process
  and stream closure. Hand presses have one `hand toggle --json` span.
  The canceled background poll is covered by the cancellation stages, not this list.

The time between `poll_cancel_requested` and `poll_settled` measures cancellation
and termination waiting. The command spans include CLI startup, Teams checks,
verification, and cleanup; they do not separate the CLI's internal stages.
The end-call button unlocks before its two-second ENDED feedback expires.

## Validation

Personal-path cleanup on 2026-10-08 removed automatic migration from the private
development default. Saved paths are now preserved regardless of the old
manual-path flag. The migration checks described below are historical; current
tests cover saved-path preservation, Homebrew discovery, and manual overrides.
All 61 unit/process/UI tests and 11 built-plug-in integration tests passed,
along with type checking, the build, Elgato manifest validation, and packaging.
No live Teams action was performed.

Homebrew migration validation on 2026-10-06: all 61 unit/process/UI tests and
11 built-plug-in integration tests passed, together with type checking, the build,
and Elgato manifest validation. Tests cover both Homebrew prefixes, stable symlinks,
missing/non-executable candidates, new-key discovery, migration of the exact old
default, saved-settings echoes, and manual overrides. Integration tests redirect
Homebrew and legacy paths to fake CLIs and never operate Teams. The resolver also
detected this machine's `/opt/homebrew/bin/teams-cli` without invoking it.
The package was rebuilt and the linked plug-in reloaded in the background. All
four existing keys saved the Homebrew path; microphone, camera, and hand polling
reported `teams_not_running`. No live toggle or end-call command was performed.

Native hand-toggle validation on 2026-10-06: the sibling release executable's
`hand toggle --help` confirms support. All 55 unit/process/UI tests and eight
built-plug-in integration tests passed, together with type checking, the build,
and Elgato manifest validation. Tests require one `hand toggle --json` invocation
and timing span, cover both resulting states and stale displayed state, preserve
failure/focus checks, and reject older CLI responses without fallback or retry.
No live Teams action was performed for this change.

Cancellation/timing validation on 2026-10-06: all 55 unit/process/UI tests and
all eight built-plug-in integration tests passed, along with type checking,
the build, and local Elgato manifest validation. Fake CLI processes verify that
a hung poll has exited before action dispatch, canceled output is discarded,
duplicate presses remain blocked, and timing records contain ordered stages and
command spans. Profile-change cancellation and polling recovery
remain covered. No live Teams actions or physical-button latency measurements
were performed for this change.

Unit/process tests cover the status/toggle/end JSON and exit-code contracts, executable
paths with spaces and shell metacharacters, exact arguments, subprocess timeouts,
shared polling and toggles, duplicate presses, stale observations, profile changes,
permission backoff, and settings-panel message routing.

The integration test launches the actual bundled SDK plug-in against a local
WebSocket host and a fake CLI. It verifies microphone, camera, and hand controls,
shared reads, MUTED/LIVE, OFF/ON, and LOWERED/RAISED image changes, toggles in both directions, duplicate-press handling,
failed-toggle alerts, inspector messages, changed paths, and stopping polls when
keys disappear. Each run keeps the other control visible to check that its
state, settings-panel details, and polling remain independent.
The hand-specific test verifies native toggle dispatch despite an outdated
displayed state, CLI refusals, and completion of an already dispatched action
when the initiating key changes executable path. Shared monitor tests cover
canceling pending actions before dispatch on key/path changes.
The end-call test verifies exact command dispatch, shared busy handling,
confirmed completion, failed-command alerts, path/profile changes, and the absence
of polling or automatic retries.
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

Camera validation on 2026-10-05: all 28 unit/process/UI tests and both built-plug-in
integration tests passed, along with type checking and Elgato manifest validation.
The ON, OFF, UNKNOWN, and TOGGLING camera icons were rendered and visually checked.
The release executable's help confirms support for `camera toggle --json`.

The user confirmed on 2026-10-05 that the camera button works on the physical
Stream Deck in the tested setup. The sibling CLI's camera toggle has separate
user-confirmed live validation (see its README).

End-call validation on 2026-10-05: all 37 unit/process/UI tests and all three
built-plug-in integration tests passed, along with type checking and Elgato
manifest validation. END CALL, ENDING, ENDED, and UNKNOWN icons were rendered and
visually checked. The release executable's help confirms support for `call end --json`.

The user confirmed on 2026-10-05 that the End call button works on the physical
Stream Deck in the tested setup. The sibling CLI's call-end command has separate
user-confirmed live validation (see its README).

Hand-button validation on 2026-10-05: all 48 unit/process/UI tests and all five
built-plug-in integration tests passed, along with type checking and Elgato
manifest validation. RAISED, LOWERED, UNKNOWN, and TOGGLING hand icons were rendered
and visually checked. The configured CLI's help confirms `hand raise` and
`hand lower` support. No automated live hand action was run during implementation.

The user confirmed on 2026-10-05 that the Hand status button works on the physical
Stream Deck in the tested setup.

Reference: [Elgato SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/)
and [teams-cli](../teams-cli/README.md).
