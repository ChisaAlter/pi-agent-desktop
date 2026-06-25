# Pi Desktop 深度优化执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 2026-06-24 的两轮真实代码审查，分模块修复 Pi Desktop 的会话一致性、工作区路由、审批闭环、Settings 契约、搜索/导出/I/O 体验和测试闸门，形成可并行执行、可实机验收、可独立提交的优化路线。

**Architecture:** 先冻结执行前置基线和 worktree 隔离，再按 6 个模块分治推进。模块内统一遵循“真实数据链路优先，其次 UI 接线，再补测试和实机验收”的顺序；模块间通过依赖矩阵控制并行，所有合并均由主代理做最终代码审查和集成验收。

**Tech Stack:** Electron 41, electron-vite 5, React 19, TypeScript 5, Zustand 5, better-sqlite3, Vitest 4, Playwright, pnpm 9, PowerShell, Windows 10/11

---

## 当前执行状态（2026-06-24）

| 项目 | 状态 | 证据 |
|------|------|------|
| 执行目标 | Active | 当前线程已存在目标：按 6 个模块推进修复优化，并要求每模块完成代码审查、自动化验证、Windows 实机 Electron 验收截图和独立提交 |
| 主工作区基线 | 已确认 | `master` 本地 `ahead 2`；本地脏改动在 `classifier.ts`、`classifier.test.ts`、`App.tsx`、`apps/desktop/nul`，另有本计划文档未跟踪 |
| M1 worktree | 已完成 | `C:\Ai\pi-desktop-m1` / `codex/m1-session-truth` / commit `2333fd9` |
| M1 验证 | 已完成 | 模块级审查、自动化验证、Windows 实机 Electron 验收与截图、单模块提交均已完成 |
| M3 worktree | 已完成 | `C:\Ai\pi-desktop-m3` / `codex/m3-approval-loop` / commit `27f5a62` |
| M3 验证 | 已完成 | `pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r test`、`pnpm --filter @pi-desktop/desktop build` 已通过；真实 Electron 验收截图保存在 `docs/compose/acceptance/2026-06-24-m3-0*.png` |
| M4 worktree | 已完成 | `C:\Ai\pi-desktop-m4` / `codex/m4-settings-contract` / commit `efead72` |
| M4 验证 | 已完成 | `typecheck`、`lint`、`test`、`build`、真实 Electron Playwright 验收已跑通，并保留 3 张截图 |
| M2 | 已完成 | `C:\Ai\pi-desktop-m2` / `codex/m2-workspace-routing` / commit `887b36a`；workspace 选择持久化、SessionCenter 主路由、history message jump、desktop slash 过滤均已落地 |
| M2 验证 | 已完成 | `pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r test`、`pnpm --filter @pi-desktop/desktop build`、`pnpm exec playwright test e2e/m2-workspace-routing-acceptance.spec.ts` 全通过；4 张真实 Electron 截图保存在 `docs/compose/acceptance/2026-06-24-m2-0*.png` |
| M5 | Done | `C:\Ai\pi-desktop-m5` / `codex/m5-search-io-export` / commit `7bee692`；关键 dotfiles 可见策略、异步 I/O、`/export` 真实成功语义、FileWorkspace 搜索结果打开、批量导出状态复位均已落地 |
| M5 验证 | 已完成 | `pnpm -r typecheck`、`pnpm -r lint`、`pnpm -r test`、`pnpm --filter @pi-desktop/desktop build`、`pnpm --filter @pi-desktop/desktop exec playwright test e2e/m5-search-io-export-acceptance.spec.ts` 全通过；真实 Electron 截图保存在 `docs/compose/acceptance/2026-06-24-m5-0*.png` |
| M6 | Pending | 继续作为最终回归、截图、发布闸门收口模块，建议在 M2/M5 收敛后启动 |

## 审查输入映射

