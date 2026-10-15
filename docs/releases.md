# Publishing a release

The [release workflow](../.github/workflows/release.yml) runs when a tag matching
`v*` is pushed. It accepts stable versions such as `v0.1.0`; prerelease/build
suffixes and leading zeros are rejected.

## Release command

From the repository root, use Node 24+ (`nvm use`). Update the
[release notes](release-notes.md) and README if requirements or limitations
changed, and commit your work on `main` before running:

```sh
npm run release -- patch --dry-run
npm run release -- patch
```

Use `minor` or `major` instead of `patch`, or supply an explicit stable version:

```sh
npm run release -- 0.2.0
```

A leading `v` is also accepted. The version must increase. The script updates
`package.json`, both root version fields in `package-lock.json`, and the
manifest's `Version` to `X.Y.Z.0`. It commits those three files as
`Release vX.Y.Z`, creates an annotated tag, and pushes `main` and that tag to
`origin` in one atomic push. Any earlier unpushed commits on `main` are included.
Dependency versions and handwritten release notes are not changed.

The command requires a clean working tree (including untracked files), matching
current versions, and an existing `main` branch on `origin` whose history is
included in local `main`. It rejects existing local or remote tags and multiple
push destinations. If remote changes are missing locally, fetch and integrate
them first. `--dry-run` performs the same read-only checks, including contacting
the push destination, and prints the plan without changing files or Git refs.

The script checks version consistency locally; the tag-triggered workflow runs
the full test, validation, and packaging checks. Observe the Release workflow
run to confirm publication succeeded.

## Automated steps

The workflow checks the tag against `package.json`, both root version fields in
`package-lock.json`, and the plug-in manifest. It reuses CI at the triggering
commit and waits for both Apple Silicon and Intel jobs to pass.

The publish job downloads the tested Apple Silicon job's installer. The package
contains JavaScript and assets and serves both architectures; `teams-cli` remains
an external executable. The workflow generates and verifies `SHA256SUMS`, creates
a draft with both assets, then publishes it. Release notes combine the maintained
[installation and compatibility notes](release-notes.md) with GitHub's generated
change notes. No manual approval step is configured.

Only the publish job receives `contents: write`; it uses GitHub's built-in token,
so no personal access token or additional repository secret is needed. Release
artifacts are `com.dario.teams-cli.streamDeckPlugin` and `SHA256SUMS`. The source
archives supplied by GitHub are separate from the installer.

## Failed runs and retries

If the release command fails before tagging, inspect `git status` and the latest
commit; any completed local edits or commit remain for inspection. If the push
fails, the release commit and tag remain locally. An atomic push updates both
remote refs or neither; a lost connection can still leave its outcome uncertain.
Inspect the remote branch and tag, then use the exact retry command printed by
the script. Do not rerun the version bump or move the tag. Servers that do not
support atomic pushes are rejected without falling back to separate pushes.

Version mismatches stop before CI. Test, validation, and packaging failures stop
before publication. The publish script checks the remote tag against the tested
commit before creating the draft and again before publishing it. Existing
releases or drafts for the same tag are never overwritten.

If a transient failure occurs before a draft is created, rerun the failed jobs.
If an upload or publication fails, a draft may remain; inspect it before deciding
whether to delete that incomplete draft and rerun. A rerun refuses to replace it
automatically. If the release is already public, publish corrections under a new
version instead of moving its tag or replacing assets. Code changes needed to fix
a failed release should also be committed under a new version and tag.

## Download verification

Download the installer and `SHA256SUMS` into the same directory, then run:

```sh
shasum -a 256 -c SHA256SUMS
```

The checksum confirms that the downloaded file matches the published asset.
