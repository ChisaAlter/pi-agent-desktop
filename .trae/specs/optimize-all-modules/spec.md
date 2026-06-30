# Pi Desktop 全模块代码优化 Spec

## Why

Pi Desktop 已积累 100+ 源文件,经全模块代码审查发现 **26 项 Critical、50+ 项 High** 级问题,集中在:

1. **性能瓶颈**:主进程大量同步 IO(`execFileSync`/`readFileSync`/`DatabaseSync`)阻塞 UI;渲染层 `usePiStream` 不传 selector 导致流式时全组件树 re-render;`session-store` 全局 mutex 串行化所有 workspace。
2. **并发安全**:`suppressEventForwarding` 单布尔值跨 agent 串扰;`ensureSubscribed` TOCTOU;workspace read-modify-write 无锁;`promptInFlightRef` 在 followUp 分支未重置。
3. **安全漏洞**:`git:undo` 路径遍历 + 误删;`skills:github-import` SSRF;`local-file-protocol` 任意本地文件可读;`hasApiKey` 永远 false 误导用户。
4. **数据一致性**:`long-horizon/database.ts` 跨 workspace 数据泄漏 + BM25 score floor bug 形同虚设;`streamPersistRef` 重建时丢字段;AutoSave zombie timer。
5. **可维护性**:`shared-types/index.ts` 1196 行单文件;`ChatInput.tsx` 1432 行;`usePiStream.ts` 1183 行;`compose-workflow.ts` 650 行;`IpcError` 不是 discriminated union 失去类型保护。
6. **文档与实现严重不符**:AGENTS.md 描述的 `better-sqlite3` + `session-sqlite.ts` v1.2 baseline **实际不存在**,误导后续 agent。
7. **构建/CI 风险**:`npmRebuild: false` 但 release.yml 无 native rebuild 步骤(运行时崩);`vitest.config.ts` 别名漏;无 coverage;smoke 修改 built bundle 后未恢复。

本 spec 旨在系统性修复上述问题,提升性能、安全、可维护性,使代码库达到 v1.2 可发布状态。

## What Changes

### Critical 修复(必须)

- **修复 `git:undo` 路径遍历与误删**:加 `..` 防御 + fallback 前用 `git status --porcelain` 判断 untracked
- **修复 `long-horizon/database.ts` 跨 workspace 数据泄漏**:WHERE 子句加 `scope='global'` 限制;修复 BM25 score floor 的 `0 >= 负数恒真` bug
- **修复 `agent-runtime/registry.ts` `suppressEventForwarding` 串扰**:改为 `Set<agentId>` 隔离
- **修复 `usePiStream.ts` `promptInFlightRef` 未重置 bug**:followUp 分支 return 前重置
- **修复 `usePiStream.ts` `useSessionStore()` 不传 selector**:actions 改为 `getState()` 直接调用
- **修复 `usePiStream.ts` `streamPersistRef` 重建/覆盖丢字段**:用 spread 保留 + textRef/thinkingRef 初始化
- **修复 `TopTabBar.tsx` `sr-only` 包裹 rightSlot bug**:改为正常显示
- **修复 `CommandPalette.tsx` render 体内 `useSessionStore.getState()` 反模式**:改为顶部 selector 订阅
- **修复 `ChatView.tsx` `handleStop` stale closure**:改用 `useEventCallback` 模式
- **修复 `settings.ipc.ts` `hasApiKey` 永远 false + `pi:list-skills` 用 `process.cwd()` 两个 bug**
- **修复 `preload/index.ts` 通用 `invoke` 白名单混 invoke/send 通道**:拆 `ALLOWED_INVOKE`/`ALLOWED_SEND`
- **修复 `child-agent.ts` AbortSignal race window + stdin error 漏调 finish**
- **修复 `smoke-main-runtime.cjs` 污染 built bundle**:复制到 tmp 后 patch + 加入 CI
- **修复 `electron-builder.yml` + `release.yml` native rebuild 缺失**:加 `electron-rebuild` 步骤
- **更新 AGENTS.md**:删除 `better-sqlite3`/`session-sqlite.ts` 虚假描述,改为 `node:sqlite` + electron-store

### High 修复(应该)

