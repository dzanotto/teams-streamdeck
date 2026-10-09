# Publishing a release

The [release workflow](../.github/workflows/release.yml) runs when a tag matching
`v*` is pushed. It accepts stable versions such as `v0.1.0`; prerelease/build
suffixes and leading zeros are rejected.

## Manual steps

Before the first release, commit and push the release workflow and its supporting
files. The current `0.1.0` package and `0.1.0.0` manifest match the tag `v0.1.0`.

For subsequent releases:

1. Update the package and lockfile together, for example:

   ```sh
   npm version 0.1.1 --no-git-tag-version
   ```

2. Set `Version` in `com.dario.teams-cli.sdPlugin/manifest.json` to `0.1.1.0`.
   The fourth component must be zero. Update [release notes](release-notes.md)
   and the README if requirements or known limitations changed.
3. Check version consistency, then commit and push the changes:

   ```sh
   node scripts/check-release.mjs v0.1.1
   ```

4. Tag that commit and push the tag:

   ```sh
   git tag -a v0.1.1 -m "Release v0.1.1"
   git push origin v0.1.1
   ```

Use `v0.1.0` for the first release. Observe the Release workflow run to confirm
publication succeeded.

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
