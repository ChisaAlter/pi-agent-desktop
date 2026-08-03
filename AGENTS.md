# AGENTS.md

> Compact guide for AI agents working in Pi Desktop. Focus: what you'd miss without help.

## Project Overview

Pi Desktop `1.0.14` is an Electron `41.2.0` + React 19 + TypeScript 5 desktop GUI wrapping the [Pi CLI](https://github.com/earendil-works/pi-coding-agent) AI coding agent. Windows-only (v1.0). Current architecture, persistence, permissions, and QA boundaries are maintained in [`docs/current/`](docs/current/) and [`docs/security/PERMISSION-MATRIX.md`](docs/security/PERMISSION-MATRIX.md).

## Monorepo Structure

```
pi-desktop/
├── apps/desktop/          # Main Electron app (3 processes: main, preload, renderer)
│   ├── src/main/          # Electron main process (Node.js)
│   ├── src/preload/       # Secure IPC bridge (contextBridge)
│   └── src/renderer/      # React UI (Vite + Tailwind CSS 4)
│       ├── index.html     # Main window entry
│       └── settings.html  # Settings window entry (multi-page build)
├── packages/shared-types/ # Cross-process TypeScript types (@shared alias)
│   └── src/              # index.ts, events.ts, approval.ts, command-risk.ts
└── docs/                  # Specs, plans, spike notes
    └── compose/           # Brainstorm specs & implementation plans
```

## Path Aliases — Update in THREE Places

Adding a new alias? It must be defined in **all** files where it's used or things break silently:

| Alias | tsconfig.base.json | electron.vite.config.ts | vitest.config.ts |
|-------|:---:|:---:|:---:|
| `@shared` | ✅ | ✅ (3 sections: main, preload, renderer) | ✅ |
| `@` (→ renderer/src) | ✅ | ✅ (renderer section only) | ✅ |
| `@pi-desktop/*` | ✅ | ❌ not in vite config | ❌ not in vitest |

**Gotcha**: Vite doesn't read tsconfig paths. Each alias must be manually duplicated into `electron.vite.config.ts` (all 3 process sections where used) and `vitest.config.ts`.

### Sub-path imports from `@shared`

The `@shared` alias supports sub-path imports used throughout the codebase:
- `@shared` → `packages/shared-types/src/index.ts` (re-exports everything)
- `@shared/events` → `packages/shared-types/src/events.ts` (Pi RPC event types)
- `@shared/command-risk` → `packages/shared-types/src/command-risk.ts` (shell command risk classification)

These resolve via TypeScript `paths` glob (`@shared/*`). Vite aliases only `@shared` (bare) — sub-paths work because they resolve to real files under the aliased directory.

## Commands

```bash
# Root level (all packages)
pnpm install --frozen-lockfile       # Install deps (use --frozen-lockfile in CI)
pnpm -r build                        # Build all packages
pnpm -r typecheck                    # Typecheck all packages
pnpm -r lint                         # Lint all packages
pnpm -r test                         # Run all tests

# Desktop app only
pnpm --filter @pi-desktop/desktop dev          # Start dev mode (hot reload)
pnpm --filter @pi-desktop/desktop build        # Build for production
pnpm --filter @pi-desktop/desktop test         # Run unit tests (vitest)
pnpm --filter @pi-desktop/desktop test src/path/to/file.test.ts  # Single test file
pnpm --filter @pi-desktop/desktop typecheck    # Typecheck only
pnpm --filter @pi-desktop/desktop lint         # ESLint 9 flat config
pnpm --filter @pi-desktop/desktop e2e          # Playwright E2E (requires prior build)
pnpm --filter @pi-desktop/desktop e2e:build   # Build + E2E in one command
pnpm --filter @pi-desktop/desktop package      # Build NSIS Windows installer
```

## Verification Order (Mandatory)

**Before pushing, run the repository gate in this order** — typecheck and lint are parallelizable but must both pass before test:

```bash
pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

The current CI job runs the same three checks on `windows-latest`. It does not run the full Electron E2E suite or NSIS install/upgrade/uninstall isolation. Run the read-only documentation check separately when current facts change:

```bash
pnpm verify:docs
```

Lefthook pre-commit runs typecheck + lint in parallel (no test).


## Architecture: Three Processes

```
┌─────────────────────────────────────────┐
│ Renderer (React 19 + Zustand 5)         │
│  - Components, stores, hooks             │
│  - Communicates via window.piAPI / window.nodeAPI
└────────────────┬────────────────────────┘
                 │ typed IPC (contextBridge)
┌────────────────┴────────────────────────┐
│ Main Process (Electron + Node.js)        │
│  - IPC handlers: src/main/ipc/*.ipc.ts    │
│  - Services: src/main/services/           │
│  - Pi CLI integration: pi-driver.ts       │
└────────────────┬────────────────────────┘
                 │ in-process
┌────────────────┴────────────────────────┐
│ Pi CLI (@earendil-works/pi-coding-agent)  │
└─────────────────────────────────────────┘
```

### IPC Patterns

- **Request-response**: `ipcMain.handle()` / `ipcRenderer.invoke()` — returns `Promise<T>`
- **Fire-and-forget**: `ipcRenderer.send()` / `ipcMain.on()` — no return value
- **Preload bridge**: Two globals via `contextBridge.exposeInMainWorld`: `window.piAPI` (app API) and `window.nodeAPI` (platform info)
- **Error pattern**: IPC handlers return `ipcError()` from `@shared` (structured error object), not thrown exceptions
- **Validation**: High-risk IPC args validated with Zod schemas in `src/main/ipc/schemas.ts`

### Adding a New IPC Handler

1. Define types in `packages/shared-types/src/index.ts`
2. Add Zod schema in `apps/desktop/src/main/ipc/schemas.ts` (if high-risk)
3. Add handler in `apps/desktop/src/main/ipc/*.ipc.ts`
4. Expose in preload: `apps/desktop/src/preload/index.ts`
5. Use in renderer via `window.piAPI`

There are 24 IPC handler files. Each exports a `setup*()` function taking dependencies via typed opts object.

### Multi-workspace Session Architecture

Sessions run in-process (not child processes). The `WorkspaceRegistry` (`services/pi-session/registry.ts`) maps workspaceId → `WorkspaceSession`, each containing an `AgentSession` from the Pi CLI SDK. The `factory.ts` creates sessions; `event-bridge.ts` translates Pi native events into renderer-friendly IPC payloads. All writes are serialized through an async mutex (`withLock`) to prevent race conditions from concurrent `text_delta` + `turn_end` events.

### Session Persistence

The active desktop session/message repository is `node:sqlite` through `SqliteSessionRepository`. It stores `sessions.db` under `app.getPath('userData')`, with WAL, FTS5 message search, health checks, and a best-effort `sessions.backup.db` recovery copy. Native Pi session JSONL files live under `userData/pi-sessions/`; workspaces/settings remain in `electron-store`. See `docs/current/persistence.md` for the storage map and migration rules.

### Approval Flow

`services/approval/classifier.ts` assigns risk levels (high/edit/read) to tool calls. `interceptor.ts` intercepts Pi CLI tool calls and routes high-risk ones through the approval IPC flow. `pending-edits.ts` manages deferred file edits shown to the user after execution.

### UI Layout (Agent Studio design, v1.2)

```
┌────────────────── TitleBar (32px) ──────────────────────────┐
│  TopTabBar (36px): 对话 | 运行 | 工作台 | 扩展        [设置] │
├──────────┬───────────────────────────┬──────────────────────┤
│ Left     │ Center (flex-1)           │ Right Rail (280px)   │
│ 190px+   │                           │ default: collapsed   │
│          │                           │                      │
│ 新对话    │ ChatView / RunPanel /     │ Usage, Permissions,  │
│ 分组切换  │ WorkbenchPanel /          │ Thinking, Env,       │
│ 会话列表  │ SkillsPanel               │ Progress, Tools      │
│ (date/ws)│                           │                      │
└──────────┴───────────────────────────┴──────────────────────┘
```

- **TopTabBar** (`components/TopTabBar/`): 4 tabs driven by `activeSection`: `chat`, `run`, `workbench`, `extensions`. Settings is a right-side icon that opens the independent settings window.
- **Route aliases**: legacy section ids stay supported in `App.tsx`: `tasks` / `memory` → `run`, `files` / `git` / `terminal` → `workbench`, and `tools` / `skills` → `extensions`.
- **RunPanel** (`components/RunPanel/RunPanel.tsx`): secondary tabs `tasks` and `memory`; reuses `TaskOverviewPanel` and `MemoryPanel`.
- **WorkbenchPanel** (`components/Workbench/WorkbenchPanel.tsx`): secondary tabs `files`, `git`, and `terminal`; the terminal uses the full-height embedded display mode.
- **Left sidebar** (`MiniMaxCodeSidebar.tsx`): pure conversation list, no nav items. Group toggle: `date` (今天/昨天/本周/本月/更早) vs `workspace` (ProjectGroupedSessionList). Mode persisted in `settings-store.sidebarGroupMode`.
- **DateGroupedSessionList** (`components/MiniMaxCode/DateGroupedSessionList.tsx`): date-grouped sessions with collapsible groups + archived section.
- **ProjectGroupedSessionList**: workspace rows show a hover/focus **+** control that switches to that workspace and opens a new conversation. Session-count badges and chevrons are not shown on the workspace header.
- **SessionRow** hover actions use per-row enter/leave state so only the hovered row shows pin/archive controls; the selected blue pill spans the full row (indent is padding inside the button).
- **Left collapse control**: lives as a floating button on the center workspace top-left (`MiniMaxCodeLayout` + `onCollapseLeft`). Collapsed left rail uses width `0` with `border-r-0` (no leftover seam). Center panel top strips reserve button clearance (`pl-12` on chat/workbench/run/skills headers); the center column itself does not keep a full-height gutter.
- **Right rail** (`RightRail.tsx`): default collapsed (`settings-store.rightRailCollapsed: true`). Auto-expands only on 0→1 message transition. Manual toggle via chat header control. Compact card title is **Git 工具** (`rightRail.gitTools`): changes summary, branch, commit/push. No inline project-file list. Progress (`right-rail-progress`) mounts only when a plan goal or plan steps exist, and shows `completed/total` for steps.
- **Changes overlay** (`GitChangesOverlay.tsx`): opening **变更** keeps the user in chat and opens a right-side fixed panel (not workbench navigation). Rows show per-file `+/-` from the cached unstaged diff; expanding a row inlines the file diff without jumping to Files/Git workbench.
- **Git snapshot caching**: RightRail keeps a per-workspace in-memory cache of status/diff so reopening the rail does not flash “无 Git”; first load shows “检测中…” until data arrives. Status and full diff are fetched in parallel while the rail is visible.
- **Settings window**: independent `BrowserWindow` (800×600), NOT a modal. IPC: `settings:open-window` / `settings:close-window` in `settings-window.ipc.ts`. Renderer entry: `settings.html` → `SettingsWindow.tsx` → `SettingsContent.tsx` (shared with legacy `SettingsPanel` modal).
- **Layout shell**: `MiniMaxCodeLayout` accepts `topBarSlot`, `leftSlot`, `centerSlot`, `rightSlot` — all collapsible via `leftCollapsed`/`rightCollapsed` props.
- **MemoryPanel** (`components/LongHorizon/MemoryPanel.tsx`): complete implementation backed by `window.piAPI.memorySearch` / `memoryListRecent`; rendered inside `RunPanel`.
- **TaskOverviewPanel** (`components/LongHorizon/TaskOverviewPanel.tsx`): complete implementation reading `useTaskProgress` / `usePlanStore`; rendered inside `RunPanel`.

## Key Files

- **Main entry**: `apps/desktop/src/main/index.ts`
- **Preload bridge**: `apps/desktop/src/preload/index.ts`
- **Renderer entry**: `apps/desktop/src/renderer/src/App.tsx`
- **Settings window entry**: `apps/desktop/src/renderer/settings.html` → `src/renderer/src/SettingsWindow.tsx`
- **Shared types**: `packages/shared-types/src/index.ts` — all IPC payload types defined here first
- **Main process types**: `apps/desktop/src/main/types.ts` — `PiAgentConfig`, `PiAgentModel`, `PiAgentProvider`
- **IPC Zod schemas**: `apps/desktop/src/main/ipc/schemas.ts`
- **Vitest config**: `apps/desktop/vitest.config.ts`
- **Playwright config**: `apps/desktop/playwright.config.ts`
- **Electron Vite config**: `apps/desktop/electron.vite.config.ts`
- **Electron Builder config**: `apps/desktop/electron-builder.yml`
- **ESLint flat config**: `apps/desktop/eslint.config.js`
- **Smoke test**: `scripts/smoke-main-runtime.cjs` — verifies main process IPC setup without launching full app

## Testing

- **Framework**: Vitest 4 + @testing-library/react
- **Test location**: `__tests__/` directories next to source files
- **File naming**: `*.test.ts` or `*.test.tsx`
- **Environment**: `node` (not jsdom) — configured in `vitest.config.ts`
- **Config**: `globals: true`, `css: false`
- **Setup**: `apps/desktop/src/test/setup.ts` sets `NODE_ENV=test` and localStorage locale to `zh-CN`
- **i18n in tests**: Tests default to `zh-CN` locale. Use `zh-CN.json` locale strings in assertions. The app also supports `en-US`.
- **tsconfig excludes `__tests__`** from typecheck, but vitest includes them via its own config

### E2E Tests

- **Framework**: Playwright with `_electron` API (drives compiled Electron directly, no browser)
- **Prerequisite**: Must build first (`pnpm --filter @pi-desktop/desktop build`) — specs run against `out/main/index.js`
- **Single worker only** (`fullyParallel: false, workers: 1`) — Electron is single-instance
- **Timeout**: 60s per test, 10s for assertions (Electron cold start on Windows)
- **Output**: traces/screenshots go to `apps/desktop/e2e-output/`
- **Global setup**: `apps/desktop/e2e/global-setup.ts` verifies built main entry exists
- **Shorthand**: `pnpm --filter @pi-desktop/desktop e2e:build` runs build + E2E

## Code Style

- **TypeScript**: Strict mode (`noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`)
- **ESLint 9 flat config** (`eslint.config.js`): `@typescript-eslint/no-explicit-any` is error (except in `__tests__/` and `src/test/`)
- **Imports**: ESM, no `.js` extensions needed
- **Styling**: Tailwind CSS 4 (utility-first, no CSS modules)
- **State**: Zustand 5 stores in `src/renderer/src/stores/`
- **React hooks**: `react-hooks/rules-of-hooks` is error, `exhaustive-deps` is warn

## Electron Specifics

- **Source baseline**: version `1.0.14`; keep version/runtime/IPC/persistence/security facts aligned with `docs/current/` and `docs/security/PERMISSION-MATRIX.md`.
- **Electron 41.2.0** with **electron-vite 5** for building
- **Package manager**: pnpm 9
- **Native modules**: `node-pty` (terminal), `sharp` (images) — require node-gyp + Python + Visual Studio on Windows
- **Bundled modules**: `@pi-desktop/shared-types` and `@earendil-works/pi-coding-agent` are explicitly excluded from externalization in electron-vite config (bundled into main/preload)
- **`npmRebuild: false`** in electron-builder.yml — native modules handled separately
- **Electron download mirror**: npmmirror (`https://npmmirror.com/mirrors/electron/`) with local `.electron-cache`
- **`__APP_VERSION__`**: Injected from `package.json` version into renderer via electron-vite `define`
- **Auto-update**: electron-updater (GitHub Releases)

## Environment

- **Node.js**: >= 22.19.0
- **pnpm**: >= 9.0.0
- **OS**: Windows 10/11 (v1.0, macOS/Linux planned for v1.1+)
- **Pi CLI**: Must be installed and on PATH (`@earendil-works/pi-coding-agent`)
- **Pre-commit hooks**: Lefthook runs `typecheck` and `lint` in parallel on commit (see `lefthook.yml`)

## Commit & Branch Conventions

[Conventional Commits](https://www.conventionalcommits.org/): `feat(scope):`, `fix(scope):`, `chore(scope):`, `refactor(scope):`, `test(scope):`, `docs(scope):`

Branches: `master` (stable), `feature/mN-*` (milestones), `fix/<issue>`, `chore/<topic>`

Release: push a `v*.*.*` tag → `.github/workflows/release.yml` builds NSIS installer.

## Quick Verification

```bash
pnpm -r typecheck && pnpm -r lint && pnpm -r test
```

If any step fails, fix before committing.