- **`git-service.ts` 全部 `execFileSync` 改 `execFile` 异步化** + 加 timeout
- **`config/config-manager.ts` 加内存缓存**(mtime 失效)+ 原子写(tmp + rename)
- **`session-store.ts` mutex 按 session 粒度** + 维护 `Map<sessionId, Session>` 索引
- **`extension-ui-bridge.ts` + `approval-bridge.ts` 按 workspaceId 隔离 pending + 注入 getTargetWindow**
- **`pi-session/registry.ts` `ensureSubscribed` 加 `subscribing: Promise<void>` 复用模式**
- **`chat.ipc.ts` 拆分**:slash/plan/longhorizon/prompt/git 五个子文件
- **`chat.ipc.ts` `materializeInlinePlan` 同步 IO 改 `fs/promises`**
- **`chat.ipc.ts` `pi:runtime-feature-state` 一次性计算 + memoize**
- **`skills.ipc.ts` 抽 `services/ssrf-guard.ts` 共享 `isSafeUrl`**;toggle 加锁
- **`workspace.ipc.ts` 抽 `mutateWorkspaces(fn)` + mutex**;补 protected path 校验
- **`schemas.ts` 全部加 `.max(...)` 长度限制**;定义 `toolCallSchema` 替代 `z.unknown()`
- **`shared-types/index.ts` 拆分**:~20 个领域文件,`index.ts` 只 re-export
- **`IpcError` 加 `__brand: "IpcError"` 字段**变 discriminated union
- **`preload/index.ts` 所有 `ipcRenderer.invoke` 加 `as Promise<T>`**;实现 `describeImages` 或从类型删除
- **`compose-workflow.ts` 加全局超时** + Merge 阶段 dirty repo fast-fail + topoSort 改 SCC 部分降级
- **`ChatInput.tsx` 拆分为 5 子组件 + 3 hook**
- **`FileWorkspace.tsx` 抽 `useLatestRequest` + `useDebouncedSave` hook**
- **`RightRail.tsx` 15s 轮询加 `visibilityState` 监听 + 折叠态跳过**;4 处 setTimeout 抽 `useTransientState`
- **`MessageBubble.tsx` 加 `React.memo` + 4 处 `useMemo`**
- **`DateGroupedSessionList` + `ProjectGroupedSessionList` 抽 `SessionRow.tsx` 共享**
- **`PlanCard.tsx` 全量补 i18n `t()`**
- **`vitest.config.ts` 补别名 + 加 v8 coverage + `environmentMatchGlobs`**
- **`ci.yml` 加 Electron cache + matrix + E2E job + artifact upload**
- **`eslint.config.js` 删 globals 死代码 + 升 `exhaustive-deps` 为 error + 关 `allowEmptyCatch`**
- **`lefthook.yml` 加 pre-push + commit-msg hook**
- **`tsconfig.base.json` 补 `@` 别名**

### Medium/Low(可选)

- 各处魔法数字提取常量
- 重复 helper(`getPiAPI`/`partition`/`isIpcError` 检查)抽到 `utils/`
- 模块级订阅变量统一封装 `createSubscriptionManager()`
- `command-risk.ts` 补单测
- `events.ts` Legacy 形状加 `@deprecated` 注释
- 各 IPC handler 统一错误处理风格(`withValidation`/`withPiDriver` helper)
- `claude-sessions.ipc.ts` + `codex-sessions.ipc.ts` 抽 `setupSessionImporterIpc` helper

## Impact

- **Affected specs**: 本 spec 为顶层优化 spec,与 `fix-all-usability-issues` 并行(后者聚焦可用性,本 spec 聚焦代码质量)
- **Affected code**:
  - 主进程 IPC:`apps/desktop/src/main/ipc/` 全部 20 文件
  - 主进程 Services:`apps/desktop/src/main/services/` 全部 24 文件
  - 渲染 Stores:`apps/desktop/src/renderer/src/stores/` 全部 16 文件
  - 渲染 Hooks:`apps/desktop/src/renderer/src/hooks/` 全部 7 文件
  - 渲染 Components:`apps/desktop/src/renderer/src/components/` 30+ 文件
  - Compose 扩展:`apps/desktop/extensions/compose-mode/` 3 文件
  - Preload:`apps/desktop/src/preload/index.ts`
  - Shared types:`packages/shared-types/src/` 4 文件
  - 构建:`electron.vite.config.ts`/`electron-builder.yml`/`vitest.config.ts`/`playwright.config.ts`/`eslint.config.js`/`lefthook.yml`/`tsconfig.base.json`
  - CI:`.github/workflows/ci.yml`/`release.yml`
  - 测试:`scripts/smoke-main-runtime.cjs`/`apps/desktop/src/test/setup.ts`
  - 文档:`AGENTS.md`

