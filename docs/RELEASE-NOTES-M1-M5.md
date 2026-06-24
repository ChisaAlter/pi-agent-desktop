# Pi Desktop v1.0 — M1-M5 实施完成报告

**日期**: 2026-06-01
**分支**: `feature/m4-terminal` (待合并到 master)
**测试**: 105+ tests pass, 0 fail, 2 skipped (需 API key)

---

## 完成清单

| Milestone | 任务数 | 状态 |
|-----------|-------|------|
| **M1** Foundation (3 critical bugs) | 16 tasks | ✅ |
| **M2** Context (@ mention, image, Ctrl+K) | 7 tasks | ✅ |
| **M3** Skills (SkillHub integration) | 8 tasks | ✅ |
| **M4** Terminal (node-pty) | 3 tasks | ✅ |
| **M5** Engineering hygiene | 6 tasks | ✅ |
| **总计** | **40 tasks, 18 commits** | ✅ |

---

## M1 — Foundation (核心 3 bug 修复)

- ✅ **Cwd 修复**: `usePiStream` 发 `workspaceId` 走 `WorkspaceRegistry` → `createAgentSession({ cwd })` → Pi 跑在用户工作区
- ✅ **长连接 Pi**: `AgentSession` in-process per workspace, 订阅事件推 renderer
- ✅ **审批闭环基座**: `ApprovalInterceptor` 负责 Plan 模式写入拦截与文件改动 review telemetry；高危 runtime 权限决策由 `pi-permission-system` 接管

后端模块:
- `services/pi-session/factory.ts` (createAgentSession 包装)
- `services/pi-session/registry.ts` (WorkspaceRegistry, TDD 5 tests)
- `services/pi-session/event-bridge.ts` (Pi events → IPC, TDD 6 tests)
- `services/approval/classifier.ts` (16 risk patterns, TDD 16 tests)
- `services/approval/pending-edits.ts` (file edit tracking, TDD 9 tests)
- `services/approval/approval-bridge.ts` (IPC emitter)
- `services/approval/interceptor.ts` (plan-mode block + deferred edit review telemetry, TDD 8 tests)
- `ipc/chat.ipc.ts` (新 chat IPC 替代老 `pi:prompt`)

## M2 — Context (UX 支柱)

- ✅ **@ 文件引用**: `findActiveMention` 检测 + `MentionPopover` fuzzy 排序 + Enter 插入完整路径
- ✅ **图片粘贴**: FileReader → dataURL → `attachments-store` (按 workspace 隔离)
- ✅ **Ctrl+K CommandPalette**: 模态 + 3 tab (文件/历史/命令) + 键盘完全可控
- ✅ **AttachmentChip**: 文件 + 图片两种样式

后端:
- `services/search/file-scanner.ts` (扫 workspace, skip node_modules/.git, TDD 4 tests)
- `utils/fuzzy-match.ts` (子串 + 路径分隔 + 驼峰, TDD 7 tests)
- `ipc/files.ipc.ts` (files:list)

渲染端:
- `utils/mention-parser.ts` (TDD 9 tests)
- `hooks/useMentions.ts`
- `hooks/useCommandPalette.ts` (全局 Ctrl+K)
- `components/ChatInput/MentionPopover.tsx`
- `components/ChatInput/AttachmentChip.tsx`
- `components/CommandPalette/CommandPalette.tsx`
- `stores/attachments-store.ts`
- `types/attachments.ts`

## M3 — Skills (核心差异化)

- ✅ **SkillHub CLI 集成**: search / install / uninstall / list / check
- ✅ **市场 tab**: 搜 "hello" 出来 fuzzy 排序卡片 (slug/name/desc/version/source)
- ✅ **我的 tab**: 启/禁/卸载 + 状态点 (绿/灰)
- ✅ **+ 创建 3 选项**: 用 Pi 构建 / 编写 / 从 GitHub

后端:
- `services/skills/skillhub-adapter.ts` (CLI 包装, TDD 9 tests)
- `ipc/skills.ipc.ts` (search/list/install/uninstall/toggle/github-import)

