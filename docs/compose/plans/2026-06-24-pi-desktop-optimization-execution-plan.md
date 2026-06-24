# Pi Desktop 深度优化执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 2026-06-24 的真实代码审查与真实 Electron 验收，把 Pi Desktop 按 6 个模块完成修复、验证、截图取证和独立提交，最终把核心回归固化为可执行发布闸门。

**Architecture:** 主代理负责基线冻结、模块拆分、代码审查、最终验收和提交；子代理只在独立 worktree 内处理单模块修复。执行顺序采用 “先分治修复，再由 M6 统一补测与发布收口”，避免多个模块同时争抢 `App.tsx`、`usePiStream.ts`、approval 链路等冲突热点。

**Tech Stack:** Electron 41, electron-vite 5, React 19, TypeScript 5, Zustand 5, better-sqlite3, Vitest 4, Playwright, pnpm 9, PowerShell, Windows 10/11

---

## 硬性执行约束

- 所有“测试 / 验收”必须来自真实 Windows Electron 桌面端，不接受纯浏览器替代。
- 每个模块完成后都必须经过：
  1. 主代理代码审查
  2. 模块自动化验证
  3. 真实 Electron 验收
  4. 截图落档到 `docs/compose/acceptance/`
  5. 单模块 commit
- 主工作区 `C:\Ai\pi-desktop` 存在用户脏改动，只允许在独立 worktree 执行实现。
- 模块之间不得直接共享未提交改动；统一通过 commit 基线或明确依赖传递。

## 当前执行状态（2026-06-24）

| 模块 | worktree | 分支 | 状态 | 结果 |
|------|----------|------|------|------|
| M1 | `C:\Ai\pi-desktop-m1` | `codex/m1-session-truth` | Done | commit `2333fd9`，会话持久化 / agent 绑定 / usage 真相源已收口 |
| M2 | `C:\Ai\pi-desktop-m2` | `codex/m2-workspace-routing` | Done | commit `887b36a`，workspace 路由 / 搜索定位 / SessionCenter 可达性已收口 |
| M3 | `C:\Ai\pi-desktop-m3` | `codex/m3-approval-loop` | Done | commit `27f5a62`，权限审批链路与 review 闭环已收口 |
| M4 | `C:\Ai\pi-desktop-m4` | `codex/m4-settings-contract` | Done | commit `efead72`，settings 契约与持久化 round-trip 已收口 |
| M5 | `C:\Ai\pi-desktop-m5` | `codex/m5-search-io-export` | Done | commit `7bee692`，搜索 / 导出 / Git / I/O 优化已收口 |
| M6 | `C:\Ai\pi-desktop-m6` | `codex/m6-release-gate` | Done | 已完成代码、发布闸门、真实 Electron 最终验收与提交收口 |

## 审查结论到模块映射

| 编号 | 风险 | 问题 | 模块 |
|------|------|------|------|
| F01 | Critical | agent 模式消息 / usage 未持久化，重启丢历史 | M1 |
| F02 | High | session 回退到 workspace 默认 agent，产生串线 | M1, M2 |
| F03 | High | 风险分类把可变命令当只读，审批可绕过 | M3 |
| F04 | High | review diff 基线错误，用户看到的不是磁盘真实前后差异 | M3 |
| F05 | High | renderer / main settings schema 漂移，字段保存失败 | M4 |
| F06 | Medium | 主进程同步 I/O 过多，文件 / Git 路径易卡 UI | M5 |
| F07 | Medium | dotfiles / dotdirs 默认隐藏过多，关键工程文件不可见 | M5 |
| F08 | Low | `workspace:select` 基本空实现，recent / `lastActiveAt` 不可信 | M2 |
| F09 | Medium | 历史搜索只能切 session，不能跳到具体消息 | M2 |
| F10 | Medium | SessionCenter / GUI 导出未真正接入主应用 | M2, M5 |
| F11 | Low | 命令候选暴露桌面端并不支持的命令 | M2, M5 |
| F12 | High | 文件变更审批链路未闭环，renderer 订阅与操作入口不完整 | M3 |
| F13 | High | ToolPermissions UI 改了，但主路径几乎不生效 | M3 |
| F14 | Medium | `agent-store` / `session-store` 分裂已外溢到导出和统计 | M1 |
| F15 | Medium | 测试把错误行为固化为预期，形成假绿回归 | M6 |