| 编号 | 级别 | 审查结论 | 归属模块 |
|------|------|----------|----------|
| F01 | Critical | agent 模式会话历史没有进入持久化，重启后会丢消息/usage | M1 |
| F02 | High | 当前 session 会回退到 workspace 默认 agent，存在会话串线 | M1, M2 |
| F03 | High | 风险分类器把可变命令误判为只读，审批可被绕过 | M3 |
| F04 | High | 审批 review diff 基线错误，用户看到的不是真实前后差异 | M3 |
| F05 | High | Settings 类型与主进程 schema 漂移，`thinkingLevel` / `showThinking` / `vision*` 保存失败 | M4 |
| F06 | Medium | 主进程存在过多同步 I/O，文件/Git 路径会卡 UI | M5 |
| F07 | Medium | 文件搜索默认隐藏大量 dotfiles/dotdirs，关键工程文件不可发现 | M5 |
| F08 | Low | `workspace:select` 基本空实现，recent / `lastActiveAt` 不可信 | M2 |
| F09 | Medium | 历史搜索只能切到 session，不能定位到具体 message | M2 |
| F10 | Medium / Low | `SessionCenter` / GUI 多格式导出功能未接入主应用，属于死功能 | M2, M5 |
| F11 | Low | slash command 候选暴露大量桌面端并不支持的命令 | M2, M5 |
| F12 | High | 文件变更审批链路基本未闭环：renderer 未真实订阅，approve/reject/remove 无完整入口 | M3 |
| F13 | High | ToolPermissions UI 改了，但默认 agent 主路径几乎不生效 | M3 |
| F14 | Medium | `agent-store` / `session-store` 分裂已外溢到导出、历史搜索、usage 统计 | M1 |
| F15 | Medium | 多处测试把错误行为固化为预期，形成回归假绿 | M6（并渗透到 M1/M3/M4） |

## 当前执行风险

- 当前工作区不是干净状态，已知本地改动位于：
  - `apps/desktop/src/main/services/approval/__tests__/classifier.test.ts`
  - `apps/desktop/src/main/services/approval/classifier.ts`
  - `apps/desktop/src/renderer/src/App.tsx`
  - `apps/desktop/nul`（未跟踪）
  - `docs/compose/plans/2026-06-24-pi-desktop-optimization-execution-plan.md`（未跟踪，作为本次执行文档保留）
- M2、M3、M6 会直接碰到 `App.tsx`、`classifier.ts`、`usePiStream.ts` 一带；在开始并行执行前，必须先隔离这些改动，避免子代理互相覆盖。
- `origin/master` 目前落后于本地 `master`，后续每个模块分支都应明确是基于本地 `master@11520ba` 还是某个模块集成分支，避免把远端旧基线误当作当前真相。

## 模块执行看板

| 模块 | 分支 / worktree | 状态 | 进入条件 | 离开条件 |
|------|-----------------|------|----------|----------|
| M1 | `codex/m1-session-truth` / `C:\Ai\pi-desktop-m1` | Done | 已满足 | commit `2333fd9`；审查、自动化验证、实机截图、提交均已完成 |
| M2 | `codex/m2-workspace-routing` / `C:\Ai\pi-desktop-m2` | Done | 已满足 | commit `887b36a`；审查、自动化验证、实机截图、提交均已完成 |
| M3 | `codex/m3-approval-loop` / `C:\Ai\pi-desktop-m3` | Done | 已满足；已基于 M1 基座切出 | commit `27f5a62`；审查、自动化验证、实机截图、提交均已完成 |
| M4 | `codex/m4-settings-contract` / `C:\Ai\pi-desktop-m4` | Done | 已完成 | commit `efead72` 已生成；等待后续集成 |
| M5 | `codex/m5-search-io-export` / `C:\Ai\pi-desktop-m5` | Done | 已基于 `M3@27f5a62` 完成实现、复审、自动化验证与真实 Electron 验收 | commit `7bee692`；3 张截图证据已生成 |
| M6 | `codex/m6-release-gate` / 待创建 | Pending | 至少两个核心模块合并后再启动更稳妥 | 最终全量回归、截图、发布闸门收口 |

## 执行前置（P0，主代理负责，不并行）

- [x] **Step 1: 冻结当前基线**

Run:
```powershell
git status --short --branch
git branch --all --verbose --no-abbrev
git worktree list --porcelain
```

