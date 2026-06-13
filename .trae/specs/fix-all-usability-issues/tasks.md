# Tasks

## Task 1: 修复流式事件状态机竞态条件
修复 `usePiStream.ts` 中 `turn_end`/`agent_end` 的 `isStreaming` 竞态，以及 `toolcall_start`/`tool_execution_start` 互斥丢失问题。

- [x] 1.1: 修改 `turn_end` 处理器 — 不再设置 `isStreaming=false`，改为设置 `isTurnActive=false`（新增 ref），仅 flush 持久化和处理 plan card
- [x] 1.2: 修改 `agent_end` 处理器 — 保持设置 `isStreaming=false`，作为流式结束的权威信号
- [x] 1.3: 修改 `agent_start` 重复检测 — 基于 `isTurnActive` 而非 `isStreaming` 判断是否为同一 turn 内的重复事件
- [x] 1.4: 修改 `toolcall_start` 处理器 — 如果 `toolCallsRef` 已有该 toolCallId（由 `tool_execution_start` 先创建），则补充工具名称等元数据，不跳过
- [x] 1.5: 修改 `tool_execution_start` 处理器 — 如果 `toolCallsRef` 已有该 toolCallId（由 `toolcall_start` 先创建），则更新状态，不跳过
- [x] 1.6: 添加单元测试覆盖上述竞态场景

## Task 2: 修复计划模式状态机
修复 `plan-store.ts` 中 `setEnabled` 回滚逻辑和 `isGenericPlanGuidance` 误判问题。

- [x] 2.1: 修改 `setEnabled` — 在调用 IPC 前保存当前 `enabled` 值到局部变量，失败时恢复到该值而非 `!enabled`
- [x] 2.2: 修改 `setEnabled` — IPC 失败时通过 store 的 `lastError` 字段或事件通知用户
- [x] 2.3: 修改 `isGenericPlanGuidance` — 调整判定逻辑：如果内容包含具体步骤列表（`hasExecutionSteps`）或具体计划标题（`hasConcretePlanTitle`），即使同时包含目标描述，也不判定为通用引导
- [x] 2.4: 添加单元测试覆盖 `isGenericPlanGuidance` 的边界情况

## Task 3: 添加统一 toast 通知系统
创建轻量级 toast 通知组件和 store，用于所有瞬态错误/成功反馈。

- [x] 3.1: 创建 `apps/desktop/src/renderer/src/stores/toast-store.ts` — Zustand store，管理 toast 队列（id、message、tone、duration、retryAction）
- [x] 3.2: 创建 `apps/desktop/src/renderer/src/components/Toast/ToastContainer.tsx` — 渲染 toast 列表，支持自动消失、手动关闭、重试按钮
- [x] 3.3: 在 `App.tsx` 中挂载 `<ToastContainer />`
- [x] 3.4: 添加 i18n key 用于 toast 相关文案（使用内联中文，与现有代码风格一致）

## Task 4: 为 Store 添加用户可见错误反馈
将所有 store 的静默 catch 块改为通过 toast 通知用户。

- [x] 4.1: `skills-store.ts` — `checkAvailability`、`searchMarket`、`refreshInstalled`、`installSkill`、`uninstallSkill`、`toggleSkill` 失败时调用 `addToast`
- [x] 4.2: `pi-packages-store.ts` — `search`、`refreshCatalog`、`refreshInstalled`、`install`、`remove`、`update` 失败时调用 `addToast`（带 retryAction）
- [x] 4.3: `workspace-store.ts` — `loadWorkspaces`、`createWorkspace`、`removeWorkspace` 失败时调用 `addToast`
- [x] 4.4: `settings-store.ts` — `loadSettings`、保存设置失败时调用 `addToast`
- [x] 4.5: `session-store.ts` — `loadSessions` 失败时调用 `addToast`
- [x] 4.6: `agent-store.ts` — `createAgent` 失败时调用 `addToast`

## Task 5: 修复流式相关错误反馈
修复 `usePiStream.ts` 中流式持久化失败和停止流式失败无用户反馈的问题。

- [x] 5.1: 修改 `flushStreamPersist` — 持久化失败时调用 `addToast` 提示用户
- [x] 5.2: 修改 `stopStreaming` — IPC 失败时调用 `addToast` 提示用户，但仍重置本地流式状态
- [x] 5.3: 修改 `startStreaming` — `pi:send` 返回 IpcError 时，在聊天界面中添加一条 assistant 错误消息（而非仅设置 error state）
- [x] 5.4: 修改 `startStreaming` — catch 块中添加 toast 通知

## Task 6: 为关键面板添加 ErrorBoundary
防止单个面板崩溃导致整个应用白屏。

- [x] 6.1: 在 `App.tsx` 中为 ChatView 包裹 `<ErrorBoundary fallback={...} />`
- [x] 6.2: 在 `App.tsx` 中为 SkillsPanel 包裹 `<ErrorBoundary fallback={...} />`
- [x] 6.3: 在 `App.tsx` 中为 GitPanel 包裹 `<ErrorBoundary fallback={...} />`
- [x] 6.4: 在 `App.tsx` 中为 FileWorkspace 包裹 `<ErrorBoundary fallback={...} />`
- [x] 6.5: 在 `App.tsx` 中为 SessionCenter 包裹 `<ErrorBoundary fallback={...} />`

## Task 7: 补充缺失的加载态和空态
为异步操作添加加载指示器，为空数据添加引导提示。

- [x] 7.1: SkillsPanel — 已有 loading 和 empty 状态（SkillsMarketplace、InstalledAddons、PiPackagesMarketplace 子组件均已覆盖）
- [x] 7.2: SessionCenter — 加载中显示 loading，无会话时显示空态提示 + 新建按钮
- [x] 7.3: GitPanel — 已有 loading 和 not-initialized 状态
- [x] 7.4: FileWorkspace — 空目录时显示"目录为空"提示

---

# Task Dependencies
- [Task 3] 必须在 [Task 4] 和 [Task 5] 之前完成（toast 系统是错误反馈的基础）
- [Task 1] 和 [Task 2] 可并行执行
- [Task 6] 和 [Task 7] 可并行执行
- [Task 4] 和 [Task 5] 依赖 [Task 3]
