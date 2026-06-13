# 修复 Pi Agent Desktop 全部可用性问题 Spec

## Why
Pi Agent Desktop 存在多处可用性缺陷：计划模式无限循环、错误静默吞没、流式状态竞态、缺少用户反馈等，导致产品无法作为成熟的 GUI 开发工具使用。需要系统性修复所有影响用户体验的问题。

## What Changes
- 修复计划模式无限循环（重复事件处理 + 状态竞态）
- 修复流式事件处理中的竞态条件（`turn_end`/`agent_end` 冲突、`toolcall_start`/`tool_execution_start` 互斥丢失）
- 修复计划模式 `setEnabled` 回滚逻辑错误
- 修复 `isGenericPlanGuidance` 误判有效计划内容
- 为所有 store 的 catch 块添加用户可见的错误反馈
- 添加统一的 toast 通知系统用于瞬态错误/成功提示
- 为关键面板添加 ErrorBoundary 包裹
- 修复流式持久化失败无用户反馈
- 修复 stopStreaming 失败无用户反馈
- 添加缺失的加载态和空态 UI

## Impact
- Affected specs: 流式事件处理、计划模式、错误处理、UI 反馈
- Affected code:
  - `apps/desktop/src/renderer/src/hooks/usePiStream.ts` — 核心流式事件处理
  - `apps/desktop/src/renderer/src/stores/plan-store.ts` — 计划模式状态机
  - `apps/desktop/src/renderer/src/stores/skills-store.ts` — 技能面板错误处理
  - `apps/desktop/src/renderer/src/stores/pi-packages-store.ts` — 包管理错误处理
  - `apps/desktop/src/renderer/src/stores/workspace-store.ts` — 工作区错误处理
  - `apps/desktop/src/renderer/src/stores/settings-store.ts` — 设置错误处理
  - `apps/desktop/src/renderer/src/stores/session-store.ts` — 会话错误处理
  - `apps/desktop/src/renderer/src/stores/agent-store.ts` — Agent 错误处理
  - `apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx` — 输入错误反馈
  - `apps/desktop/src/renderer/src/components/ChatView/ChatView.tsx` — 聊天视图错误边界
  - `apps/desktop/src/renderer/src/App.tsx` — 全局 toast + 面板 ErrorBoundary
  - `apps/desktop/src/main/ipc/chat.ipc.ts` — IPC 错误传递

---

## ADDED Requirements

### Requirement: 流式事件去重与状态一致性
系统 SHALL 正确处理 Pi CLI 可能发送的重复事件，并保证流式状态机的一致性。

#### Scenario: 重复 agent_start 事件
- **WHEN** Pi CLI 在流式过程中发送重复 `agent_start` 事件
- **THEN** 系统 SHALL 保留已有文本内容，仅重置工具调用状态，不覆盖用户可见的流式内容

#### Scenario: turn_end 与 agent_end 竞态
- **WHEN** `turn_end` 先到达将 `isStreaming` 设为 false，随后 `agent_end` 到达
- **THEN** 系统 SHALL 在 `agent_end` 中检查当前流式状态，避免重复重置或覆盖后续 turn 的状态
- **AND** 如果 `agent_end` 到达时已有新的 `agent_start`（新 turn），SHALL 不重置新 turn 的状态

#### Scenario: toolcall_start 与 tool_execution_start 互斥
- **WHEN** `tool_execution_start` 先于 `toolcall_start` 到达（同一 toolCallId）
- **THEN** 系统 SHALL 仍能正确创建并显示工具调用卡片
- **AND** 后续到达的 `toolcall_start` SHALL 补充工具名称等信息，不跳过

### Requirement: 计划模式状态机健壮性
系统 SHALL 保证计划模式状态转换的正确性和可预测性。

#### Scenario: setEnabled IPC 失败回滚
- **WHEN** `plan:set-enabled` IPC 调用返回错误
- **THEN** 系统 SHALL 将 `enabled` 恢复到调用前的值（而非 `!enabled`）
- **AND** 向用户显示错误提示

#### Scenario: isGenericPlanGuidance 误判
- **WHEN** 计划内容包含具体执行步骤但同时也包含目标描述
- **THEN** 系统 SHALL NOT 将其判定为通用引导并过滤
- **AND** 只有当内容确实不包含任何具体计划要素时才判定为通用引导