Expected: 明确当前 `master` 的 ahead/behind、脏文件和 worktree 拓扑，后续所有模块都从同一基线切出。

- [x] **Step 2: 隔离并行执行工作区（已完成当前波次所需部分）**

Recommended:
```powershell
git worktree add ..\pi-desktop-m1 -b codex/m1-session-truth master
git worktree add ..\pi-desktop-m2 -b codex/m2-workspace-routing master
git worktree add ..\pi-desktop-m3 -b codex/m3-approval-loop master
git worktree add ..\pi-desktop-m4 -b codex/m4-settings-contract master
git worktree add ..\pi-desktop-m5 -b codex/m5-search-io-export master
git worktree add ..\pi-desktop-m6 -b codex/m6-release-gate master
```

Current:
- 已存在：`pi-desktop-m1`、`pi-desktop-m2`、`pi-desktop-m3`、`pi-desktop-m4`、`pi-desktop-m5`
- 待创建：`pi-desktop-m6`
- `M2` / `M5` 均已基于 `M3` 提交 `27f5a62` 切出，避免从 `master` 重复消化 `App.tsx` / approval / permission 冲突

Expected: 当前波次需要的高独立度模块都拥有独立 worktree；`M6` 继续等前置模块稳定后再切出，减少冲突和重复回归成本。

- [ ] **Step 3: 记录当前自动化基线**

