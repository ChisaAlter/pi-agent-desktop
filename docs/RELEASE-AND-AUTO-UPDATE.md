# Pi Desktop Release and Auto-Update Guide

## Reader and Goal

This document is for the maintainer who needs to publish a Windows release of Pi Desktop and verify that the in-app updater can discover it.

After reading it, you should be able to:

1. confirm the current version state
2. build the right Windows artifacts
3. publish a GitHub Release that the desktop updater can actually see
4. diagnose the most common updater failures without guessing

## Current Version Snapshot

This snapshot was verified on 2026-06-27 from the local checkout and the live GitHub remote.

| Item | Value |
| --- | --- |
| Workspace root version | `0.1.0` |
| Desktop package version | `0.1.0` |
| Remote default branch | `master` |
| Latest remote Git tag | `v1.0.2` |
| Published GitHub Releases | none |
| Updater result in packaged build | `404` on the GitHub Releases feed |

This is the important implication: updater support is implemented in the app, but it cannot discover newer versions until GitHub Releases is populated with a real signed release.

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

- `Pi Desktop-<version>-setup.exe`
- `Pi Desktop-<version>-setup.exe.blockmap`
- `latest.yml`
- packaged app resources containing `app-update.yml`

## GitHub Release Flow

1. make sure the repository is in the desired state on `master`
2. ensure the version numbers are correct
3. push the commit
4. create and push the release tag
5. let the release workflow publish the signed installer and update metadata
6. verify the GitHub Release page contains the installer, blockmap, and `latest.yml`
7. install the packaged app and run a real updater check from Settings > About

## What Changed in This Updater Rollout

This repo now uses a single updater state model across main, preload, and renderer.

Key behavior changes:

- all windows receive the same updater state broadcast
- settings windows opened later can hydrate from current updater state
- unsigned builds, development runs, missing release metadata, and network failures all surface as visible disabled or error states
- the About tab includes a direct GitHub Releases fallback action
- noisy updater exceptions are normalized into short human-readable messages before they reach the UI

## Real Acceptance Result on 2026-06-27

A real packaged Windows build was launched and tested through the Settings > About screen.

Observed behavior:

- the updater service initialized in the packaged app
- manual update checks executed
- the app showed a readable error state with a GitHub Releases fallback button
- the actual failure was not a renderer bug or an IPC bug
- the actual failure was missing published GitHub Releases metadata, which returned `404`

That is the correct honest result for the repository today.

## Common Failure Modes

### The packaged app says the updater is disabled

The main bundle was probably built without `PI_DESKTOP_ENABLE_AUTO_UPDATE=1`, or the build is a development or unsigned build not meant for production updates.

### The packaged app says `app-update.yml` is missing

You are testing the wrong artifact shape. The updater runtime depends on packaged release metadata, not a bare development bundle.

### The app shows a GitHub `404`

There is no usable GitHub Release metadata yet. Typical causes:

- no GitHub Release exists for the tag
- the release exists but required assets were not published
- the release feed is inaccessible from the configured repository

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
- packaged app manually checked through Settings > About

## If You Need to Explain the Current State Quickly

Use this sentence:

Pi Desktop is still on source version `0.1.0`; the updater implementation is in place and verified in packaged Windows builds, but GitHub Releases is not populated yet, so real update checks currently stop at a `404` metadata error instead of discovering a newer version.