#### Scenario: 计划模式两步澄清流竞态
- **WHEN** 用户在 `pendingPlanClarification` 状态下快速发送消息
- **THEN** 系统 SHALL 正确合并内容并发送 `/plan` 命令
- **AND** 不会因 `agent_start`/`turn_end` 事件与状态转换的竞态导致无限循环

### Requirement: 统一错误反馈机制
系统 SHALL 提供统一的 toast 通知系统，确保所有错误对用户可见。

#### Scenario: Store 操作失败
- **WHEN** 任何 store 操作（技能搜索/安装、包管理、工作区创建/删除、设置保存、会话加载）失败
- **THEN** 系统 SHALL 通过 toast 通知向用户显示错误信息
- **AND** 提供"重试"按钮（如果操作可重试）

#### Scenario: 流式持久化失败
- **WHEN** 消息内容持久化到磁盘失败
- **THEN** 系统 SHALL 通过 PersistenceBanner 或 toast 向用户提示
- **AND** 不影响当前流式内容的显示

#### Scenario: 停止流式失败
- **WHEN** 用户点击停止按钮但 IPC 调用失败
- **THEN** 系统 SHALL 向用户显示错误提示
- **AND** 仍将本地流式状态重置为非流式

#### Scenario: IPC 发送消息失败
- **WHEN** `pi:send` IPC 返回 IpcError
- **THEN** 系统 SHALL 在聊天界面中显示错误消息（作为 assistant 消息或 toast）
- **AND** 重置流式状态

### Requirement: 面板级 ErrorBoundary
系统 SHALL 为每个主要面板包裹 ErrorBoundary，防止单个面板崩溃导致整个应用白屏。

#### Scenario: ChatView 渲染崩溃
- **WHEN** ChatView 组件内发生未捕获的渲染错误
- **THEN** 系统 SHALL 显示 ChatView 的错误回退 UI（带重试按钮）
- **AND** 不影响侧边栏、右栏等其他面板的正常使用

#### Scenario: SkillsPanel 渲染崩溃
- **WHEN** SkillsPanel 组件内发生未捕获的渲染错误
- **THEN** 系统 SHALL 显示 SkillsPanel 的错误回退 UI
- **AND** 不影响聊天面板等其他面板

### Requirement: 缺失的加载态和空态
系统 SHALL 为所有异步操作提供加载态指示，为空数据提供空态提示。

#### Scenario: 工作区列表为空
- **WHEN** 用户没有配置任何工作区
- **THEN** 系统 SHALL 显示引导用户创建工作区的空态 UI

#### Scenario: 技能市场搜索中
- **WHEN** 技能市场搜索请求进行中
- **THEN** 系统 SHALL 显示加载指示器

## MODIFIED Requirements

### Requirement: usePiStream 事件处理
原实现中 `agent_start` 的重复检测逻辑在已有文本时仅重置工具调用，但 `turn_end` 和 `agent_end` 都会设置 `isStreaming=false`，可能导致中间 turn 结束后下一个 turn 的 `agent_start` 被误判为重复。

修改后：
- `turn_end` SHALL 仅标记当前 turn 结束，不重置 `isStreaming`（因为 agent 可能还有后续 turn）
- `agent_end` SHALL 标记整个 agent 会话结束，重置 `isStreaming`
- `agent_start` 的重复检测 SHALL 基于 turn 级别而非 agent 级别

### Requirement: plan-store setEnabled 回滚
原实现中 `setEnabled` 失败时使用 `set({ enabled: !enabled })` 回滚，这在多次快速切换时可能回滚到错误状态。

修改后：
- `setEnabled` SHALL 在调用 IPC 前保存当前 `enabled` 值
- 失败时 SHALL 恢复到保存的值
- SHALL 向用户显示错误提示

### Requirement: isGenericPlanGuidance 判定
原实现中只要内容包含"目标"等关键词就判定为通用引导，可能误判包含具体步骤的计划。

修改后：
- 判定逻辑 SHALL 优先检查是否有具体执行步骤
- 只有在没有任何具体计划要素（步骤、标题、代码块）时才判定为通用引导
- 增加"包含具体步骤列表"的否定条件权重