Run:
```powershell
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

Expected: 拿到执行前基线结果；如果已有失败，先记录到模块看板，不允许后续把旧失败误当新回归。

- [ ] **Step 4: 固化截图与验收证据路径**

约定：
- 实机截图命名：`docs/compose/acceptance/2026-06-24-mX-01.png`
- 每个模块至少保留 3 张截图：入口态、修复核心态、重启或切换后的保持态
- 涉及主进程 / preload / IPC / 持久化的模块，截图必须来自真实 Electron 桌面端，不接受纯组件测试图

- [ ] **Step 5: 统一模块完成闸门**

每个模块都必须按以下顺序收口：
1. 子代理完成代码与模块内测试
2. 主代理做代码审查，重点看行为回归、权限绕过、死路径、缺测试
3. 运行自动化验证
4. 进行 Windows 实机 Electron 验收并截图
5. 单模块 commit
6. 合并回集成分支后再进入下一个依赖模块

## 并行执行矩阵

| 模块 | 主题 | 启动条件 | 可并行关系 | 推荐执行者 |
|------|------|----------|------------|------------|
| M1 | 会话真相源与持久化统一 | P0 完成 | 可与 M4、M5-基础切片并行 | 子代理 A |
| M2 | 工作区路由、历史定位、未接线功能收口 | M1 合并后优先启动 | 与 M6-补测切片并行 | 子代理 B |
| M3 | 权限审批链路闭环 | P0 完成，且先确认本地 `classifier`/`App.tsx` 改动隔离方案 | 可与 M1、M4 并行 | 子代理 C |
| M4 | Settings 契约统一 | P0 完成 | 可与 M1、M3、M5 并行 | 子代理 D |
| M5 | 文件/Git/搜索/导出/I/O 优化 | P0 完成；其中 UI 收口切片建议等 M2 | 基础切片可与 M1/M4 并行 | 子代理 E |
| M6 | 测试体系纠偏、发布闸门、最终验收 | 每个模块完成一半即可同步补测，最终收口需 M1-M5 合并 | 与任意单模块的补测切片并行 | 主代理或审查代理 |

## 子代理执行协议

每个模块子代理都必须拿到同一份最小上下文，不允许“自己再猜一遍需求”：

1. 目标模块名称、目标问题编号（例如 `M1 / F01 F02 F14`）
2. 明确的 worktree 路径与分支名
3. 只允许修改的文件范围和禁止碰触的主工作区脏文件
4. 模块级测试命令、完整闸门、截图要求、提交信息模板
5. 当前已知事实与不能回退的行为约束

子代理完成一个模块后，主代理固定做 4 个动作：

1. 代码审查：先找行为回归、权限绕过、死功能、缺测试
2. 定向验证：先跑模块 tests，再跑 `build`
3. 实机验收：真实 Electron 操作 + 截图，截图落到 `docs/compose/acceptance/`
4. 提交收口：只在闸门都过后执行单模块 commit

### 子代理 dispatch 模板

每次派发模块实现子代理时，主代理都应使用同一骨架，避免上下文缺失：

```text
模块：M2 / M5 / ...
问题编号：F08 F09 F10 F11
工作区：C:\Ai\pi-desktop-m2
分支：codex/m2-workspace-routing
基线提交：27f5a62
允许修改文件：<本模块文件白名单>
禁止碰触：主工作区 C:\Ai\pi-desktop 的用户脏改动；其他模块冲突热点文件若未授权不得修改
必须完成：
1. 先做代码审查，确认问题是否真实存在
2. 只实现本模块范围内修复
3. 跑模块 targeted tests + build
4. 保留 Windows 实机 Electron 验收截图到 docs/compose/acceptance/
5. 给出建议 commit message，但不要跳过主代理复审
```

主代理在收回子代理结果后，不直接信任“已完成”，而是必须重新做一次代码审查、自动化验证和实机验收。

## 冲突热点

| 热点文件 | 涉及模块 | 协调要求 |
|----------|----------|----------|
| `apps/desktop/src/renderer/src/App.tsx` | M2, M3 | 先让 M3 只处理审批事件订阅与权限注入，再由 M2 统一做入口/路由接线 |
| `apps/desktop/src/renderer/src/hooks/usePiStream.ts` | M1, M3, M6 | M1 先定持久化与 session 绑定真相源；M3 只在 M1 基础上补权限路径 |
| `packages/shared-types/src/index.ts` | M1, M4 | 先做字段/事件契约清点，再按同一 schema 一次性修改 |
| `apps/desktop/src/renderer/src/shortcuts/registry.ts` | M2, M5 | M2 负责入口可达，M5 负责能力矩阵和隐藏策略 |

## 模块 M1：会话真相源与持久化统一

**涵盖问题：** F01, F02, F14，外带修正 F09/F10 的数据基座
**目标：** 让 session、agent、usage、search、export 都建立在同一份会话真相源上，修复重启丢历史、workspace/agent 串线和 usage 统计失真。
**推荐分支：** `codex/m1-session-truth`

**关键文件：**
- `apps/desktop/src/renderer/src/stores/session-store.ts`
- `apps/desktop/src/renderer/src/stores/agent-store.ts`
- `apps/desktop/src/renderer/src/hooks/usePiStream.ts`
- `apps/desktop/src/main/services/session-store.ts`
- `apps/desktop/src/main/services/session-sqlite.ts`
- `apps/desktop/src/main/services/pi-session/registry.ts`
- `apps/desktop/src/main/services/pi-session/event-bridge.ts`
- `apps/desktop/src/main/ipc/sessions.ipc.ts`
- `apps/desktop/src/main/ipc/codex-sessions.ipc.ts`
- `apps/desktop/src/main/ipc/claude-sessions.ipc.ts`
- `packages/shared-types/src/index.ts`
- `apps/desktop/src/renderer/src/stores/__tests__/session-store.test.ts`
- `apps/desktop/src/renderer/src/stores/__tests__/agent-store.test.ts`
- `apps/desktop/src/renderer/src/hooks/usePiStream.test.tsx`
- `apps/desktop/src/main/services/__tests__/session-store.test.ts`

- [ ] **Slice 1: 画出现有会话读写矩阵并选定唯一真相源**
- [ ] **Slice 2: 修复 agent 模式消息、tool 事件、usage 事件的持久化写入**
- [ ] **Slice 3: 修复 session 与 workspace / agent 的绑定关系，禁止无条件回退到 workspace 默认 agent**
- [ ] **Slice 4: 对齐 export、history search、usage 统计的数据读取路径**
- [ ] **Slice 5: 替换把错误行为写成预期的旧测试**

**自动化验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/renderer/src/hooks/usePiStream.test.tsx
pnpm --filter @pi-desktop/desktop test src/renderer/src/stores/__tests__/session-store.test.ts
pnpm --filter @pi-desktop/desktop test src/renderer/src/stores/__tests__/agent-store.test.ts
pnpm --filter @pi-desktop/desktop test src/main/services/__tests__/session-store.test.ts
pnpm --filter @pi-desktop/desktop build
```

