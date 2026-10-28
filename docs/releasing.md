# Releasing

Releases require explicit maintainer approval. This document describes the manual sequence; it does not authorize publishing, tagging, or changing repository visibility. No release automation or publish should run as part of ordinary documentation work.

## Version policy

- `0.x` means the public API and behavior can change between minor releases. A `0.2.0` release remains pre-1.0 and makes no stability guarantee.
- `1.0.0` requires an explicitly reviewed stable API, documented support policy, and maintainer approval.
- Publish prereleases on the npm `next` dist-tag, for example `0.3.0-beta.1`. Do not move `latest` for a beta.
- Keep `package.json` as the single source of the package version; do not hand-maintain a second runtime version.

## Manual release sequence

Only an authorized maintainer performs these steps after reviewing the exact commit and confirming tests and release notes:

1. Update `CHANGELOG.md`, package version, and any compatibility notes. Verify the package version and clean working tree.
2. Create and push the version tag for the reviewed commit. The tag must match the package version.
3. Create a GitHub Release from that tag with the matching changelog notes. Mark prereleases as prereleases.
4. Publish to npm explicitly. Stable releases use the intended stable dist-tag; beta releases use `--tag next`. Use provenance only from a supported GitHub-hosted runner if the release process supports it.
5. Read back the GitHub Release and npm package/version/dist-tag. Report the exact result; do not infer publication from a command's exit status alone.

Do not publish from an unreviewed branch or fork. Never include API keys or other secrets in release artifacts. This repository documentation does not claim that a release has occurred.

## Gate and package review

Before creating a tag, run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:mutation` and `gitleaks git --redact --no-banner`. Inspect `npm pack --dry-run --json`: only the intended distribution, public docs/skills and license material should ship. Do not ship personal client configs or local environment files. Check exact-head CI in GitHub, not a check from an earlier commit.

For the first release, update the temporary repository name/source-install instructions after the owner approves the final name and visibility. Version 0.2.0 is not published by this branch.

## Disabled-by-default publish workflow

`.github/workflows/release.yml` has **only** `workflow_dispatch`; tags, pushes and PRs do not trigger it. Its `enabled` input defaults to false. The authorized maintainer creates the matching tag and GitHub Release first, then may enable this workflow for that existing version tag and select `next` or `latest`.

The job runs on `ubuntu-latest`, installs a pinned npm version with OIDC support, and publishes with `--provenance`. Configure npm trusted publishing for the exact owner/repository/workflow before using it. It needs `id-token: write`, not a stored npm token. The self-hosted CI runner must never publish. If GitHub-hosted execution is unavailable because of account billing, this provenance path remains unavailable; do not claim provenance from a local/manual publish. Resolve account access first or explicitly document a maintainer-approved publication without provenance.

After publication, inspect `npm view mcp-manychat@0.2.0 version dist --json` and `npm view mcp-manychat dist-tags --json`, and verify the exact GitHub Release/tag commit. A beta such as `0.3.0-beta.1` must remain on `next`; `latest` must not silently move. Do not run any release command as part of development or CI verification.
