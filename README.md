# Teams CLI for Stream Deck

> [!IMPORTANT]
> **UNOFFICIAL PROJECT — NOT AFFILIATED WITH MICROSOFT.**
> This is an independent project. It is not developed, endorsed, sponsored, or
> supported by Microsoft. It is not a Microsoft product or an official Microsoft
> Teams integration.

Control your Microsoft Teams microphone, camera, raised hand, and call from
Stream Deck on macOS. The plug-in uses the separately installed
[teams-cli](https://github.com/dzanotto/teams-cli) executable.

## Requirements

- macOS 13 or later and the Microsoft Teams desktop app.
- Stream Deck 7.1 or later.
- A compatible `teams-cli` installation, including `hand status` and `hand toggle`
  support. These commands were verified with the Homebrew 0.1.1 executable;
  older versions supporting only `hand raise` and `hand lower` need updating.
- macOS Accessibility permission for the launcher or executable used by Stream Deck.

A packaged installation uses [Stream Deck's Node.js runtime](https://docs.elgato.com/streamdeck/sdk/introduction/plugin-environment/).
Install Node.js separately only when building or developing the plug-in.

## Installation

1. Install the CLI with [Homebrew](https://brew.sh):

   ```sh
   brew install dzanotto/tap/teams-cli
   ```

2. Open `com.dario.teams-cli.streamDeckPlugin` to install it in Stream Deck.
   If you do not have an installer, [build one from this repository](#development).
3. In Stream Deck, expand **Teams CLI** and drag the desired actions onto keys.
4. Grant Accessibility access in **System Settings → Privacy & Security → Accessibility**.
   Enable **Stream Deck**. If macOS instead attributes the request to `teams-cli`,
   add that executable. Terminal permission alone does not establish permission
   for the Stream Deck launch path; the plug-in does not open permission dialogs.

New keys automatically look for `teams-cli` at `/opt/homebrew/bin/teams-cli`, then
`/usr/local/bin/teams-cli`. For another location, select the key and save the
absolute executable path in its settings. Saved paths are preserved, so update
any key that still points to an old development build. Keep the stable Homebrew
path when upgrading the CLI.

## Buttons

| Action | Press to |
| --- | --- |
| Microphone status | Toggle mute |
| Camera status | Turn your camera on or off |
| Hand status | Raise or lower your hand |
| End call | Leave your active call |

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

Select a key in Stream Deck to see its current status and any failure reason.
Additional presses while that control is busy are ignored.

## Troubleshooting

| Display | What to check |
| --- | --- |
| ACCESS | Review Accessibility access for Stream Deck or the executable, as described under Installation. Permission granted to your terminal may not apply here. |
| SETUP | Install `teams-cli`, then check the key's saved path. It must point to an existing executable using an absolute path. |
| TEAMS OFF | Open the Microsoft Teams desktop app. |
| MULTIPLE | Check for multiple active calls or conflicting controls in Teams. The CLI refuses to guess which call to use. |
| UNKNOWN | Read the reason in the key's settings. Check the state directly in Teams, particularly after an unconfirmed action, before pressing again. Missing controls, held calls, stale observations, or an incompatible CLI response can cause this state. |

`UNKNOWN` can also appear when no call is active: it does not establish that a
call has ended or that your microphone or camera is off. If the hand button fails
with an older CLI, update to a version supporting `hand toggle`; there is no
fallback to separate raise/lower commands.

For diagnostics, see the [logging notes](docs/development.md#logs-and-button-timing).

## Limitations

- Buttons report Teams UI state. They cannot verify hardware switches, actual
  audio/video capture, or delivery to other participants.
- Status updates use polling and stop while keys are hidden. Updates are not
  instantaneous; suspended computers or Stream Deck cannot refresh the keys.
- Actions require one eligible, non-held call. Ambiguous calls and missing
  controls are refused. An uncertain action is never automatically retried;
  failure or timeout does not prove that no change occurred.
- Confirmed microphone, camera, and hand changes require the CLI to verify that
  focus was preserved. Ending a call may bring Teams forward as its window closes.
- Teams updates can change its Accessibility interface. Language, own-video-tile,
  and minimized-window limitations from [teams-cli](https://github.com/dzanotto/teams-cli#compatibility-and-limitations)
  also apply to this plug-in.

Automated tests use fake CLIs and never operate Teams or a physical Stream Deck.
The four buttons have been confirmed on one live setup; background focus
preservation, held-call behavior, and recovery after restarting Teams remain
separate live checks. See the [testing notes](docs/testing.md) for scope and dated evidence.

## Development

Use Node 24 or later; `.nvmrc` selects Node 24. From the repository root:

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

`npm run pack` creates `com.dario.teams-cli.streamDeckPlugin` in the repository
root. Build tools are project dependencies; a global Elgato CLI and a real
`teams-cli` installation are not required for building or automated tests.
Integration tests need permission to listen on localhost.

See [development notes](docs/development.md) for local linking, reloads, CLI
commands, polling, and timing logs, and [testing notes](docs/testing.md) for
validation details.

## License

Released under the [MIT License](LICENSE). The installer includes the project's
license in `bin/LICENSE` and full notices for its bundled dependencies in
`bin/THIRD_PARTY_NOTICES.txt` inside the plug-in directory.