**实机验收：**
1. 在 workspace A 创建自定义 agent 会话，连续发送 2 轮消息并确认 usage 面板有值
2. 关闭应用后重新打开，确认完整历史、usage、当前 agent 标识都仍然存在
3. 切到 workspace B，再切回 workspace A，确认没有串到默认 agent

**截图清单：**
- `m1-01` 会话运行中，显示 agent 标识和 usage
- `m1-02` 重启后仍保留完整历史
- `m1-03` workspace 切换后回到原 session，agent 不串线

**建议提交：** `fix(session): unify persisted history and active agent state`

## 模块 M2：工作区路由、历史定位与未接线功能收口

**涵盖问题：** F08, F09, F10, F11
**目标：** 让 workspace 切换、历史搜索、SessionCenter、导出入口和命令候选都变成真实可达、真实可用的主应用能力。
**推荐分支：** `codex/m2-workspace-routing`

**关键文件：**
- `apps/desktop/src/renderer/src/App.tsx`
- `apps/desktop/src/renderer/src/stores/workspace-store.ts`
- `apps/desktop/src/main/ipc/workspace.ipc.ts`
- `apps/desktop/src/renderer/src/components/TopTabBar/WorkspaceSwitcher.tsx`
- `apps/desktop/src/renderer/src/components/SearchHistory/SearchHistory.tsx`
- `apps/desktop/src/renderer/src/components/SessionCenter/SessionCenter.tsx`
- `apps/desktop/src/renderer/src/components/SessionExport/SessionExportDialog.tsx`
- `apps/desktop/src/renderer/src/components/MiniMaxCode/MiniMaxCodeSidebar.tsx`
- `apps/desktop/src/renderer/src/shortcuts/registry.ts`
- `apps/desktop/e2e/command-palette-callbacks.spec.ts`
- `apps/desktop/src/renderer/src/stores/__tests__/workspace-store.test.ts`
- `apps/desktop/src/renderer/src/components/SessionCenter/SessionCenter.test.tsx`

- [ ] **Slice 1: 实现 `workspace:select` 的最近工作区与 `lastActiveAt` 真实更新**
- [ ] **Slice 2: 让历史搜索结果能够跳到具体 message，而不是只切 session**
- [ ] **Slice 3: 把 `SessionCenter` 和 GUI 导出入口真正挂进主应用可达路径**
- [ ] **Slice 4: 只暴露桌面端真正支持的 slash command / command palette 能力**
- [ ] **Slice 5: 为 workspace 切换、搜索跳转、导出入口增加回归测试**