## 并行执行矩阵

| 模块 | 主题 | 启动条件 | 可并行关系 | 推荐执行者 |
|------|------|----------|------------|------------|
| M1 | 会话真相源与持久化统一 | P0 完成 | 可与 M3、M4 并行 | 子代理 A |
| M2 | 工作区路由 / 历史定位 / 入口收口 | M1 稳定后 | 可与 M5 补 UI 切片并行 | 子代理 B |
| M3 | 权限审批链路闭环 | P0 完成 | 可与 M1、M4 并行 | 子代理 C |
| M4 | Settings 契约统一 | P0 完成 | 可与 M1、M3 并行 | 子代理 D |
| M5 | 文件 / Git / 搜索 / 导出 / I/O 优化 | P0 完成 | 基础切片可与 M1/M4 并行 | 子代理 E |
| M6 | 测试纠偏 / 发布闸门 / 最终验收 | M1-M5 完成后收口最佳 | 与模块补测切片并行，但最终收口由主代理负责 | 主代理 |

## 子代理统一协议

每个模块子代理必须拿到以下固定上下文：

1. 模块编号与问题编号，例如 `M2 / F08 F09 F10 F11`
2. 指定 worktree 与分支名
3. 允许修改的文件白名单
4. 禁止触碰的主工作区脏文件与其他模块冲突热点
5. 模块测试命令、实机验收步骤、截图命名规则、建议 commit message

主代理在子代理返回后固定执行：

1. 代码审查
2. targeted tests + `build`
3. 真实 Electron 验收 + 截图
4. 单模块提交

### 子代理 dispatch 模板

```text
模块：M3
问题编号：F03 F04 F12 F13
工作区：C:\Ai\pi-desktop-m3
分支：codex/m3-approval-loop
允许修改文件：<本模块白名单>
禁止碰触：C:\Ai\pi-desktop 主工作区脏改动；未授权的其他模块热点文件
必须完成：
1. 先确认问题在代码里真实存在
2. 只修本模块范围
3. 跑模块验证命令
4. 用真实 Electron 验收并生成截图
5. 给出建议 commit message，等待主代理复审后提交
```

## 冲突热点

| 文件 | 涉及模块 | 协调要求 |
|------|----------|----------|
| `apps/desktop/src/renderer/src/App.tsx` | M2, M3 | M3 先只接权限事件链路，M2 再统一入口/路由接线 |
| `apps/desktop/src/renderer/src/hooks/usePiStream.ts` | M1, M3, M6 | M1 先定义 session 真相源，M6 只补测试和回归 |
| `packages/shared-types/src/index.ts` | M1, M4 | 先统一契约，再做字段扩展 |
| `apps/desktop/src/renderer/src/shortcuts/registry.ts` | M2, M5 | M2 处理入口可达性，M5 处理能力矩阵收口 |

## 模块定义

### M1 会话真相源与持久化统一

**问题范围：** F01, F02, F14  
**目标：** 让 session、agent、usage、history search、export 都建立在同一份持久化真相源上。  
**关键文件：**
- `apps/desktop/src/renderer/src/stores/session-store.ts`
- `apps/desktop/src/renderer/src/stores/agent-store.ts`
- `apps/desktop/src/renderer/src/hooks/usePiStream.ts`
- `apps/desktop/src/main/services/session-store.ts`
- `apps/desktop/src/main/services/session-sqlite.ts`
- `apps/desktop/src/main/services/pi-session/registry.ts`
- `apps/desktop/src/main/services/pi-session/event-bridge.ts`

**完成定义：**
- agent 会话消息、tool 事件、usage 能持久化
- workspace 切换后不再串默认 agent
- 重启后历史和 usage 仍在

