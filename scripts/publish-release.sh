#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root after both CI jobs have passed.
: "${RELEASE_TAG:?Set RELEASE_TAG to the validated version tag}"
: "${EXPECTED_COMMIT:?Set EXPECTED_COMMIT to the tested commit}"
: "${GH_REPO:?Set GH_REPO to the owner/repository}"

installer=com.dario.teams-cli.streamDeckPlugin
test -s "dist/$installer"
test -s docs/release-notes.md
(
  cd dist
  shasum -a 256 "$installer" > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
)

# Listing also finds drafts. API failures stop the script instead of being
# mistaken for an absent release.
existing_tags=$(gh api --paginate "repos/$GH_REPO/releases?per_page=100" --jq '.[].tag_name')
while IFS= read -r existing_tag; do
  if [[ "$existing_tag" == "$RELEASE_TAG" ]]; then
    echo 'A release or draft already exists for this tag; refusing to replace it.' >&2
    exit 1
  fi
done <<< "$existing_tags"

check_tag() {
  local remote_commit
  remote_commit=$(gh api "repos/$GH_REPO/commits/$RELEASE_TAG" --jq .sha)
  if [[ "$remote_commit" != "$EXPECTED_COMMIT" ]]; then
    echo 'The release tag no longer points to the tested commit.' >&2
    exit 1
  fi
}

check_tag
gh release create "$RELEASE_TAG" "dist/$installer" dist/SHA256SUMS \
  --verify-tag --draft --title "$RELEASE_TAG" \
  --notes-file docs/release-notes.md --generate-notes
# Do not publish an incomplete upload or a tag changed while assets were uploaded.
check_tag
gh release edit "$RELEASE_TAG" --draft=false