**自动化验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/renderer/src/stores/__tests__/workspace-store.test.ts
pnpm --filter @pi-desktop/desktop test src/renderer/src/components/SessionCenter/SessionCenter.test.tsx
pnpm --filter @pi-desktop/desktop test src/renderer/src/components/CommandPalette/CommandPalette.test.tsx
pnpm --filter @pi-desktop/desktop e2e -- --grep "command palette"
pnpm --filter @pi-desktop/desktop build
```

**实机验收：**
1. 切换 workspace，确认最近工作区列表和当前会话跟随更新
2. 在历史搜索中命中某条旧消息，点击后直接滚到该 message
3. 从主应用真实打开 SessionCenter/导出入口并完成一次导出
4. 打开命令候选，确认不再展示桌面端不支持的命令

**截图清单：**
- `m2-01` workspace 切换后最近项目列表正确
- `m2-02` 搜索结果跳到指定消息位置
- `m2-03` SessionCenter 或导出入口已从主应用可达

**建议提交：** `fix(workspace): wire navigation, history jump and export entrypoints`

## 模块 M3：权限审批链路闭环

**涵盖问题：** F03, F04, F12, F13，外带修正 F15 的错误测试预期
**目标：** 让高风险工具调用必须经过真实审批，让 review diff 可信，让 ToolPermissions 改动真正作用在 active/new agent 路径。
**推荐分支：** `codex/m3-approval-loop`

**关键文件：**
- `apps/desktop/src/main/services/approval/classifier.ts`
- `apps/desktop/src/main/services/approval/interceptor.ts`
- `apps/desktop/src/main/services/approval/pending-edits.ts`
- `apps/desktop/src/main/ipc/schemas.ts`
- `packages/shared-types/src/approval.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/src/App.tsx`
- `apps/desktop/src/renderer/src/components/ApprovalPanel/ApprovalPanel.tsx`
- `apps/desktop/src/renderer/src/components/ApprovalPanel/ChangeApprovalCard.tsx`
- `apps/desktop/src/renderer/src/hooks/usePiStream.ts`
- `apps/desktop/src/main/services/approval/__tests__/classifier.test.ts`
- `apps/desktop/src/main/services/approval/__tests__/interceptor.test.ts`
- `apps/desktop/src/main/services/approval/__tests__/pending-edits.test.ts`

- [ ] **Slice 1: 收紧命令风险分类，补齐 mutate / destructive / shell wrapper 边界样例**
- [ ] **Slice 2: 修复 review diff 基线来源，确保显示真实 before/after**
- [ ] **Slice 3: 打通 main -> preload -> renderer 的 pending edit 订阅、approve、reject、remove 闭环**
- [ ] **Slice 4: 让 ToolPermissions 改动作用于真实 active/new agent，而不是只在 fallback prompt 前缀里生效**
- [ ] **Slice 5: 改掉把“高风险不 ask / 不 abort”写成预期的旧测试**

**自动化验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/approval/__tests__/classifier.test.ts
pnpm --filter @pi-desktop/desktop test src/main/services/approval/__tests__/interceptor.test.ts
pnpm --filter @pi-desktop/desktop test src/main/services/approval/__tests__/pending-edits.test.ts
pnpm --filter @pi-desktop/desktop build
```

**实机验收：**
1. 触发一次高风险文件编辑或命令执行，确认桌面端出现真实审批卡片
2. 打开 diff review，确认前后内容与磁盘真实状态一致
3. 分别走 approve / reject 路径，确认状态变化、磁盘结果和 UI 展示一致
4. 修改 ToolPermissions 后重新触发同类工具，确认权限策略已即时生效

**截图清单：**
- `m3-01` 高风险操作进入审批卡片
- `m3-02` diff review 显示真实 before/after
- `m3-03` reject 或 approve 后结果状态正确

**建议提交：** `fix(approval): close permission and review loop`

## 模块 M4：Settings 契约统一

**涵盖问题：** F05，外带修正 F15 中与 settings schema 漂移相关的错误测试
**目标：** 统一 shared types、renderer store、main schema、IPC 和持久化设置字段，确保 `thinkingLevel` / `showThinking` / `vision*` 等设置能稳定保存、恢复、迁移。
**推荐分支：** `codex/m4-settings-contract`

**关键文件：**
- `packages/shared-types/src/index.ts`
- `apps/desktop/src/main/types.ts`
- `apps/desktop/src/main/ipc/schemas.ts`
- `apps/desktop/src/main/ipc/settings.ipc.ts`
- `apps/desktop/src/main/ipc/settings-window.ipc.ts`
- `apps/desktop/src/renderer/src/stores/settings-store.ts`
- `apps/desktop/src/renderer/src/components/Settings/SettingsContent.tsx`
- `apps/desktop/src/renderer/src/components/Settings/tabs/PiAgentTab.tsx`
- `apps/desktop/src/renderer/src/components/Settings/tabs/PermissionsTab.tsx`
- `apps/desktop/src/renderer/src/stores/__tests__/settings-store.test.ts`
- `apps/desktop/src/renderer/src/components/Settings/SettingsPanel.test.tsx`