## ADDED Requirements

### Requirement: 主进程异步化

所有主进程 IPC handler 与 service 中的同步 IO(`execFileSync`/`readFileSync`/`writeFileSync`/`mkdirSync`/`readdirSync`/`statSync`/`DatabaseSync`)SHALL 改为异步版本(`execFile`/`fs/promises`/worker_threads),除显式标注"启动期一次性同步"的场景外。

#### Scenario: Git 操作不阻塞 UI
- **WHEN** 用户在大型 git 仓库中切换工作区
- **THEN** `git status`/`git diff` 等操作不阻塞主进程事件循环,UI 保持响应

#### Scenario: SQLite 查询不阻塞主线程
- **WHEN** agent 调用 `searchMemories` 进行 FTS5 BM25 查询
- **THEN** 查询在 worker_threads 中执行,主线程 IPC 响应时间 < 50ms

### Requirement: IPC 错误处理统一

所有 IPC handler SHALL 返回 `ipcError()` 而非 throw 异常;所有 Zod 校验 SHALL 使用 `safeParse` + 返回带 `reason` 字段的 `ipcError`;所有 fire-and-forget(`ipcMain.on`)SHALL 包 try/catch + `log.error`。

#### Scenario: Zod 校验失败
- **WHEN** renderer 传入非法参数
- **THEN** handler 返回 `ipcError("ipcErrors.xxx.invalidArgs", "参数无效", { reason: "<Zod issue message>" })`,不抛 ZodError

#### Scenario: 业务调用抛异常
- **WHEN** service 调用 throw
- **THEN** handler 包 try/catch 返回 `ipcError("ipcErrors.xxx.failed", ...)`,renderer 收到结构化错误

### Requirement: IpcError 类型安全

`IpcError` 类型 SHALL 增加 `__brand: "IpcError"` 字段,使 `Promise<T | IpcError>` 成为 discriminated union,强制调用方 `isIpcError()` narrow 后才能访问 `T` 的字段。

#### Scenario: 调用方忘记检查 IpcError
- **WHEN** renderer 写 `const result = await piAPI.getStatus(); result.installed`
- **THEN** TypeScript 编译报错"Property 'installed' does not exist on type 'IpcError'",强制调用方先 `isIpcError(result)` narrow

### Requirement: 工作区隔离

所有跨 workspace 的状态(pending requests、permission mode、event forwarding suppression、mutex chain)SHALL 按 `workspaceId` 或 `agentId` 隔离,不允许模块级单例。

#### Scenario: 多 agent 并发模式切换
- **WHEN** compose workflow 中 agent A 切换到 plan 模式,同时 agent B 在 build 模式 streaming
- **THEN** agent B 的事件流不被抑制,UI 正常显示 agent B 的流式输出

#### Scenario: 多窗口 permission 决策
- **WHEN** 主窗口发出 permission request,设置窗口同时操作
- **THEN** 设置窗口不会响应主窗口的 request,permission 决策不串扰

### Requirement: 渲染层流式性能

流式响应期间,`usePiStream` 所在组件树 SHALL NOT 因 store 订阅粒度过粗导致全树 re-render。

#### Scenario: 流式 text_delta 不触发兄弟组件 re-render
- **WHEN** agent 流式输出 N 条 text_delta
- **THEN** 兄弟组件(工具栏、设置面板、RightRail)re-render 次数为 0,仅消息列表更新

### Requirement: Compose 工作流鲁棒性

Compose 7 阶段流水线 SHALL 有全局 wall-clock 超时;AbortSignal 传播 SHALL 无 race window;topoSort SHALL 用 SCC 部分降级而非全降级;Merge 阶段 SHALL 在入口 fast-fail 而非事后失败。

#### Scenario: 全局超时触发
- **WHEN** 工作流运行超过 `timeoutMs`(默认 60 分钟)
- **THEN** 自动调 `store.requestCancel(runId, "global budget exhausted")`,清理所有 child 进程与 worktree

#### Scenario: AbortSignal 不丢失
- **WHEN** 用户在 child 进程 spawn 与 abort listener 注册之间点击取消
- **THEN** child 进程仍被 kill(spawn 后立即检查 pendingKill 标志)

### Requirement: 构建可重复性

`pnpm package` 产出的 installer SHALL 在干净 Windows 机器上启动成功,native 模块(node-pty/sharp/better-sqlite3 若存在)按 Electron ABI 正确编译。

