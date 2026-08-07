# Architecture

> **Current architecture.** For version, runtime, persistence, security, and QA status, start with [facts.md](facts.md) and follow the linked current documents.

## Process boundaries

```text
Renderer (React)
    │ typed contextBridge APIs
Preload (window.piAPI / window.nodeAPI)
    │ ipcMain invoke/send channels
Main process (Electron + Node.js)
    ├── workspace/session registry and Pi SDK AgentSession instances
    ├── permission and approval enforcement
    ├── persistence repositories and long-horizon services
    ├── terminal/PTY, Git/filesystem adapters, updater, diagnostics
    └── bundled Pi extensions, including Compose workflow
```

The renderer is not the security boundary. Main-process handlers validate input, enforce workspace/path rules, call services, and return typed results or structured IPC errors. Preload exposes an allowlisted bridge; it does not expose arbitrary `ipcRenderer`, `require`, or Node filesystem access.

## Main process

The main process creates one `WorkspaceRegistry` and uses it to map workspace IDs to long-lived in-process Pi sessions. Session creation loads the Pi SDK lazily, applies model and extension configuration, installs guarded built-in tools, and optionally opens the native Pi JSONL session for resume. Registry entries install their event bridge and approval interceptor once and dispose them with the session.

The main process also owns:

- BrowserWindow and tray lifecycle, including the independent settings window;
- all 24 IPC handler modules;
- `SqliteSessionRepository` and native Pi session paths;
- permission policy, approval review, protected-path checks, and terminal managers;
- long-horizon services, Compose extension loading, diagnostics, logging, and updater state.

## IPC contract

A new cross-process capability follows this sequence:

1. define or extend the shared type and event contract;
2. validate untrusted renderer arguments with the relevant Zod schema;
3. implement a focused main-process handler module;
4. expose the smallest typed method/event through preload;
5. consume it in the renderer and add handler/bridge tests;
6. run `pnpm verify:docs` when the change affects a documented fact, then run the normal typecheck/lint/test gate.

Request/response uses `ipcMain.handle` and `ipcRenderer.invoke`. Events use explicit channels and unsubscribe functions. Handler failures use the shared structured IPC error contract where the API allows it; do not leak raw stack traces or unbounded external error payloads to the renderer.

## Tool execution and approvals

The runtime policy is computed from the current agent mode plus workspace/session tool settings. It filters active tools before the model can call them and wraps Pi built-ins with execution-time checks. The approval interceptor provides a second, user-facing risk layer:

- read-only calls proceed without a review card;
- ordinary edits can be deferred for diff review and undo;
- high-risk shell commands and protected-path edits are intercepted before execution;
- Plan mode has immutable restrictions that user/session settings cannot relax.

The normal workbench terminal is a separate user-controlled feature. Agent tool restrictions do not turn it into a sandbox.

## Compose architecture

Compose is loaded as a Pi SDK extension. The `workflow` tool accepts `run`, `status`, `wait`, and `cancel` operations; the built-in `compose` workflow executes a fixed phase pipeline:

```text
Brainstorm → Design → Implement → Verify → Review → Report → Merge
```

`WorkflowRunStore` keeps active run snapshots and cancellation state in memory. The executor writes spec/plan/report artifacts, parses a task list and dependencies, topologically batches independent tasks, and uses temporary Git worktrees when the repository supports them. Child agents run through the Pi CLI with `shell: false`, bounded timeouts, and cancellation. Merge is guarded by review readiness, repository cleanliness, and an explicit commit request.

Compose is deliberately degraded rather than pretending to provide unsupported capabilities. No Git/worktree support means sequential implementation; unknown dependencies are reported; cycles are serialized; a dirty primary workspace disables later worktree isolation. Runs and phase state are not persisted across a full application restart.

## Data flow for a chat turn

1. The renderer invokes the typed prompt method with a workspace ID.
2. The main process obtains or creates the workspace session and resolves current mode and tool policy.
3. The Pi SDK receives the message and emits lifecycle/tool events.
4. The interceptor evaluates risky calls; the event bridge normalizes and forwards events to all live windows.
5. Session/message updates are persisted independently of renderer streaming so UI responsiveness does not determine data durability.
6. Turn completion updates long-horizon stop-gates and renderer state.

## Chat chrome layout (current)

The main window is still the three-slot MiniMax shell, but the floating right utility and left collapse behavior are product-facing contracts:

- **Left collapse** is a center-workspace floating control, not a sidebar-only header button. When collapsed, the left rail width is `0` and its border is removed so the center content meets the window edge without a residual seam. Top strips of center panels reserve space for the control; the center column does not keep a full-height empty gutter.
- **Left conversation list** groups by date or workspace. Workspace group headers expose a **+** action that switches workspace then opens a blank new conversation. Session rows show hover actions for only the active hovered/focused row; selected-row highlight is full-width.
- **Right floating rail (chat only)** is a compact **Git 工具** card: changes (`+/-` totals), branch picker, and commit/push. It does not list project files inline. Plan progress appears under the card only when a goal or plan checklist exists.
- **变更** opens `GitChangesOverlay` as a right-side fixed panel inside chat. The panel lists unstaged/changed files with per-file `+/-`, expands inline unified diffs, and does not route to the workbench Git tab. Git status/diff for the rail is cached per workspace for the session and refreshed while the rail is visible (collapsed rail still must not poll).
- **Composer (chat input)** is a fixed-height reference shell portaled into `#pi-global-composer-root` at the bottom of the center column (flex `shrink-0`, opaque). Attachment chips sit **above** the shell as a horizontal rail. Long drafts scroll inside the textarea and must not cover the controls row. Dragging the composer taller shrinks the message list and, when stick-to-bottom, pushes the conversation up rather than overlaying it. Full contract: [composer-layout.md](composer-layout.md).

These surfaces are renderer chrome over existing main-process Git IPC (`git:status`, `git:diff`, branch/commit/push handlers). Behavior changes belong in unit tests under `MiniMaxCode/*` and the right-rail/chat E2E specs; composer geometry changes belong in `ChatInput` unit tests and `e2e/composer-layout.spec.ts`.

## Window and navigation security

The renderer loads the packaged local file surface (or the development localhost surface). Navigation is limited to the current local document or same-origin development URL. New-window requests are denied after optionally opening only `http:`/`https:` URLs through the system shell. External URLs are not loaded into the application renderer.

## Change checklist

When changing architecture, update the narrowest current document:

- process/IPC/runtime behavior: this page and `facts.md`;
- storage or migration behavior: [persistence.md](persistence.md);
- permissions, approvals, protected paths: [../security/PERMISSION-MATRIX.md](../security/PERMISSION-MATRIX.md);
- chat composer geometry / attachment rail / resize vs message list: [composer-layout.md](composer-layout.md) plus this page and `facts.md`;
- test gates or release evidence: [testing-and-qa.md](testing-and-qa.md) and the release guide.

Do not turn a historical plan into a current contract by editing it in place.