- [ ] **Slice 1: 清点 renderer 能写、main 能读、持久化能存的所有 settings 字段**
- [ ] **Slice 2: 选定 canonical 字段名、默认值和迁移策略**
- [ ] **Slice 3: 对齐 Zod schema、shared types、主进程类型和 renderer store**
- [ ] **Slice 4: 验证 settings window 与主界面共享同一配置契约**
- [ ] **Slice 5: 为关键字段 round-trip、旧配置迁移、未知字段兼容性补测试**

**自动化验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/renderer/src/stores/__tests__/settings-store.test.ts
pnpm --filter @pi-desktop/desktop test src/renderer/src/components/Settings/SettingsPanel.test.tsx
pnpm --filter @pi-desktop/desktop build
```

**实机验收：**
1. 在 Settings 中修改 `thinkingLevel`、`showThinking`、vision 相关配置并保存
2. 关闭 Settings 窗口再打开，确认值仍然正确
3. 完整关闭应用再打开，确认设置已持久化

**截图清单：**
- `m4-01` 设置修改前后对比
- `m4-02` 重新打开窗口后配置仍在
- `m4-03` 重启应用后配置仍在

**建议提交：** `fix(settings): align renderer and main config contract`

## 模块 M5：文件 / Git / 搜索 / 导出 / 同步 I/O 优化

**涵盖问题：** F06, F07, F10, F11
**目标：** 让搜索能覆盖关键 dotfiles，让主进程文件/Git 路径不再明显卡 UI，让导出和能力暴露与真实实现保持一致。
**推荐分支：** `codex/m5-search-io-export`

**关键文件：**
- `apps/desktop/src/main/services/search/file-scanner.ts`
- `apps/desktop/src/main/services/search/__tests__/file-scanner.test.ts`
- `apps/desktop/src/main/ipc/files.ipc.ts`
- `apps/desktop/src/main/ipc/git.ipc.ts`
- `apps/desktop/src/main/file-tree.ts`
- `apps/desktop/src/main/file-tree.test.ts`
- `apps/desktop/src/main/services/git-service.ts`
- `apps/desktop/src/main/services/git-service.test.ts`
- `apps/desktop/src/renderer/src/components/FileWorkspace/FileWorkspace.tsx`
- `apps/desktop/src/renderer/src/components/FileWorkspace/file-workspace-utils.ts`
- `apps/desktop/src/renderer/src/utils/export.ts`
- `apps/desktop/src/renderer/src/components/SessionExport/SessionExportDialog.tsx`
- `apps/desktop/src/renderer/src/shortcuts/registry.ts`

- [ ] **Slice 1: 为搜索扫描器引入可配置的 dotfiles/dotdirs 包含策略和安全排除列表**
- [ ] **Slice 2: 审计主进程同步文件/Git I/O，优先把重扫描、重状态查询改成异步或缓存路径**
- [ ] **Slice 3: 对齐 GUI 导出与 slash/command 导出的能力说明和入口**
- [ ] **Slice 4: 清理 UI 中“显示了但实际上不支持”的文件/Git/导出能力**
- [ ] **Slice 5: 为大仓库扫描、dotfile 可见性、导出路径、Git 响应性补回归测试**

**自动化验证：**
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/search/__tests__/file-scanner.test.ts
pnpm --filter @pi-desktop/desktop test src/main/ipc/__tests__/files.ipc.test.ts
pnpm --filter @pi-desktop/desktop test src/main/services/git-service.test.ts
pnpm --filter @pi-desktop/desktop build
```

**实机验收：**
1. 在真实 workspace 中搜索 `.env`、`.github`、`.vscode` 等文件，确认能按策略显示
2. 打开包含大量文件的仓库，观察文件/Git 面板刷新时 UI 不出现明显卡顿
3. 从 GUI 导出一次会话，确认输出与提示文案一致

**截图清单：**
- `m5-01` dotfile 搜索结果可见
- `m5-02` 文件/Git 面板在大仓库下仍可交互
- `m5-03` GUI 导出完成态

**建议提交：** `perf(search): expose critical files and reduce blocking io`

## 模块 M6：测试体系纠偏、发布闸门与最终验收

