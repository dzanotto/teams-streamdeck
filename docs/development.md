# Development notes

See the [README](../README.md#development) for requirements and build/test commands,
and the [testing notes](testing.md) for automated coverage and live-validation scope.
Run the commands below from the repository root.

## Local installation and reloads

Build the plug-in, enable Stream Deck developer mode, and create a development link:

```sh
npm run build
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

Live use requires an installed `teams-cli` and Accessibility permission for the
Stream Deck launch path.

## Executable discovery

The compiled Node backend and its dependencies are bundled; `teams-cli` remains an
external executable. Homebrew discovery runs on the machine using the plug-in;
building and packaging do not require a sibling CLI checkout.

For a new key without a saved path, the plug-in checks `/opt/homebrew/bin/teams-cli`,
then `/usr/local/bin/teams-cli`, and uses the first executable file found. It keeps
the stable Homebrew symlink, so upgrades do not require changing a versioned Cellar
path. Discovery does not depend on Stream Deck's shell `PATH` or the build machine.

Every non-empty saved path is preserved. Without a detected executable, new keys
use the conventional Homebrew path for their architecture. A missing executable
produces SETUP when a status read or button press tries to run it.

## Packaging and license notices

`npm run pack` builds and validates the plug-in before creating its installer.
The build copies the project's `LICENSE` into the generated `bin/` directory and
writes `bin/THIRD_PARTY_NOTICES.txt` using the dependencies actually included in
the bundle. Notices include package names, versions, and full license texts,
plus package-root notice files when present. Missing dependency license files
fail the build.

Generated bundles, logs, and `.streamDeckPlugin` installers are ignored by Git.

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

## Logs and button timing

Logs are in `com.dario.teams-cli.sdPlugin/logs/` inside the installed plug-in
(or this checkout when development-linked). They contain state/reason transitions
and command outcomes, not full CLI output or meeting text.

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

References: [Elgato SDK](https://docs.elgato.com/streamdeck/sdk/introduction/getting-started/) and [teams-cli](https://github.com/dzanotto/teams-cli).
