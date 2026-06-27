# Pi Desktop

Pi Desktop is a Windows desktop client for the [Pi CLI](https://github.com/earendil-works/pi-coding-agent). It packages the agent into a desktop workflow with chat, workspace routing, approvals, tools, settings, terminal tabs, and a GitHub Releases based updater.

## Who This Repository Is For

- Developers who want to run Pi through a native Windows desktop UI
- Maintainers who need to build, sign, publish, and verify Windows releases
- Contributors who want the current project layout, verification flow, and release expectations in one place

## Current Status

As of 2026-06-27, the checked-in application version is `0.1.0` in both the workspace root and the desktop package.

Current release snapshot:

| Item | Status |
| --- | --- |
| Source version | `0.1.0` |
| Desktop package version | `0.1.0` |
| Remote default branch | `master` |
| Latest remote Git tag | `v1.0.2` |
| GitHub Releases entries | none published |
| In-app updater runtime | implemented and verified in packaged Windows builds |
| Real updater result today | GitHub Releases feed returns `404` until a signed release is actually published |

That last line matters: the updater code path is in the app now, but packaged builds cannot discover a newer version until the repository has a real GitHub Release with `latest.yml`, installer, and blockmap assets.

## What Pi Desktop Does

- Runs long-lived Pi sessions per workspace
- Routes tool approvals through a desktop review flow
- Provides file references, terminal tabs, workspace switching, session history, and settings
- Uses typed IPC across main, preload, and renderer
- Supports GitHub Releases based application updates for signed Windows release builds

## Documentation Map

- [Release and auto-update guide](docs/RELEASE-AND-AUTO-UPDATE.md): what the current version is, how releases are published, what artifacts are required, and how the updater behaves
- [Contributing guide](CONTRIBUTING.md): local development workflow and contribution conventions
- [Milestone archive](docs/RELEASE-NOTES-M1-M5.md): historical M1-M5 implementation report

## Quick Start

### Prerequisites

- Windows 10 or Windows 11
- Node.js `>= 22.19.0`
- pnpm `>= 9`
- Pi CLI installed and available on `PATH`

### Install and run

```bash
git clone https://github.com/ChisaAlter/pi-agent-desktop.git
cd pi-desktop
pnpm install
pnpm --filter @pi-desktop/desktop dev
```

### Verification commands

Use this order before pushing code:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @pi-desktop/desktop build
```

For updater work or release work, also build a packaged Windows artifact:

```bash
$env:PI_DESKTOP_ENABLE_AUTO_UPDATE='1'
pnpm --filter @pi-desktop/desktop package
```

## Release Model

Pi Desktop publishes Windows releases from Git tags matching `v*.*.*`.

The release pipeline is designed around these constraints:

- updater code is enabled only when the desktop main bundle is built with `PI_DESKTOP_ENABLE_AUTO_UPDATE=1`
- signed Windows publishing is mandatory for updater-enabled releases
- the GitHub release must ship the installer, installer blockmap, and `latest.yml`
- the app checks silently on startup and every 6 hours, but download and install remain explicit user actions

The operational details live in the release guide:

- [Release and auto-update guide](docs/RELEASE-AND-AUTO-UPDATE.md)

## Repository Layout

```text
pi-desktop/
|-- apps/desktop/          Electron app (main, preload, renderer)
|-- packages/shared-types/ Shared IPC and state types
|-- docs/                  Specs, release notes, release guide, screenshots
`-- .github/workflows/     CI and release automation
```

## Architecture

Pi Desktop is split into three processes:

- Main process: application lifecycle, IPC handlers, updater, sessions, approvals
- Preload: typed bridge exposed to the renderer
- Renderer: React UI, stores, settings window, terminal surfaces

The updater follows the same model:

- main process owns the single source of truth
- preload exposes typed updater APIs
- renderer consumes a single state object instead of stitching multiple event channels together

## Packaging and Updating

Windows packaging uses NSIS through `electron-builder`.

Updater-enabled release artifacts must include:

- `Pi Desktop-<version>-setup.exe`
- `Pi Desktop-<version>-setup.exe.blockmap`
- `latest.yml`

Packaged installs also carry `app-update.yml`, which is what `electron-updater` reads at runtime to locate GitHub release metadata.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
