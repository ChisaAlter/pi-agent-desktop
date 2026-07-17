# Pi Desktop Performance Foundation Design

**Date:** 2026-07-15
**Status:** Approved direction, pending written-spec review

## Context

Pi Desktop currently accumulates latency in both Electron execution domains:

- Renderer streaming handles every model delta as multiple React and Zustand updates, then re-runs scrolling and Markdown parsing.
- Main-process session writes rewrite the complete electron-store `sessions` array.
- Git and file-tree IPC perform synchronous process and filesystem work on the Electron main thread.
- Settings, right-rail, terminal, and previously visited panels keep loading or updating data while hidden.

The project is still in development. Existing persisted conversations do not need to be retained. The implementation therefore performs a clean storage cutover instead of carrying a legacy migration or dual-write layer.

## Goals

1. Replace electron-store session persistence with incremental SQLite storage.
2. Stop loading every historical message during normal renderer startup or Settings startup.
3. Bound streaming renderer work to at most one visible update per animation frame.
4. Remove synchronous Git and recursive filesystem work from the Electron main event loop.
5. Pause or defer work for hidden settings tabs, panels, right rail, and terminal views.
6. Preserve existing session features: branching, search, export, archive, tags, usage, tool permissions, generated UI, plans, and tool-call history.
7. Verify improvements with unit tests, integration tests, production build, and real Electron timing probes.

## Non-Goals

- Importing, backing up, or preserving the current electron-store `sessions` data.
- Maintaining a permanent legacy session backend or dual-write compatibility path.
- Moving all SQLite access to a worker thread in this change. Callers use an async repository boundary so ownership can move later without another IPC or renderer rewrite.
- Redesigning the visual appearance of chat, Settings, workbench, or session management.

## Session Repository

Create a main-process `SessionRepository` async interface for summaries, individual sessions, search, CRUD, message writes, tool-call writes, health checks, and shutdown. `SqliteSessionRepository` implements it with the existing Electron/Node `node:sqlite` runtime.

The repository owns `sessions.db` under `app.getPath("userData")` and configures WAL, foreign keys, `synchronous = NORMAL`, bounded WAL checkpoints, prepared statements, transactions, and startup `quick_check`. IPC and other services depend on `SessionRepository`, never directly on `DatabaseSync`.

### Schema

`session_meta` stores schema and storage-cutover markers.

`sessions` stores indexed scalar metadata plus JSON columns for tags, output paths, usage, and tool permissions. It also stores `message_count`, `tool_call_count`, and `first_user_preview` so sidebars and management views never need full transcripts.

`messages` stores session id, ordinal, role, timestamp, parent id, content, thinking, and `payload_json`. The payload contains the complete normalized `Message`, including generated UI, custom cards, plan actions, and tool calls. Unique `(session_id, ordinal)` preserves ordering.

`message_fts` is an FTS5 index over content and thinking. Triggers synchronize it on message insert, update, and delete. Tool calls remain in `payload_json`; updating one tool call reads and rewrites one message row, avoiding a second schema that would drift with the shared type.

### Clean Cutover

Increase the electron-store schema version. On first startup after the change:

1. Initialize and health-check `sessions.db`.
2. Clear the electron-store `sessions` array.
3. Set `sessionStorage = "sqlite-v1"`.
4. Never read session data from electron-store again.

There is no legacy import or dual write. Existing conversations disappear as explicitly accepted for this development-stage cutover.

Future SQLite data is protected separately. On clean shutdown, checkpoint WAL and refresh `sessions.backup.db`. If the primary database fails `quick_check`, quarantine it and validate the backup before restoring. If both are invalid, start a new empty database and report the recovery in diagnostics and logs.

## IPC And Loading

Add typed APIs while retaining current mutation channel names:

- `listSessionSummaries(): Promise<SessionListItem[]>`
- `getSession(id: string): Promise<Session | IpcError>`
- `searchSessionMessages(input): Promise<SessionSearchResult[] | IpcError>`
- `listSessions(): Promise<Session[]>` remains for compatibility and diagnostics, but normal UI startup does not call it.

`SessionListItem` includes session metadata, counts, and preview, but no messages. The renderer loads summaries first and then the most recently active session. Other sessions keep `messages: []` and an explicit `messagesLoaded: false` local flag. Selecting, continuing, searching within, or exporting a session calls `ensureSessionLoaded(id)`.

