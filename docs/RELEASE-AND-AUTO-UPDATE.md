# Pi Desktop Release and Auto-Update Guide

> **Current release procedure.** Source baseline: `1.0.14`; Electron: `41.2.0`. Historical release snapshots below are retained as evidence only. For the current architecture and QA boundaries, see [`current/facts.md`](current/facts.md) and [`current/testing-and-qa.md`](current/testing-and-qa.md).

## Reader and Goal

This document is for the maintainer who needs to publish a Windows release of Pi Desktop and verify that the in-app updater can discover it.

After reading it, you should be able to:

1. confirm the current version state
2. build the right Windows artifacts
3. publish a GitHub Release that the desktop updater can actually see
4. diagnose the most common updater failures without guessing

## Current Version Snapshot

The checked-in source baseline is `1.0.14` and Electron is `41.2.0`. Verify these facts locally with the offline command before a release-related change:

```bash
pnpm verify:docs
```

Published GitHub tags, release assets, and updater reachability are release-environment facts and must be checked during the release flow; do not infer them from the source version alone.

| Item | Current source value |
| --- | --- |
| Workspace root version | `1.0.14` |
| Desktop package version | `1.0.14` |
| Electron runtime | `41.2.0` |
| Updater implementation | `electron-updater` with GitHub Releases provider |
| NSIS isolation | Host install/upgrade/uninstall verification remains blocked pending an isolated Windows environment |

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

## Real Acceptance Evidence

The following is required evidence for a release candidate, not a source-code assumption:

- CI typecheck, lint, and test are green;
- a desktop build and main-runtime smoke check pass;
- updater-enabled packaging produces the installer, blockmap, `latest.yml`, and packaged `app-update.yml`;
- the GitHub Release contains the expected assets and the public metadata URLs respond;
- a packaged app performs a real Settings > About updater check;
- install/upgrade/uninstall are run only in an isolated Windows environment and recorded separately.

The current maintained host is not an acceptable installer test environment: the NSIS isolation gate is blocked by missing elevation/Sandbox capability and an existing host installation. Keep those lifecycle checks `BLOCKED` or `NOT_RUN` until isolated evidence exists.

## Current Release Checks

The source and workflow facts that can be checked offline are:

- root and desktop package versions match `1.0.14`;
- Electron is `41.2.0`;
- CI is the typecheck/lint/test gate;
- updater-enabled release builds set `PI_DESKTOP_ENABLE_AUTO_UPDATE=1`;
- the release workflow builds and verifies NSIS artifacts.

The publication state of a tag, GitHub Release, `latest.yml`, and public feed must be checked against the actual release environment for each release. A source version does not prove that a tag or asset has been published.

## Common Failure Modes

### The packaged app says the updater is disabled

The main bundle was probably built without `PI_DESKTOP_ENABLE_AUTO_UPDATE=1`, or the build is a development or unsigned build not meant for production updates.

### The packaged app says `app-update.yml` is missing

You are testing the wrong artifact shape. The updater runtime depends on packaged release metadata, not a bare development bundle.

### The app shows a GitHub `404`

A `404` can mean that the expected tag/release asset has not been published or that the packaged app cannot reach the configured repository. Check:

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

Pi Desktop source is currently `1.0.14` on Electron `41.2.0`; updater-enabled Windows releases require signed artifacts and explicit GitHub Release verification, while installer lifecycle checks remain blocked until isolated evidence exists.