**验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/renderer/src/hooks/usePiStream.test.tsx
pnpm --filter @pi-desktop/desktop test src/renderer/src/stores/__tests__/session-store.test.ts
pnpm --filter @pi-desktop/desktop test src/renderer/src/stores/__tests__/agent-store.test.ts
pnpm --filter @pi-desktop/desktop build
```

**截图：**
- `2026-06-24-m1-01.png`
- `2026-06-24-m1-02.png`
- `2026-06-24-m1-03.png`

**提交：** `fix(session): unify persisted history and active agent state`

### M2 工作区路由、历史定位与未接线功能收口

**问题范围：** F08, F09, F10, F11  
**目标：** 让 workspace 切换、历史搜索、SessionCenter、导出入口、命令候选都成为真实可达功能。  
**关键文件：**
- `apps/desktop/src/renderer/src/App.tsx`
- `apps/desktop/src/renderer/src/stores/workspace-store.ts`
- `apps/desktop/src/main/ipc/workspace.ipc.ts`
- `apps/desktop/src/renderer/src/components/SearchHistory/SearchHistory.tsx`
- `apps/desktop/src/renderer/src/components/SessionCenter/SessionCenter.tsx`
- `apps/desktop/src/renderer/src/shortcuts/registry.ts`

**完成定义：**
- `workspace:select` 更新 recent 与 `lastActiveAt`
- 搜索结果能跳到具体消息
- SessionCenter / GUI 导出入口从主应用真实可达
- 桌面端不支持的命令不再暴露

**验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/renderer/src/stores/__tests__/workspace-store.test.ts
pnpm --filter @pi-desktop/desktop test src/renderer/src/components/SessionCenter/SessionCenter.test.tsx
pnpm --filter @pi-desktop/desktop build
```

**截图：**
- `2026-06-24-m2-01-workspace-switch.png`
- `2026-06-24-m2-02-session-center.png`
- `2026-06-24-m2-03-search-result.png`
- `2026-06-24-m2-04-message-jump.png`

**提交：** `fix(workspace): wire navigation, history jump and export entrypoints`

### M3 权限审批链路闭环

**问题范围：** F03, F04, F12, F13  
**目标：** 让高风险调用经过真实审批，让 deferred edit review 与 ToolPermissions 真正落在主路径。  
**关键文件：**
- `apps/desktop/src/main/services/approval/classifier.ts`
- `apps/desktop/src/main/services/approval/interceptor.ts`
- `apps/desktop/src/main/services/approval/pending-edits.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/src/App.tsx`
- `apps/desktop/src/renderer/src/components/ApprovalPanel/`

**完成定义：**
- 高风险请求有真实审批卡片
- diff review 显示真实 before/after
- approve / reject / remove 入口闭环
- ToolPermissions 对 active/new agent 生效

**验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/approval/__tests__/classifier.test.ts
pnpm --filter @pi-desktop/desktop test src/main/services/approval/__tests__/interceptor.test.ts
pnpm --filter @pi-desktop/desktop test src/main/services/approval/__tests__/pending-edits.test.ts
pnpm --filter @pi-desktop/desktop build
```

**截图：**
- `2026-06-24-m3-01.png`
- `2026-06-24-m3-02.png`
- `2026-06-24-m3-03.png`

**提交：** `fix(approval): close permission and review loop`

### M4 Settings 契约统一

**问题范围：** F05  
**目标：** 对齐 shared types、renderer store、main schema、IPC 和持久化字段，让 settings 能稳定 round-trip。  
**关键文件：**
- `packages/shared-types/src/index.ts`
- `apps/desktop/src/main/ipc/schemas.ts`
- `apps/desktop/src/main/ipc/settings.ipc.ts`
- `apps/desktop/src/renderer/src/stores/settings-store.ts`
- `apps/desktop/src/renderer/src/components/Settings/`

**完成定义：**
- `thinkingLevel` / `showThinking` / `vision*` 等字段可保存、恢复、迁移
- settings window 和主界面共用同一配置契约

**验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/renderer/src/stores/__tests__/settings-store.test.ts
pnpm --filter @pi-desktop/desktop test src/main/ipc/__tests__/settings.ipc.test.ts
pnpm --filter @pi-desktop/desktop build
```

**截图：**
- `2026-06-24-m4-01.png`
- `2026-06-24-m4-02.png`
- `2026-06-24-m4-03.png`

**提交：** `fix(settings): align renderer and main config contract`

### M5 文件 / Git / 搜索 / 导出 / I/O 优化