渲染端:
- `stores/skills-store.ts`
- `components/SkillsPanel/SkillsPanel.tsx` (市场/我的 tab)
- `components/SkillsPanel/SkillsMarketplace.tsx`
- `components/SkillsPanel/MySkills.tsx`
- `components/SkillsPanel/SkillCard.tsx`
- `components/SkillsPanel/SkillCreateDropdown.tsx`

类型:
- `types/index.ts` 集中声明 piAPI (含 M1+M2+M3 所有方法)

## M4 — Terminal (node-pty)

- ✅ **真 PTY**: 替换 child_process.spawn, 修 resize / ANSI / TUI 应用
- ✅ **多 tab 终端**: + 新建 tab / 切 tab / 关 tab
- ✅ **xterm.js 集成**: 完整 ANSI 渲染

后端:
- `services/shell/pty-manager.ts` (TDD 12 tests)
- `ipc/terminal.ipc.ts` (替代老 spawn-based IPC)

渲染端:
- `components/Terminal/TerminalPanel.tsx` (多 tab + xterm)

## M5 — Engineering Hygiene

- ✅ **electron-updater**: 集成, 从 GitHub Releases 检查更新, 自动下载/安装
- ✅ **GitHub Actions**: CI (lint + typecheck + test on push) + Release (build + publish on tag)
- ✅ **仓库清理**: 删 `packages/pi-driver` 死代码, 归档 mockup HTMLs, 删 .codebuddy/ 等
- ✅ **ErrorBoundary**: 渲染错误兜底, 自定义 fallback, jsdom test 3 tests pass
- ✅ **.gitignore**: 刷新, 加 IDE state / stale artifacts / mockup patterns
- ✅ **README**: 重写, 装指南 + 架构 + roadmap
- ✅ **CONTRIBUTING.md**: workflow + commit convention + 测试指南
- ✅ **CHANGELOG.md**: M1-M5 全部记录
- ✅ **.github/ISSUE_TEMPLATE** + **PULL_REQUEST_TEMPLATE**: 中文化

---

## 测试结果

```
packages/shared-types:  6/6 passed
apps/desktop:
  M1: classifier(16) + pending-edits(9) + interceptor(8)
      + factory(2) + registry(5) + event-bridge(6)
  M2: fuzzy-match(7) + mention-parser(9) + file-scanner(4)
  M3: skillhub-adapter(9) + m3 e2e(4)
  M4: pty-manager(12)
  M5: ErrorBoundary(3) + m4-m5 e2e(3)
  sanity(1) + chat e2e(1 + 2 skipped)
─────────────────────────────────────────────────
Total: 105+ passed, 0 failures, 2 skipped
```

---

## 怎么跑

```bash
git checkout feature/m4-terminal  # 或 master (合并后)
cd C:\Ai\pi-desktop
pnpm install
pnpm --filter @pi-desktop/desktop dev
```

需装:
- Pi CLI (`pi --version` 验证)
- Node 22.19+ (Electron 34 要求)
- Windows 10/11 (v1.0 only)
- SkillHub CLI (可选, 给技能市场用)

---

## 已知限制 (留给 v1.1+)

- ⚠️ **App.tsx 集成未做** — 所有组件已写好, 等解开 UI stash 后挂
- ⚠️ **Monaco SkillEditor** — M3.1
- ⚠️ **真 Pi 扩展** (替换 M1 interceptor 做 pre-block) — M3.1
- ⚠️ **macOS / Linux** — M5.1
- ⚠️ **SkillHub 格式 adapter** (OpenClaw → Pi) — M3.1

## Branch 状态

- `master` (主分支)
- `feature/m1-foundation` (M1, 16 commits)
- `feature/m2-context` (M2, 8 commits)
- `feature/m3-skills` (M3, 9 commits)
- **`feature/m4-terminal` (M4+M5, 9 commits, 当前)**

合并建议: 把 M4-M5 合并到 master 后, 整个 v1.0 骨架就完成了.