**涵盖问题：** F15，并负责把 M1-M5 的行为固化为真实可回归的测试闸门
**目标：** 清除“错误行为被写成预期”的假绿测试，补齐核心桌面流程回归，建立每模块必过的统一发布闸门。
**推荐分支：** `codex/m6-release-gate`

**关键文件：**
- `apps/desktop/src/renderer/src/hooks/usePiStream.test.tsx`
- `apps/desktop/src/main/services/approval/__tests__/interceptor.test.ts`
- `apps/desktop/src/main/services/approval/__tests__/classifier.test.ts`
- `apps/desktop/src/main/ipc/__tests__/sessions.ipc.test.ts`
- `apps/desktop/e2e/command-palette-callbacks.spec.ts`
- `apps/desktop/playwright.config.ts`
- `scripts/smoke-main-runtime.cjs`
- `.github/workflows/ci.yml`

- [ ] **Slice 1: 跟随 M1/M3/M4 落地，把“错误行为是预期”的测试逐个翻正**
- [ ] **Slice 2: 为 session 持久化、workspace 切换、审批链路、settings 保存补 Electron e2e 或 smoke**
- [ ] **Slice 3: 统一模块级验证命令、截图要求和提交流程**
- [ ] **Slice 4: 在所有模块合并后跑完整回归并整理最终验收记录**

**自动化验证：**
```powershell
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @pi-desktop/desktop build
pnpm --filter @pi-desktop/desktop e2e
```

**最终实机验收：**
1. 新建会话、发送消息、关闭重开、历史保留
2. 切换 workspace，确认最近项目和当前会话一致
3. 触发高风险操作，审批卡片与 diff review 正常
4. 修改 settings 并重启，配置仍然保留
5. 搜索 dotfile、导出会话、查看 Git 状态，确认能力一致且响应正常

**最终截图清单：**
- `m6-01` 会话持久化
- `m6-02` workspace 切换与历史定位
- `m6-03` 审批 review
- `m6-04` settings 持久化
- `m6-05` 搜索 / 导出 / Git

**建议提交：** `test(release): align desktop regression gates with real behavior`

## 推荐执行波次

1. **Wave 0：** P0 前置基线、worktree 隔离、截图路径约定，已完成
2. **Wave 1：** M1、M3、M4，已完成并各自形成独立提交
3. **Wave 2：** M2 与 M5 已完成
   - M2 已完成 workspace 路由、历史定位、SessionCenter 可达性与真实 Electron 验收
   - M5 已完成关键 dotfiles 策略、同步 I/O 替换、`/export` 收口、批量导出状态修复与真实 Electron 验收
4. **Wave 3：** 进入 M6，统一做跨模块补测、最终回归和发布闸门收口
5. **Wave 4：** M6 跟随各模块补测试，最后做一次全量回归和最终实机截图

## 每模块统一完成定义

- [ ] 代码变更只覆盖本模块范围，不顺手做无关重构
- [ ] 主代理完成代码审查，确认没有新增死路径、串线、权限绕过或错误测试预期
- [ ] 至少通过模块相关 targeted test；涉及 main/preload/IPC 时必须额外 `build`
- [ ] 影响入口流程时必须补 e2e 或 smoke
- [ ] 完成 Windows 实机 Electron 验收并截图
- [ ] 用 Conventional Commit 单独提交

## 建议提交粒度

| 模块 | 提交建议 |
|------|----------|
| M1 | `fix(session): unify persisted history and active agent state` |
| M2 | `fix(workspace): wire navigation, history jump and export entrypoints` |
| M3 | `fix(approval): close permission and review loop` |
| M4 | `fix(settings): align renderer and main config contract` |
| M5 | `perf(search): expose critical files and reduce blocking io` |
| M6 | `test(release): align desktop regression gates with real behavior` |

## 执行结论

这份计划不再按文件清单散打，而是按 6 个可交付模块组织。当前真实执行态是：`M1/M2/M3/M4/M5` 已完成并各自过了“代码审查 -> 自动化验证 -> Windows 实机截图验收 -> 单模块提交”的闸门，剩余 `M6` 负责跨模块补测、最终回归和发布收口。