**问题范围：** F06, F07, F10, F11  
**目标：** 打通关键 dotfiles 可见性，降低主进程阻塞 I/O，收口 GUI 导出与 Git/文件能力。  
**关键文件：**
- `apps/desktop/src/main/services/search/file-scanner.ts`
- `apps/desktop/src/main/ipc/files.ipc.ts`
- `apps/desktop/src/main/ipc/git.ipc.ts`
- `apps/desktop/src/main/services/git-service.ts`
- `apps/desktop/src/renderer/src/components/FileWorkspace/FileWorkspace.tsx`
- `apps/desktop/src/renderer/src/components/SessionExport/SessionExportDialog.tsx`

**完成定义：**
- `.env` / `.github` / `.vscode` 等关键文件可按策略搜索
- 文件 / Git 面板在真实仓库下不再明显卡顿
- GUI 导出路径与提示文案、能力暴露一致

**验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/search/__tests__/file-scanner.test.ts
pnpm --filter @pi-desktop/desktop test src/main/services/git-service.test.ts
pnpm --filter @pi-desktop/desktop build
```

**截图：**
- `2026-06-24-m5-01-dotfile-search.png`
- `2026-06-24-m5-02-file-git-panel.png`
- `2026-06-24-m5-03-batch-export.png`

**提交：** `perf(search): expose critical files and reduce blocking io`

### M6 测试体系纠偏、发布闸门与最终验收

**问题范围：** F15  
**目标：** 清除假绿测试，补齐真实 Electron 回归，把 M1-M5 的结果固化进 CI 与 release gate。  
**关键文件：**
- `.github/workflows/ci.yml`
- `apps/desktop/package.json`
- `scripts/smoke-main-runtime.cjs`
- `apps/desktop/e2e/m6-final-electron-acceptance.spec.ts`
- `apps/desktop/src/renderer/src/hooks/usePiStream.test.tsx`
- `apps/desktop/e2e/chat-view.spec.ts`
- `apps/desktop/e2e/file-and-git.spec.ts`
- `apps/desktop/e2e/plan-mode-current-ui.spec.ts`
- `apps/desktop/e2e/session-center.spec.ts`
- `apps/desktop/e2e/session-history.spec.ts`
- `apps/desktop/e2e/smoke.spec.ts`
- `apps/desktop/e2e/visual-audit.spec.ts`

**当前状态：**
- 已补 `smoke:main-runtime`，改成只读加载编译产物并校验 IPC / `localfile` protocol 注册
- 已新增 `e2e:release-gate`，把 session 持久化、command palette、最终 Electron 验收接进 CI
- 已新增 `m6-final-electron-acceptance.spec.ts`，覆盖持久化、workspace、权限审批、settings、files/git/export 五大终态
- 已翻正一批 stale E2E 断言，避免把旧 UI 或错误行为固化为预期
- 已生成 `2026-06-24-m6-01..05` 五张真实 Electron 截图
- 已完成最终验证：`typecheck`、`lint`、`test`、`build`、`smoke:main-runtime`、`e2e:release-gate`、完整 `e2e` 全通过

**最终验证：**
```powershell
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @pi-desktop/desktop build
pnpm --filter @pi-desktop/desktop smoke:main-runtime
pnpm --filter @pi-desktop/desktop e2e:release-gate
pnpm --filter @pi-desktop/desktop e2e
```

**截图：**
- `2026-06-24-m6-01-session-persisted.png`
- `2026-06-24-m6-02-workspace-history.png`
- `2026-06-24-m6-03-permission-approval.png`
- `2026-06-24-m6-04-settings-persisted.png`
- `2026-06-24-m6-05-files-git-export.png`

**提交：** `test(release): align desktop regression gates with real behavior`

## 推荐执行波次

1. **Wave 0**：冻结基线、隔离 worktree、统一截图与提交规范
2. **Wave 1**：并行完成 M1 / M3 / M4
3. **Wave 2**：在前置基线稳定后完成 M2 / M5
4. **Wave 3**：由 M6 补测、接入 CI 发布闸门、完成最终全量回归

## 每模块统一完成定义

- [ ] 代码只覆盖本模块范围
- [ ] 主代理完成代码审查
- [ ] 模块验证命令通过
- [ ] 真实 Electron 验收通过
- [ ] 截图证据已落档
- [ ] 使用 Conventional Commit 单独提交

## 当前收口判断

这份计划已经从“待执行蓝图”变成“6 个模块全部落地并完成验证”的执行记录。当前真实现场下，剩余动作只剩集成/合并层面的后续处理；模块级任务本身已经完成。
