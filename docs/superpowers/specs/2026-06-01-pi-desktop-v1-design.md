# Pi Desktop v1.0 — Design Spec

**Date**: 2026-06-01
**Status**: Draft, pending user review
**Author**: brainstorming session (Mavis + user)

---

## 1. Goal

Ship a polished, open-source Windows desktop GUI for [Pi](https://github.com/earendil-works/pi-coding-agent) that:

- **Looks and feels like** OpenAI Codex Desktop (2025) — light theme, 4-column layout, task panel on the right.
- **Preserves Pi's signature**: free-form extensibility via Skills, Providers, and Plugins.
- **Is safe by default** via tiered tool approval.
- **Is real, not theatre**: every UI element wires to working data flow.

## 2. Non-Goals (v1.0)

- macOS / Linux support (v1.1+).
- Telemetry / cloud sync / account system.
- Marketplace backend we host ourselves.
- Plugin authoring IDE beyond "edit SKILL.md with syntax highlighting".
- Multi-window, multi-account, collaboration features.

## 3. Target User

A developer who:

- Uses Pi CLI today (or wants to).
- Wants a polished GUI instead of a terminal.
- Likes the Codex Desktop UX and wants the same on Pi.
- Adds skills / providers / plugins to Pi to fit their workflow.
- Runs on Windows 10/11.

## 4. Reference Product

OpenAI Codex Desktop (2025). Light theme, 4-column layout, task panel on right, @ file references, integrated terminal, image paste, diff visualization, Git panel, integrated tool approval.

## 5. Architecture

### 5.1 Three layers + one persistent process per workspace

```
┌─────────────────────────────────────────────────────────┐
│ Renderer (React)                                         │
│  ├─ 4-column layout: IconBar | ProjectPanel | Chat |     │
│  │  TaskPanel                                            │
│  ├─ Zustand stores: session, workspace, approval,        │
│  │  skills, settings, tasks, search, ui                  │
│  └─ contextBridge: window.piAPI / window.shellAPI        │
└────────────────┬────────────────────────────────────────┘
                 │ IPC (typed)
┌────────────────┴────────────────────────────────────────┐
│ Main Process (Electron)                                  │
│  ├─ WindowManager       window/tray/hotkeys              │
│  ├─ WorkspaceManager    workspaces metadata + switching  │
│  ├─ PiSessionManager ⭐ 1 long-lived Pi process per WS   │
│  │    ├─ ProcessSupervisor  lifecycle / restart / crash  │
│  │    ├─ EventBridge        JSON event → IPC broadcast   │
│  │    ├─ ApprovalInterceptor tiered tool approval        │
│  │    └─ HistoryBuffer      in-memory + persisted        │
│  ├─ SkillsManager       local scan / enable / install    │
│  ├─ GitService          status/diff/log/blame/undo       │
│  ├─ ShellManager ⭐     node-pty multi-tab terminal      │
│  ├─ FileSearcher        ripgrep + SQLite FTS5            │
│  └─ AutoUpdater         electron-updater → GitHub        │
└────────────────┬────────────────────────────────────────┘
                 │ spawn / pipe
┌────────────────┴────────────────────────────────────────┐
│ External Processes                                       │
│  ├─ pi-coding-agent (1 per workspace, long-lived)        │
│  └─ node-pty shells (PowerShell per terminal tab)        │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Key Decisions

| Decision | Choice | Why |
|---|---|---|
| Pi invocation | Long-lived per workspace | Real multi-turn, real state, cheaper |
| Multi-workspace | Concurrent Pi processes | Independent state, no cross-contamination |
| Pi crash | Auto-restart up to 3×, then dialog | App must survive Pi dying |
| Approval | Tiered (see §7) | Balances safety and friction |
| Session persist | Dual-layer (Pi in-mem + electron-store) | Crash-safe |
| Skills source | Local + SkillHub CLI + GitHub import | No central marketplace to maintain |
| Terminal | node-pty + xterm.js, multi-tab | Real PTY, real TUI apps work |
| Auto-update | electron-updater + GitHub Releases | OSS-standard |
| IPC | Typed contract in `packages/shared-types` | Self-documenting, contributor-friendly |

### 5.3 Failure Modes

- **Pi process OOM/segfault**: Supervisor catches, auto-restart up to 3 attempts, then show "Pi crashed" dialog with log copy button.
- **electron-store corruption**: Back up corrupted file, rebuild empty, surface warning.
- **Workspace path deleted**: Mark as `missing`, do not auto-delete.
- **Same workspace reopened**: Reuse existing Pi process (pid dedup).
- **Offline**: Registry/GitHub/SkillHub API failures degrade silently; do not block startup.

## 6. Key Flows

### 6.1 Chat send (happy path)

```
[Renderer] ChatInput → useChatStore.send(text)
  → ipc: pi:send(workspaceId, text, attachments)
  → [Main] PiSessionManager.sendPrompt(workspaceId, text)
    1. Pull last turn history from HistoryBuffer
    2. Hand to workspace's Pi process stdin
    3. Mark streaming=true
  → Pi process stdout: JSONL events
  → [Main] EventBridge parses:
    - text_delta       → ipc: pi:event → renderer appends to currentMsg
    - thinking_delta   → ipc: pi:event → renderer updates ThinkingBlock
    - tool_execution_start → ApprovalInterceptor.classify()
    - tool_execution_end   → ipc: pi:event (tool card update)
    - turn_end         → streaming=false, HistoryBuffer.flush()
```

### 6.2 Tiered Approval (core innovation)

```
Pi emits tool_execution_start { name, args }
  │
  ▼
ApprovalInterceptor.classify(tool):
  │
  ├─ HIGH_RISK
  │    Hardcoded list (overridable via config):
  │      • bash subcommand contains: rm -rf /, sudo, mkfs, dd,
  │        chmod 777 /, curl|sh, force push, git reset --hard
  │      • write path matches: ~/.ssh/**, ~/.aws/**, /etc/**,
  │        .git/hooks/**, .git/config
  │    Action:
  │      1. Pause Pi process (SIGSTOP on Unix, suspend on Win)
  │      2. ipc: approval:request { risk: 'high', preview, options }
  │      3. Wait for user response
  │      4. On approve: resume Pi (SIGCONT)
  │      5. On reject: kill tool, send cancel to Pi
  │
  ├─ FILE_EDIT (write / edit / multi-file)
  │    Action:
  │      1. Do NOT pause Pi
  │      2. Record in _pendingEdits: { toolCallId, filePath,
  │         oldContent (read before), newContent }
  │      3. ipc: approval:deferred { toolCallId }
  │      4. On tool_execution_end: read latest file → diff →
  │         ipc: approval:review { toolCallId, diff, options:
  │         [Approve | Reject | Undo] }
  │      5. "Undo" = `git checkout -- <file>` (if git repo) or
  │         restore oldContent
  │
  └─ READ_ONLY (read, grep, ls, glob, simple bash)
       Action: do not intercept, just show tool call card.
```

### 6.3 Skills: marketplace + install + manage

**Marketplace tab** (uses SkillHub CLI):
```
[Renderer] SkillsMarketplace
  → ipc: skills:search(query, filter)
  → [Main] exec('skillhub search ' + query), parse output
  → ipc: skills:results → renderer renders cards
  → User clicks Install
  → ipc: skills:install(name)
  → [Main] exec('skillhub install ' + name, cwd=workspace)
  → On success: rescan ~/.pi/agent/skills/ → ipc: skills:updated
```

**My tab** (local skills):
```
ipc: skills:list → rescan ~/.pi/agent/skills/ + .agents/skills/
ipc: skills:toggle(name, enabled) → write .state.json
ipc: skills:uninstall(name) → rm -rf ~/.pi/agent/skills/<name>
```

**+ Create menu** (3 options):
- 💬 **用 Pi 构建** — Opens chat with pre-filled "help me write a skill that does X" prompt.
- ✏️ **编写技能** — Monaco editor with SKILL.md template + live preview pane.
- 🔗 **从 GitHub 导入** — Input GitHub URL → fetch SKILL.md → validate → install.

> **Note**: SkillHub is primarily designed for OpenClaw agent. We need a thin **adapter** in `services/skills/skillhub-adapter.ts` to normalize OpenClaw-format skills into Pi's SKILL.md shape, OR confirm Pi reads them as-is. **Open question — verify during M3.**

### 6.4 Ctrl+K Command Palette

```
Ctrl+K → CommandPalette opens (modal)
  ├─ Mode 1: file search (ripgrep, fuzzy)
  ├─ Mode 2: history search (SQLite FTS5 on all sessions)
  └─ Mode 3: command (new chat, switch workspace, install skill)
  Streaming results back via ipc: search:results
```

### 6.5 Terminal

```
[Renderer] TerminalPanel multi-tab
  → ipc: shell:create(tabId, cwd=workspacePath)
  → [Main] ShellManager.spawn(node-pty, 'powershell.exe', cwd, env)
  → Output streamed: ipc: shell:output { tabId, data }
  → Input: ipc: shell:input(tabId, data)
  → Resize: ipc: shell:resize(tabId, cols, rows) — real PTY resize
  → Close: ipc: shell:close(tabId) → kill

Default 1 terminal tab per workspace, + button to add more.
Ctrl+\` toggles visibility.
```

## 7. UI Structure

### 7.1 Four-Column Layout

```
┌──────┬──────────────┬───────────────────────────┬─────────────┐
│ 48px │ 220px        │ flex-1                    │ 280px       │
│IconBar│ProjectPanel │ Chat (or Skills/Settings) │ TaskPanel   │
│      │  (resizable) │                           │ (collapsible)│
└──────┴──────────────┴───────────────────────────┴─────────────┘
```

- **IconBar (48px)**: chat, skills, terminal, git, settings.
- **ProjectPanel (220px, 180-400 drag range)**: project info + file tree + session list.
- **Center (flex)**: chat / skills / settings (swappable based on IconBar selection).
- **TaskPanel (280px, collapsible)**: live task progress, output links, source citations.

### 7.2 Key Interactions & Hotkeys

| Action | Hotkey | Notes |
|---|---|---|
| Global search | `Ctrl+K` | Command palette |
| New chat | `Ctrl+N` | Current workspace |
| Switch workspace | `Ctrl+P` | Workspace switcher |
| Open skills | `Ctrl+Shift+S` | Jump to Skills page |
| Toggle terminal | `Ctrl+\`` | Already exists |
| Toggle project panel | `Ctrl+B` | Resize-hide |
| Approve high-risk tool | `Y` | When approval dialog is focused |
| Reject high-risk tool | `N` | Same |
| Send message | `Enter` | |
| Newline | `Shift+Enter` | |

### 7.3 Skills Page Layout (matches reference)

```
技能  [市场 | 我的]  [全部 | 官方 | 贡献]  [搜索...]  [热门▾]   [+ 创建]
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ 卡片    │ │ 卡片    │ │ 卡片    │ │ 卡片    │
│ 标题    │ │ 标题    │ │ 标题    │ │ 标题    │
│ 描述    │ │ 描述    │ │ 描述    │ │ 描述    │
│ @作者  │ │ @作者  │ │ @作者  │ │ @作者  │
│ 使用次数│ │ 使用次数│ │ 使用次数│ │ 使用次数│
└─────────┘ └─────────┘ └─────────┘ └─────────┘
... (4-col grid, paginated) ...
```

**+ Create dropdown (when + clicked)**:
- 💬 用 Pi 构建 — chat with Pi to draft skill
- ✏️ 编写技能 — Monaco editor
- 🔗 从 GitHub 导入 — paste URL

## 8. Component Breakdown

### 8.1 Renderer

```
src/renderer/src/
├── App.tsx                          # 4-column shell
├── stores/
│   ├── session-store.ts             # current session + message stream
│   ├── workspace-store.ts
│   ├── approval-store.ts            # tiered queue
│   ├── skills-store.ts              # marketplace + my skills
│   ├── tasks-store.ts               # task panel
│   ├── settings-store.ts
│   ├── search-store.ts              # Ctrl+K state
│   └── ui-store.ts                  # panel visibility, theme
├── components/
│   ├── IconBar/
│   ├── ProjectPanel/
│   ├── ChatView/
│   │   ├── MessageBubble.tsx
│   │   ├── MarkdownRenderer.tsx
│   │   ├── CodeBlock.tsx
│   │   ├── ThinkingBlock.tsx        # collapsible reasoning
│   │   ├── ToolCallCard.tsx
│   │   ├── CommandCard.tsx
│   │   ├── ChatInput.tsx
│   │   ├── AttachmentChip.tsx       # @file / image preview
│   │   └── MentionPopover.tsx       # @ trigger dropdown
│   ├── TaskPanel/
│   │   ├── TaskList.tsx
│   │   ├── OutputStream.tsx
│   │   └── SourceCitations.tsx
│   ├── ApprovalPanel/
│   │   ├── HighRiskModal.tsx        # pre-approval gate
│   │   └── EditReviewList.tsx       # post-approval diff queue
│   ├── SkillsPanel/
│   │   ├── SkillsMarketplace.tsx    # market tab
│   │   ├── MySkills.tsx             # my tab
│   │   ├── SkillCard.tsx
│   │   └── SkillCreateDropdown.tsx
│   ├── SkillEditor/                 # Monaco-based SKILL.md editor
│   ├── Terminal/
│   ├── GitPanel/
│   ├── CommandPalette/              # Ctrl+K
│   ├── Settings/
│   └── common/                      # Button/Input/Dialog/Toast
└── hooks/
    ├── useChatStream.ts
    ├── useApprovalQueue.ts
    ├── useSearch.ts
    └── useWorkspace.ts
```

### 8.2 Main Process

```
src/main/
├── index.ts                         # app bootstrap + DI
├── window-manager.ts
├── ipc/                             # IPC route layer (one file per domain)
│   ├── chat.ipc.ts
│   ├── workspace.ipc.ts
│   ├── approval.ipc.ts
│   ├── skills.ipc.ts
│   ├── git.ipc.ts
│   ├── shell.ipc.ts
│   ├── search.ipc.ts
│   └── settings.ipc.ts
├── services/                        # business logic
│   ├── pi-session/
│   │   ├── manager.ts               # multi-workspace orchestration
│   │   ├── process.ts               # one Pi process lifecycle
│   │   ├── event-bridge.ts          # JSONL → IPC events
│   │   ├── approval-interceptor.ts  # tiered approval
│   │   └── history-buffer.ts
│   ├── skills/
│   │   ├── scanner.ts
│   │   ├── installer.ts
│   │   ├── toggler.ts
│   │   └── skillhub-adapter.ts      # ← verify compat in M3
│   ├── shell/                       # node-pty wrapper
│   ├── git/
│   ├── search/
│   │   ├── file-indexer.ts          # ripgrep
│   │   └── history-indexer.ts       # SQLite FTS5
│   ├── updater.ts                   # electron-updater
│   └── store.ts                     # electron-store schema
└── utils/
    ├── logger.ts
    ├── paths.ts
    └── platform.ts                  # Windows-specific
```

### 8.3 Packages

```
packages/
├── shared-types/                    # cross-process types
│   ├── ipc.ts                       # IPC params/returns
│   ├── events.ts                    # Pi JSON event types
│   ├── pi.ts                        # PiStatus, PiAgentConfig
│   └── approval.ts                  # ApprovalRequest, RiskLevel
└── ui-tokens/                       # design tokens
    └── tailwind-preset.ts
```

> **Cleanup**: `packages/pi-driver/` is dead code (duplicates `apps/desktop/src/main/pi-driver.ts`). **Delete in M5**.

## 9. Data Contracts (typed)

```ts
// packages/shared-types/src/ipc.ts
export interface IpcContract {
  // Chat
  'pi:send':       (workspaceId: string, text: string, attachments: Attachment[]) => void;
  'pi:stop':       (workspaceId: string) => void;
  'pi:event':      PiEvent;                              // main → renderer push
  'pi:history':    (workspaceId: string) => HistorySnapshot;

  // Approval
  'approval:respond':   (requestId: string, decision: 'approve' | 'reject' | 'edit', edit?: string) => void;
  'approval:request':   ApprovalRequest;                 // push
  'approval:deferred':  DeferredEdit;                    // push
  'approval:review':    FileReview;                      // push

  // Skills
  'skills:list':     () => SkillInfo[];
  'skills:search':   (query: string, filter?: SkillFilter) => SkillInfo[];
  'skills:install':  (name: string, source: 'skillhub' | 'github' | 'local') => SkillInfo;
  'skills:toggle':   (name: string, enabled: boolean) => void;
  'skills:uninstall': (name: string) => void;

  // Shell (node-pty terminal)
  'shell:create':  (tabId: string, cwd: string) => void;
  'shell:input':   (tabId: string, data: string) => void;
  'shell:resize':  (tabId: string, cols: number, rows: number) => void;
  'shell:close':   (tabId: string) => void;
  'shell:output':  { tabId: string; data: string };      // push

  // Search
  'search:query':   (q: string, mode: 'file' | 'history' | 'cmd') => void;
  'search:results': SearchResults;                       // push

  // Workspace
  'workspace:list':    () => Workspace[];
  'workspace:select':  (id: string) => void;
  'workspace:create':  (name: string, path: string) => Workspace;
  'workspace:delete':  (id: string) => void;

  // Settings
  'settings:get': () => Settings;
  'settings:set': (patch: Partial<Settings>) => void;
}
```

## 10. Approval Risk Tiers (concrete list)

### 10.1 HIGH_RISK (pre-approval required)

**Bash subcommand matchers**:
- `rm -rf /` or `rm -rf ~` (broad destructive)
- `sudo` any command
- `mkfs`, `dd if=`, `fdisk`
- `chmod 777 /`
- `curl ... | sh` or `wget ... | sh`
- `git push --force` to any branch
- `git reset --hard`
- `npm uninstall -g`
- `pip uninstall` system-wide
- `reg delete` on Windows registry

**Write path matchers** (path-based):
- `~/.ssh/**`
- `~/.aws/**`
- `~/.config/**` (broad config dirs)
- `~/.bashrc`, `~/.zshrc`, `~/.profile`
- `/etc/**`, `C:\Windows\System32\**`
- `.git/hooks/**`, `.git/config`
- `~/.pi/agent/settings.json` (without user-initiated save)

### 10.2 FILE_EDIT (post-approval with undo)

- `write` tool, `edit` tool, multi-file batch tool
- Bash: `> file` (write redirect), `sed -i`, `awk ... > file`

### 10.3 READ_ONLY (no approval)

- `read`, `grep`, `glob`, `ls`, `find` (with limits)
- Bash: query-style commands (`ls`, `cat`, `head`, `tail`, `git status`, `git log`, etc.)

> The classifier is **configurable** in `settings.json` so power users can override.

## 11. Skills Integration Detail

### 11.1 SkillHub CLI

Prereq (documented in README):
```bash
curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash
```

Pi Desktop assumes `skillhub` is on PATH. If missing, the Marketplace tab shows:
> "SkillHub CLI not installed. [Install instructions]"

### 11.2 Adapter Layer

`services/skills/skillhub-adapter.ts` wraps `skillhub` CLI:
```ts
async search(query: string): Promise<SkillInfo[]>
  → exec('skillhub search ' + query)
  → parse output (try JSON first, fallback to table)
  → return normalized SkillInfo[]

async install(name: string, workspacePath: string): Promise<SkillInfo>
  → exec('skillhub install ' + name, { cwd: workspacePath })
  → rescan ~/.pi/agent/skills/<name>/
  → return SkillInfo (validate SKILL.md exists)
```

**Open question**: skillhub installs in OpenClaw format. Verify Pi reads it, or implement format conversion. **Verify in M3 spike.**

### 11.3 Skill Format (Pi standard)

```yaml
# SKILL.md frontmatter
---
name: skill-name
description: One-line description
author: @handle
version: 1.0.0
tags: [category1, category2]
---

# Skill Instructions (markdown body)
...
```

## 12. Distribution & Release

- **Channel**: GitHub Releases, public.
- **Installer**: electron-builder NSIS `.exe` for Windows x64.
- **Auto-update**: `electron-updater` checks GitHub Releases, prompts user, downloads delta, restarts.
- **Versioning**: semver. Each release includes CHANGELOG.md entry.
- **Code signing**: deferred to v1.1 (cost; users get SmartScreen warning first time).
- **Distribution mirrors**: optional in v1.1 (e.g., winget, scoop manifests).

## 13. Engineering Hygiene

### 13.1 Tests

- **Unit (vitest)**: approval classifier, history buffer, IPC contract types, file scanner, electron-store schema.
- **Integration**: PiSessionManager with a mock Pi process (fake JSONL).
- **E2E (Playwright + Electron)**: smoke test for chat send, approval flow, skill install.
- **Manual checklist**: per-release sanity on a fresh Windows VM.

### 13.2 CI

GitHub Actions:
- `ci.yml`: lint + typecheck + unit test on every PR.
- `release.yml`: build installer on tag push → publish to GitHub Release.

### 13.3 Repo Cleanup (M5)

- Delete `packages/pi-driver/` (dead code).
- Move mockup HTMLs to `docs/design-archive/`.
- Delete `ts-errors2.txt`, `app-output.log`.
- Move `test-*.png`, `screenshot-*.png` to `docs/screenshots/`.
- Add `.codebuddy/` to `.gitignore` or commit with content.
- Configure `.gitattributes` for line endings.

### 13.4 Logging & Observability

- `utils/logger.ts` (electron-log) writes to `app.getPath('logs')`.
- Renderer errors caught by ErrorBoundary → main process log.
- "Open logs folder" in Settings → Help.

## 14. Milestone Breakdown

### M1 — Foundation (the 3 critical bugs)

1. **Cwd bug fix**: `pi:prompt` uses `currentWorkspace.path`, not `process.cwd()`.
2. **PiSessionManager rewrite**: long-lived Pi per workspace, persistent IPC, history persistence.
3. **ApprovalInterceptor v1**: tiered classifier, HIGH_RISK pre-approval gate, FILE_EDIT post-approval diff, READ_ONLY pass-through.

### M2 — Context (UX pillars)

1. `@ file` mention parser + popover.
2. Image paste (clipboard + drag).
3. Ctrl+K CommandPalette (file + history + command).
4. AttachmentChip component.

### M3 — Pi特色 (Skills + lifecycle)

1. SkillsPanel + SkillCard (marketplace + my).
2. SkillHub adapter (verify compat).
3. GitHub import flow.
4. Monaco-based SkillEditor.
5. PiStatusPanel polish (already exists, refine).
6. Skill create dropdown with 3 options.

### M4 — Terminal

1. node-pty + xterm.js integration.
2. Multi-tab terminal panel.
3. Resize / colors / TUI apps work.
4. Per-workspace default tab.

### M5 — Engineering hygiene

1. vitest setup, unit tests for core modules.
2. GitHub Actions (ci + release).
3. electron-updater integration.
4. Repo cleanup (delete dead code, archive mockups, fix gitignore).
5. README polish, CONTRIBUTING.md, issue templates.
6. ErrorBoundary in renderer.
7. CHANGELOG.md initial entry.

## 15. Open Questions (resolve before/during implementation)

1. **Does Pi CLI support long-lived process?** — User confirmed yes, but **verify exact invocation flags and protocol during M1 spike**.
2. **Does skillhub install to Pi-compatible path?** — Verify in M3.
3. **Does Pi read OpenClaw-format skills as-is?** — If not, implement converter in `skillhub-adapter.ts`.
4. **What is Pi's exact JSON event format for tool calls?** — We have `tool_execution_start` / `_end` from the existing code, but verify the full schema.
5. **How does Pi handle cancellation mid-tool-call?** — Needed for the approval "reject" path.
6. **What is the rendering performance of node-pty + xterm with large output?** — Spike during M4.

## 16. Out of Scope (v1.0)

- macOS / Linux installers.
- Telemetry / crash reporting server.
- Code signing certificate.
- In-app skill marketplace search by category.
- Voice input.
- AI-generated commit messages.
- Branch switching from Git panel.
- Plugin authoring IDE beyond SKILL.md editor.
- Multi-account / cloud sync.
- Plugin auto-update.

## 17. Success Criteria

v1.0 ships when:

- [ ] All 5 milestones complete.
- [ ] `pnpm test` passes with ≥60% coverage on services/.
- [ ] CI green on every commit to main.
- [ ] Manual smoke test on fresh Windows 10 VM passes.
- [ ] NSIS installer builds and installs cleanly.
- [ ] Auto-update from a previous version works.
- [ ] README has install + usage + screenshots.
- [ ] GitHub repo has issue templates + CONTRIBUTING.md.
- [ ] CHANGELOG.md v1.0.0 entry written.

## 18. References

- OpenAI Codex Desktop (2025) — visual reference.
- Pi CLI: `@earendil-works/pi-coding-agent` (npm).
- SkillHub: https://skillhub.cn.
- electron-vite, React 19, Tailwind 4, Zustand 5 — current stack.