#### Scenario: Release 产物可用
- **WHEN** 用户下载 release.yml 产出的 NSIS installer 并安装
- **THEN** app 启动无 "Cannot find module node-pty" 或 native module ABI 不匹配错误

### Requirement: 测试覆盖率

CI SHALL 跑 unit + smoke + E2E 三层测试;coverage SHALL 达到 lines 70% / functions 70% / branches 60% / statements 70%;E2E SHALL 在 CI 中跑(非仅本地)。

#### Scenario: CI 阻止回归
- **WHEN** PR 引入 compose-workflow.ts 的 regression
- **THEN** CI 中 E2E 或 smoke 失败,PR 不能合并

## MODIFIED Requirements

### Requirement: 持久化后端

[修改] 会话持久化 SHALL 仅使用 electron-store(JSON);长程记忆 SHALL 使用 `node:sqlite`(`DatabaseSync`,Node 22 内置)。**删除** AGENTS.md 中关于 `better-sqlite3` 与 `session-sqlite.ts` 的虚假描述。

### Requirement: AGENTS.md 文档准确性

[修改] AGENTS.md SHALL 与实际实现一致;所有"native modules"列表、持久化后端描述、文件路径引用 SHALL 经实际验证。

### Requirement: shared-types 模块化

[修改] `packages/shared-types/src/index.ts` SHALL 拆分为 ~20 个领域文件(workspace/session/agent/slash/long-horizon/goals/imports/pi-config/settings/permissions/plan/pi-driver/updater/ipc-error/files/terminal/git/skills/projects/pi-packages/pi-api),`index.ts` 只做 re-export;运行时常量(`DEFAULT_LONG_HORIZON_SETTINGS`/`ipcError`/`isIpcError`/`classifyCommandRisk`)SHALL 移到 `@pi-desktop/shared-runtime` 或显式标注保留。

### Requirement: IPC handler 单一职责

[修改] `chat.ipc.ts`(945 行)SHALL 拆分为 `chat-slash.ipc.ts`/`chat-plan.ipc.ts`/`chat-longhorizon.ipc.ts`/`chat-prompt.ipc.ts`/`chat-git.ipc.ts`,`chat.ipc.ts` 只保留 `setupChatIpc` 编排。

### Requirement: 大组件拆分

[修改] 1000+ 行的渲染组件 SHALL 拆分:`ChatInput.tsx`(1432)→ 5 子组件 + 3 hook;`ChatView.tsx`(1096)→ 容器 + 5 个 `use*Effect` hook;`FileWorkspace.tsx`(1052)→ 6 个 slice hook + `SaveConflictDialog` 子组件;`RightRail.tsx`(759)→ 多个面板子组件 + `useTransientState` hook。

### Requirement: Preload 类型契约

[修改] `preload/index.ts` 所有 `ipcRenderer.invoke` SHALL 加 `as Promise<T>` 类型断言或抽 `invokeTyped<T>` helper;`describeImages` SHALL 实现或从 `PiAPI` 类型删除;通用 `invoke` SHALL 拆 `ALLOWED_INVOKE`/`ALLOWED_SEND` 或删除。

## REMOVED Requirements

### Requirement: better-sqlite3 持久化后端

**Reason**: AGENTS.md 描述的 "better-sqlite3 (SQLite): v1.2 baseline, stores sessions in `sessions.db`" 与 "session-sqlite.ts" 实际不存在,`better-sqlite3` 未在 package.json 中声明。规划文档 `docs/compose/plans/2026-06-18-pi-desktop-improvement-roadmap.md` 第 479 行已决策"收敛到 electron-store 作为 v1.2 唯一后端"。

**Migration**: 无需迁移(从未实现)。仅需更新 AGENTS.md 删除虚假描述,避免后续 agent 基于错误前提做决策。

### Requirement: Legacy 扁平事件形状

**Reason**: `events.ts` 中 `PiMessageUpdateSdk`(嵌套)+ Legacy 扁平形状(`PiTextDeltaEvent` 等)并存,消费者需写双分支,代码量翻倍且易漏。

**Migration**: 全代码库 grep `event.subtype` 与 `event.assistantMessageEvent`,统一到 SDK 嵌套形状;删除 Legacy interface 与 4 个 type alias;`events.ts` 加 `@deprecated since v1.0, removed in v1.3` 注释作为过渡。
