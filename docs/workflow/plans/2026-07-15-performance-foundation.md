# Pi Desktop Performance Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use workflow:subagent-driven-development or workflow:executing-plans. Keep tests focused on changed behavior.

**Goal:** Replace full-history session persistence and eliminate the highest-frequency renderer/main-thread latency sources.

**Architecture:** A `SessionRepository` async boundary backed by `node:sqlite` becomes the only session persistence backend. Renderer startup consumes summaries and loads transcripts on demand. Independent UI and main-thread hot paths are optimized in parallel.

**Tech Stack:** Electron 41, Node `node:sqlite`, React 19, Zustand 5, TypeScript 5, Vitest 4, Playwright Electron.

## Global Constraints

- Existing electron-store session data is intentionally discarded.
- Do not introduce `better-sqlite3` or another native dependency.
- Do not keep a legacy backend or dual-write path.
- Preserve current IPC error shapes and existing session mutation channel names.
- Keep tests targeted during implementation; run the complete repository gates once at the end.

---

### Task 1: SQLite Session Repository And Cutover

**Files:**
- Create: `apps/desktop/src/main/services/session-repository.ts`
- Create: `apps/desktop/src/main/services/sqlite-session-repository.ts`
- Create: `apps/desktop/src/main/services/__tests__/sqlite-session-repository.test.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/ipc/sessions.ipc.ts`
- Modify: `apps/desktop/src/main/services/subagent/session-summary-service.ts`
- Modify: `apps/desktop/src/main/services/diagnostics.ts`

**Produces:** Async repository CRUD, summaries, FTS search, health, backup, and clean electron-store cutover.

- [ ] Write repository tests for empty initialization, CRUD, message fidelity, row-level updates, search, and cutover.
- [ ] Run the focused repository test and verify it fails because the repository does not exist.
- [ ] Implement schema, prepared statements, transactions, backup/recovery, and repository interface.
- [ ] Inject the repository into IPC and main-process consumers; remove session reads from electron-store.
- [ ] Run repository, sessions IPC, subagent summary, and diagnostics tests.

### Task 2: Summary-First Renderer Session Loading

**Files:**
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/preload/__tests__/preload-surface.test.ts`
- Modify: `apps/desktop/src/renderer/src/stores/session-store.ts`
- Modify: `apps/desktop/src/renderer/src/stores/__tests__/session-store.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/SearchHistory/SearchHistory.tsx`
- Modify: `apps/desktop/src/renderer/src/components/SessionCenter/SessionCenter.tsx`
- Modify: `apps/desktop/src/renderer/src/components/SessionExport/SessionExportDialog.tsx`

**Consumes:** Task 1 repository summary/get/search APIs.

- [ ] Write focused store tests proving summaries do not contain transcripts and stale on-demand loads are ignored.
- [ ] Add shared summary/search contracts and preload methods.
- [ ] Convert session store startup to summaries plus most-recent transcript loading.
- [ ] Move history search to IPC and fetch full sessions only for open/continue/export.
- [ ] Run renderer session, SearchHistory, SessionCenter, export, and preload tests.

### Task 3: Frame-Bounded Streaming Rendering

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/usePiStream.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/usePiStream.debounce.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatView/ChatView.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ChatView/MessageBubble.tsx`
- Modify: related focused tests only when required.

- [ ] Add a fake-animation-frame test proving multiple deltas produce one visible update.
- [ ] Buffer text/thinking state and flush once per animation frame; force flush at turn completion.
- [ ] Use lightweight text for the active streaming message and Markdown after completion.
- [ ] Replace per-delta smooth scrolling with near-bottom frame-bounded instant scrolling.
- [ ] Run focused stream and ChatView tests.

### Task 4: Async Git And Lazy File Tree

**Files:**
- Modify: `apps/desktop/src/main/ipc/git.ipc.ts`
- Modify: `apps/desktop/src/main/ipc/__tests__/git.ipc.test.ts`
- Modify: `apps/desktop/src/main/file-tree.ts`
- Modify: `apps/desktop/src/main/file-tree.test.ts`
- Modify: `apps/desktop/src/main/ipc/files.ipc.ts`
- Modify: `apps/desktop/src/renderer/src/components/FileWorkspace/FileWorkspace.tsx`
- Modify: focused FileWorkspace tests.

- [ ] Add tests that reject synchronous child-process/filesystem calls in production handlers.
- [ ] Convert Git reads to async `execFile` and deduplicate identical in-flight reads.
- [ ] Add async one-level directory listing and retain an async recursive compatibility API.
- [ ] Load directory children on expansion and remove duplicate save-triggered refreshes.
- [ ] Run focused Git, file-tree, files IPC, and FileWorkspace tests.

### Task 5: Hidden Surface And Terminal Lifecycle

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Settings/SettingsContent.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Settings/tabs/UsageTab.tsx`
- Modify: `apps/desktop/src/main/ipc/settings-window.ipc.ts`
- Modify: `apps/desktop/src/renderer/src/components/MiniMaxCode/RightRail.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Workbench/WorkbenchPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/Terminal/TerminalPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/globals.css`
- Modify: focused component tests.

- [ ] Add tests proving collapsed/hidden surfaces produce no initial IPC and terminal bursts are frame-bounded.
- [ ] Lazy-load selected Settings tabs and make UsageTab fetch summaries directly.
- [ ] Hide and reuse the Settings BrowserWindow instead of destroying it.
- [ ] Gate right-rail/panel effects on visibility.
- [ ] Buffer terminal React state updates per frame and remove universal press scaling.
- [ ] Run focused Settings, RightRail, Terminal, Workbench, and App tests.

### Task 6: Integration And Verification

- [ ] Run `corepack pnpm -r typecheck`.
- [ ] Run `corepack pnpm -r lint`.
- [ ] Run `corepack pnpm -r test`.
- [ ] Run `corepack pnpm --filter @pi-desktop/desktop build`.
- [ ] Run targeted Electron E2E for chat, session history, Settings, Git/files, and terminal.
- [ ] Re-run timing probes and compare settings open, session writes, and main responsiveness.
- [ ] Review the full branch diff for regressions and unintended scope.
