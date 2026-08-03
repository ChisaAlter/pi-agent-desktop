# Pi Desktop

Pi Desktop is a Windows desktop client for the [Pi CLI](https://github.com/earendil-works/pi-coding-agent). It packages the agent into a desktop workflow with chat, workspace routing, approvals, tools, settings, terminal tabs, and a GitHub Releases based updater.

## Who This Repository Is For

- Developers who want to run Pi through a native Windows desktop UI
- Maintainers who need to build, sign, publish, and verify Windows releases
- Contributors who want the current project layout, verification flow, and release expectations in one place

## Current Status

Current source baseline: Pi Desktop `1.0.14`, Electron `41.2.0`, Node.js `>=22.19.0`, and pnpm `9.0.0`.

| Item | Current fact |
| --- | --- |
| Source and desktop package version | `1.0.14` |
| Electron runtime | `41.2.0` |
| Main-process IPC modules | 24 |
| Session persistence | `node:sqlite` through `SqliteSessionRepository` |
| CI gate | typecheck, lint, test on `windows-latest` |
| Compose workflow | Implemented built-in `compose` workflow with documented degradation limits |
| NSIS isolation | Build/artifact checks exist; install/upgrade/uninstall remain blocked until an isolated Windows environment is available |

The current-state documents are the maintained facts contract:

- [Current facts](docs/current/facts.md): version, runtime, IPC, Compose, persistence, and release boundaries
- [Architecture](docs/current/architecture.md): process boundaries, IPC, runtime data flow, and Compose structure
- [Persistence](docs/current/persistence.md): active stores, migration, recovery, and native Pi session continuity
- [Testing and QA](docs/current/testing-and-qa.md): CI, Electron E2E, packaging, and isolation evidence boundaries
- [Permission matrix](docs/security/PERMISSION-MATRIX.md): enforced tool, approval, path, and IPC controls

Published GitHub release state is intentionally separate from checked-in source state. See the [release and auto-update guide](docs/RELEASE-AND-AUTO-UPDATE.md) before making claims about tags or assets.

## What Pi Desktop Does

- Runs long-lived Pi sessions per workspace
- Routes tool approvals through a desktop review flow
- Provides file references, terminal tabs, workspace switching, session history, and settings
- Uses typed IPC across main, preload, and renderer
- Supports GitHub Releases based application updates for signed Windows release builds

## Documentation Map

- [Release and auto-update guide](docs/RELEASE-AND-AUTO-UPDATE.md): what the current version is, how releases are published, what artifacts are required, and how the updater behaves
- [Contributing guide](CONTRIBUTING.md): local development workflow and contribution conventions
- [Design system](DESIGN.md): chat, settings, and desktop-surface spacing, tokens, motion, and running-state rules
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
pnpm verify:docs
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @pi-desktop/desktop build
```

For renderer, chat runtime, settings, overlay, or other desktop-surface changes, do not stop at repo gates. Run the matching real Electron Playwright acceptance and capture fresh screenshots in `docs/compose/acceptance/`.

Examples:

```bash
pnpm --filter @pi-desktop/desktop exec playwright test e2e/overlay-anchors.spec.ts
pnpm --filter @pi-desktop/desktop exec playwright test e2e/generated-ui-v1-acceptance.spec.ts
pnpm --filter @pi-desktop/desktop exec playwright test e2e/running-control.spec.ts
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

- `Pi-Desktop-<version>-setup.exe`
- `Pi-Desktop-<version>-setup.exe.blockmap`
- `latest.yml`

Packaged installs also carry `app-update.yml`, which is what `electron-updater` reads at runtime to locate GitHub release metadata.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
