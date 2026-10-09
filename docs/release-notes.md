## Installation and requirements

Download `com.dario.teams-cli.streamDeckPlugin` from this release and open it in
Stream Deck. The same installer serves Apple Silicon and Intel Macs. The project
license and full bundled dependency notices are included in the installer.

Requires macOS 13+, Stream Deck 7.1+, the Microsoft Teams desktop app, and a
separate [teams-cli](https://github.com/dzanotto/teams-cli) installation with
`hand status` and `hand toggle` support. These commands were verified with the
Homebrew 0.1.1 executable. Install the CLI with `brew install dzanotto/tap/teams-cli`
and grant Accessibility access for the Stream Deck launch path.

Download `SHA256SUMS` alongside the installer to verify it with
`shasum -a 256 -c SHA256SUMS` on macOS.

## Known limitations

This is an unofficial project, not affiliated with Microsoft. Buttons report
Teams UI state and cannot verify actual audio/video delivery. Teams updates can
change Accessibility controls; language and own-video-tile limitations also apply.
Uncertain actions are never automatically retried, and leaving a call may bring
Teams forward.

The four buttons have been confirmed on one live setup. Automated CI uses fake
CLIs; background focus preservation, held-call behavior, and recovery after
restarting Teams remain separate live checks. See the
[README](https://github.com/dzanotto/teams-streamdeck#limitations) for details.
