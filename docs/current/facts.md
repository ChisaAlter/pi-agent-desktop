# Current Facts

> **Authoritative current-state reference.** This page describes the checked-in implementation, not an old roadmap or an intended future state. Verify it with `pnpm verify:docs` before relying on a version-sensitive statement.

## Snapshot

| Fact | Current value |
| --- | --- |
| Workspace and desktop package version | `1.0.14` |
| Electron | `41.2.0` |
| Node.js engine | `>=22.19.0` |
| Package manager | `pnpm@9.0.0` |
| Supported product target | Windows 10/11 x64; the v1 line is Windows-only |
| IPC handler modules | 24 files under the main-process IPC surface |
| CI verification job | `typecheck` → `lint` → `test` → coverage → docs facts → desktop build → main smoke on `windows-latest` |
| Session persistence | `node:sqlite` `DatabaseSync` through `SqliteSessionRepository` |

The root package and `apps/desktop/package.json` carry the same application version. Electron is declared by the desktop package. These values are source facts; release tags and published assets are separate release-state facts.

## Runtime shape

Pi Desktop is an Electron application with three process-facing layers:

1. **Main process** owns lifecycle, windows, IPC handlers, Pi sessions, permissions, persistence, terminal processes, diagnostics, and updater state.
2. **Preload** exposes the typed `window.piAPI`/`window.nodeAPI` bridges through `contextBridge`. It does not give the renderer a general Node.js API.
3. **Renderer** is the React UI. It uses the typed bridge and renderer stores for chat, workspaces, sessions, settings, approvals, workbench surfaces, and updater state.

The 24 main-process IPC modules are the current count. Additions must be wired through shared types, a main handler, the preload bridge, and renderer usage as appropriate.

## Sessions and workspaces

A workspace owns a long-lived in-process Pi `AgentSession`. `WorkspaceRegistry` reuses sessions by workspace, creates the event bridge and approval interceptor once, bounds hot workspaces with an LRU cap, and disposes sessions on shutdown or eviction. The Pi SDK session itself can be reopened from a deterministic native JSONL path when a desktop session is resumed.

Tool calls are handled in the main process. Pi events are normalized and forwarded to the renderer; writes are serialized where the event stream can update the same message concurrently.

## Compose workflow

Compose is implemented as a bundled Pi extension, not only as a prompt label. Its built-in `workflow` tool runs the `compose` workflow through these phases:

`Brainstorm` → `Design` → `Implement` → `Verify` → `Review` → `Report` → `Merge`

The runtime writes a spec, plan, and report under the workspace `docs/compose/` tree. Independent implementation tasks can use temporary Git worktrees and bounded concurrency. If Git/worktree support is unavailable, dependencies are cyclic, or the primary workspace becomes dirty, the runtime degrades to sequential execution and reports that condition. A run has a global deadline (one hour by default), can be cancelled, and only commits when the `commit` option is explicitly requested and the repository preconditions are satisfied.

Known limits are intentional:

- only the built-in `compose` workflow is implemented;
- arbitrary user-supplied JavaScript workflows are not part of the desktop runtime;
- full upstream QuickJS workflow parity and autonomous `dream`/`distill` background agents are not implemented;
- in-memory workflow runs do not survive a full application restart;
- no-Git workspaces cannot use worktree isolation.

When the workflow switches are disabled, Compose can fall back to its prompt/state behavior. Capability reporting and settings must distinguish that fallback from the executable workflow.

## Persistence facts

- `electron-store` persists workspaces, settings, schema metadata, and small runtime records.
- `SqliteSessionRepository` is the active desktop session/message repository. It stores `sessions.db` under Electron `userData`, uses `node:sqlite`, WAL mode, transactions, FTS5-backed message search, health checks, and a `sessions.backup.db` recovery copy.
- Native Pi session JSONL files live under `userData/pi-sessions/` and are opened by the Pi SDK session manager.
- Markdown memory is stored under `userData/memory/` with a `node:sqlite` index. Long-horizon task/goal/checkpoint services use their own main-process stores.

See [persistence.md](persistence.md) for the storage map and recovery behavior.

## Security and permissions

There are two related but distinct controls:

- the runtime policy filters tools and applies immutable mode restrictions in the main process;
- the approval interceptor classifies tool calls as read, edit, or high risk and routes the latter through the desktop review flow.

Plan mode immutably removes generic shell and edit tools while allowing plan-file paths. Workspace/session tool settings are enforced at runtime; path guards protect workspace boundaries and sensitive credential-like paths. The embedded workbench terminal remains user-controlled local execution and is not sandboxed by agent tool permissions.

See [../security/PERMISSION-MATRIX.md](../security/PERMISSION-MATRIX.md) for the operational matrix.

## Verification and release boundaries

The repository CI gate currently runs only:

```text
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

The release workflow additionally builds the desktop bundle, runs the main-runtime smoke check, packages the Windows NSIS installer, and verifies release artifact names. Electron E2E, packaging, and isolated install/upgrade/uninstall checks are separate evidence layers; a green CI gate does not imply all of them passed.

The NSIS isolation gate is currently blocked on the maintained test host: it is not elevated, Windows Sandbox is unavailable, Docker is unavailable, and the host already contains a Pi Desktop installation. Do not run installer, uninstall, or upgrade experiments on that host. Use an isolated Windows Sandbox, disposable VM, or equivalent administrator-controlled environment.

## Chat UI chrome (product facts)

These are checked-in renderer behaviors, not roadmap items:

- Left sidebar collapse control is floating on the **center** workspace; collapsed left rail leaves **no** residual border/gutter seam.
- Right floating rail on chat is a compact **Git 工具** card (changes / branch / commit-or-push). Progress appears only with a plan goal or plan steps.
- Clicking **变更** opens a right-side in-chat changes panel with per-file `+/-` and inline file diffs; it does not navigate to the workbench Git view.
- Workspace-grouped session headers use a **+** control to start a new conversation in that workspace (no trailing count/chevron on the header).
- Git status for the rail is session-cached per workspace and refreshed while the rail is visible; first open may briefly show detecting state instead of “no Git”.
- Chat composer is a **fixed-height opaque** reference shell (95–240px) in `#pi-global-composer-root`. Attachments are a **horizontal rail above** the shell. Textarea and bottom controls must not overlap (small gap, no hard divider). Resizing the composer **pushes** the message list up via flex + stick-to-bottom on `pi:composer-height-change`. See [composer-layout.md](composer-layout.md).

See [architecture.md](architecture.md) for the layout contract and [testing-and-qa.md](testing-and-qa.md) for the unit/E2E coverage expectations.

## Document maintenance rule

Use this directory for current facts. Keep old plans, reports, and release snapshots as historical artifacts with a short `Historical` or `Superseded` banner. Historical text may contain old version numbers or old implementation names; it must not be used as a current architecture or release contract.