Session Center uses summary counts and previews. Text queries use SQLite search instead of iterating renderer history. Export fetches only selected sessions. Settings Usage reads summaries directly and does not import or initialize the global session store.

Main-process consumers move to the repository:

- Agent permissions use a small cache hydrated from summaries and updated after metadata writes.
- Judge transcript lookup queries the newest relevant session.
- Subagent summary tools query repository summaries and messages.
- Diagnostics consume repository counts and health output rather than complete sessions.

## Streaming Rendering

`usePiStream` accumulates authoritative text and thinking in refs. Deltas schedule one animation-frame flush. A frame may update hook state, agent state, and the current session once regardless of delta count.

Persistence is separately debounced; each flush updates one SQLite message row. Turn completion forces renderer and persistence buffers to flush before final state.

While the active assistant message streams:

- Render lightweight pre-wrapped text instead of Markdown/highlighting.
- Replace repeated smooth scrolling with frame-bounded instant scrolling only when the user is near the bottom.
- Render full Markdown after streaming completes.
- Use Zustand selectors instead of subscribing ChatView to the complete session store.

## Main-Thread I/O

### Git

Replace `execFileSync` with promise-based `execFile`. Deduplicate status and diff reads by workspace/path. Serialize mutations per workspace and invalidate relevant read caches after completion.

### File Tree

Add async one-level directory listing. FileWorkspace loads the root first and children only when a directory expands. Protected-path checks, ignore rules, entry limits, and deterministic directory-first sorting remain. The recursive compatibility channel becomes asynchronous and production UI stops requesting a depth-five tree on mount or after every save.

## Hidden Surfaces

### Settings

- Convert settings tabs to `React.lazy` modules and mount only the selected tab.
- UsageTab requests summaries only when activated.
- Keep the Settings BrowserWindow alive and hidden after close; destroy it during application shutdown.

### Panels And Right Rail

- Retained panels receive an `active` flag and stop effects, polling, and IPC while inactive.
- A collapsed right rail performs no Git status, diff, or project-detection request.
- Expanding it starts one snapshot and visible-only polling.

### Terminal

- xterm remains the visual output owner.
- Keep output history in a bounded ring buffer/ref.
- Update React tab state at most once per animation frame.
- Hidden terminal views buffer output without triggering React renders.

### Press Feedback

Remove transform/scale from the universal interactive-element rule. Apply restrained press feedback only to explicit motion-control classes instead of globally scaling every button and tab to `0.96`.

## Error Handling

- Repository errors become existing structured `IpcError` values at IPC boundaries.
- Optimistic renderer writes retain the persistence banner and toast behavior.
- Failed on-demand loads keep the previous active session visible and expose retry.
- Git and file-tree requests discard stale responses through request ids or abort signals.
- Settings and right-rail requests stop or ignore completion after hide/collapse.

## Tests

Repository tests cover schema initialization, CRUD, metadata fidelity, idempotent append, ordering, partial updates, full complex-message round trips, concurrent writes, FTS, cascades, fork metadata, backup recovery, and proof that electron-store sessions are cleared and no longer queried.

IPC and renderer tests cover summary payload size, on-demand session loading, stale-load protection, search/export loading boundaries, UsageTab isolation, frame-bounded streaming updates, streaming Markdown bypass, hidden-surface inactivity, terminal burst buffering, async Git, and lazy directory expansion.

## Verification

Run in order:

1. `corepack pnpm -r typecheck`
2. `corepack pnpm -r lint`
3. `corepack pnpm -r test`
4. `corepack pnpm --filter @pi-desktop/desktop build`
5. Targeted real Electron E2E for chat, history/search/export, Settings, Git, files, and terminal.

Acceptance requires frame-bounded streaming commits, row-level message writes, no complete-history request from Settings, zero collapsed-rail Git IPC, no synchronous Git/filesystem APIs in production paths, and frame-bounded terminal React updates.

## Delivery Order

1. SQLite repository, clean cutover, and repository-backed main consumers.
2. Summary/on-demand IPC and renderer session-store conversion.
3. Streaming batching, lightweight streaming rendering, and scroll control.
4. Async Git and lazy file tree.
5. Settings, right rail, panel, terminal, and press-feedback lifecycle fixes.
6. Full verification and real Electron performance comparison.
