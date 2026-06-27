# Pi Desktop Release and Auto-Update Guide

## Reader and Goal

This document is for the maintainer who needs to publish a Windows release of Pi Desktop and verify that the in-app updater can discover it.

After reading it, you should be able to:

1. confirm the current version state
2. build the right Windows artifacts
3. publish a GitHub Release that the desktop updater can actually see
4. diagnose the most common updater failures without guessing

## Current Version Snapshot

This snapshot was updated on 2026-06-27 as part of the updater release cut.

| Item | Value |
| --- | --- |
| Workspace root version | `1.0.12` |
| Desktop package version | `1.0.12` |
| Remote default branch | `master` |
| Repository visibility | `public` |
| Latest remote Git tag | `v1.0.12` |
| Published GitHub Release | `v1.0.12` |
| Release published at | `2026-06-27 15:59:59Z` |
| GitHub release page | `https://github.com/ChisaAlter/pi-agent-desktop/releases/tag/v1.0.12` |
| Published assets | installer, installer blockmap, `latest.yml` |
| Updater result in packaged build | anonymous GitHub metadata is live; a real packaged `1.0.11` build downloaded and installed `1.0.12` successfully |

The key point remains the same: updater support depends on real signed release assets and a public release feed. Both conditions are now satisfied for `v1.0.12`, so packaged builds can resolve GitHub metadata without maintainer credentials.

## How Versioning Works

Pi Desktop currently has two source-level version declarations:

- the workspace root package version
- the desktop application package version

They should move together. The Windows installer name, the generated `latest.yml`, and the version shown inside the app all come from the application package version.

The release workflow is triggered by Git tags matching `v*.*.*`.

## What the Updater Expects

The updater is built on `electron-updater` with GitHub Releases as the provider.

Runtime behavior:

- packaged builds only
- startup check after 3 seconds
- repeat check every 6 hours
- no automatic download
- no automatic install on quit
- download and install are explicit user actions from Settings > About

Release requirements:

- the desktop main bundle must be built with `PI_DESKTOP_ENABLE_AUTO_UPDATE=1`
- the Windows build must be signed
- the GitHub Release must contain:
  - the NSIS installer
  - the installer blockmap
  - `latest.yml`

If any of those are missing, the updater will not behave like a production updater.

## Required Secrets for GitHub Release Publishing

The release workflow now fails fast unless these signing secrets are present:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`

That guard exists so the workflow does not publish a build that looks updater-enabled in source control but is unusable in production.

## Local Verification Flow

Run this from the repository root before you push release-related work:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @pi-desktop/desktop build
```

Then build a packaged Windows artifact with updater support enabled:

```powershell
$env:PI_DESKTOP_ENABLE_AUTO_UPDATE='1'
pnpm --filter @pi-desktop/desktop package
```

After packaging, verify these outputs exist:

- `Pi-Desktop-<version>-setup.exe`
- `Pi-Desktop-<version>-setup.exe.blockmap`
- `latest.yml`
- packaged app resources containing `app-update.yml`

## GitHub Release Flow

1. make sure the repository is in the desired state on `master`
2. ensure the version numbers are correct
3. push the commit
4. confirm CI is green on that commit
5. create and push the release tag
6. let the release workflow build the signed installer and generate `latest.yml`
7. verify the GitHub Release page contains the installer, blockmap, and `latest.yml`
8. verify `https://github.com/<owner>/<repo>/releases.atom` and `.../releases/latest/download/latest.yml` are publicly reachable
9. install the packaged app and run a real updater check from Settings > About

## What Changed in This Updater Rollout

This repo now uses a single updater state model across main, preload, and renderer.

Key behavior changes:

- all windows receive the same updater state broadcast
- settings windows opened later can hydrate from current updater state
- unsigned builds, development runs, missing release metadata, and network failures all surface as visible disabled or error states
- the About tab includes a direct GitHub Releases fallback action
- noisy updater exceptions are normalized into short human-readable messages before they reach the UI
- the release workflow now uploads installer, blockmap, and `latest.yml` with explicit `gh release upload`, instead of relying on `electron-builder` auto-publish side effects

## Real Acceptance Result on 2026-06-28

End-to-end updater acceptance is now complete:

- the repository visibility is `public`
- `releases.atom` returns `200`
- `releases/latest/download/latest.yml` returns `200`
- a real packaged build whose updater state reported `当前版本: 1.0.11` discovered `最新版本: 1.0.12`
- that packaged build downloaded `Pi-Desktop-1.0.12-setup.exe` into `%LOCALAPPDATA%\\@pi-desktopdesktop-updater\\pending`
- the downloaded installer ran successfully and installed `Pi Desktop.exe` under `%LOCALAPPDATA%\\Programs\\Pi Desktop`
- the installed application reports `当前版本: 1.0.12`, `最新版本: 1.0.12`, and `已是最新`

This closes the updater loop on the real packaged Windows path, not just the release-publication side.

## Current Release Status on 2026-06-27

What is already true:

- the repository source version is `1.0.12`
- the remote tag `v1.0.12` is published
- the GitHub Release `v1.0.12` is published
- the release contains the installer, blockmap, and `latest.yml`
- the repository is public, so end users can reach the release feed anonymously
- CI / release workflows are aligned to `pnpm@9.0.0`
- the Windows release workflow now mirrors the repo into a real short path before packaging, which avoids the NSIS `MAX_PATH` include failure on GitHub runners

The publication blockers from earlier in the day are closed:

- invalid `electron-builder --publish` mode
- misplaced `publisherName`
- missing NSIS helper include on CI
- workflow YAML parser issues around the short-path fix
- short-path copy step exiting non-zero on successful `robocopy`
- `lefthook install` failing in the mirrored workspace because `.git` was missing
- duplicate GitHub releases / missing `.blockmap` caused by `electron-builder` auto-publish; the workflow now creates or edits one release explicitly and uploads assets with `--clobber`

## Common Failure Modes

### The packaged app says the updater is disabled

The main bundle was probably built without `PI_DESKTOP_ENABLE_AUTO_UPDATE=1`, or the build is a development or unsigned build not meant for production updates.

### The packaged app says `app-update.yml` is missing

You are testing the wrong artifact shape. The updater runtime depends on packaged release metadata, not a bare development bundle.

### The app shows a GitHub `404`

For `v1.0.12`, a `404` is no longer expected from missing release publication. If it happens now, check:

- the repository was not switched back to `private`
- the packaged app is still pointing at `ChisaAlter/pi-agent-desktop`
- the packaged app was built with `PI_DESKTOP_ENABLE_AUTO_UPDATE=1`
- the network path to GitHub Releases is reachable from the test machine
- the release asset URLs in `latest.yml` still resolve

### The UI shows a massive raw error blob

That was fixed in this rollout. Updater errors should now be summarized before display.

## Release Checklist

- version numbers confirmed
- tests, lint, typecheck, and build all pass
- updater-enabled package built locally
- installer, blockmap, `latest.yml`, and packaged `app-update.yml` verified
- signing secrets present in GitHub Actions
- tag pushed
- GitHub Release assets confirmed
- anonymous release feed confirmed (`releases.atom`, `latest.yml`)
- packaged app manually checked through Settings > About

## If You Need to Explain the Current State Quickly

Use this sentence:

Pi Desktop is now aligned end to end on `1.0.12`; the repository is public, the GitHub release feed is reachable anonymously, and packaged Windows builds can discover, download, and install the published stable release.
