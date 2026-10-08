# Testing and validation notes

See the [README](../README.md#development) for build and test commands. This page
separates automated coverage from observations on a particular live setup.

## Automated coverage

Tests use `node:test` and `node:assert/strict`. Unit/process/UI tests run with
`npm test`; `npm run test:integration` builds the plug-in before testing its bundle.
Integration tests require a localhost listener and substitute fake executables
for Teams CLI paths, including Homebrew discovery paths.

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

The bundled-plugin suite also checks that the project license matches the source
file and that full license texts and versioned attributions for bundled
dependencies are included.

## Live validation scope

The microphone display and toggle, camera toggle, end-call button, and hand button
were confirmed on a physical Stream Deck in the setup described below. These
observations do not establish compatibility with every Teams/macOS version or
language, and do not validate every subsequent change. Background focus
preservation, held-call behavior, and recovery after restarting Teams remain
separate live checks.

Automated tests do not replace those checks.

## Validation history

Entries record the implementation and checks at the time. Earlier path migration
and separate hand raise/lower behavior have since been replaced; current behavior
is described in the [development notes](development.md#behavior-and-limits).
References to a sibling CLI checkout describe the historical development setup;
its public documentation is [here](https://github.com/dzanotto/teams-cli).

Installer license validation on 2026-10-08: all 61 unit/process/UI tests and 12
built-plug-in integration tests passed, along with type checking, the build,
Elgato manifest validation, and packaging. The installer archive was inspected:
its project license matched the source exactly, full license texts and versioned
attributions were present for all five bundled dependencies, and logs were absent.
No live Teams action was performed.

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
