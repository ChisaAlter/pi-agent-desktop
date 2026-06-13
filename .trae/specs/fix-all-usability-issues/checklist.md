# Checklist

## 流式事件状态机
- [x] `turn_end` 不再设置 `isStreaming=false`，仅标记 turn 结束
- [x] `agent_end` 是设置 `isStreaming=false` 的唯一权威位置
- [x] `agent_start` 重复检测基于 turn 级别，不会误判新 turn 为重复
- [x] `toolcall_start` 和 `tool_execution_start` 无论到达顺序如何都能正确创建工具调用
- [x] 同一 toolCallId 的 `toolcall_start` + `tool_execution_start` 不会互相跳过

## 计划模式状态机
- [x] `setEnabled` IPC 失败时恢复到调用前的精确值（非 `!enabled`）
- [x] `setEnabled` 失败时用户能看到错误提示
- [x] `isGenericPlanGuidance` 不会误判包含具体步骤的计划内容
- [x] 包含执行步骤列表的计划内容始终被保留
- [x] 计划模式两步澄清流不会因事件竞态导致无限循环

## Toast 通知系统
- [x] Toast 组件正确渲染并自动消失
- [x] Toast 支持错误/成功/警告三种 tone
- [x] Toast 支持可选的重试按钮
- [x] 多个 toast 可同时显示且不重叠

## Store 错误反馈
- [x] skills-store 所有操作失败时用户能看到 toast 提示
- [x] pi-packages-store 所有操作失败时用户能看到带重试按钮的 toast
- [x] workspace-store 操作失败时用户能看到 toast 提示
- [x] settings-store 操作失败时用户能看到 toast 提示
- [x] session-store 加载失败时用户能看到 toast 提示
- [x] agent-store 创建失败时用户能看到 toast 提示

## 流式错误反馈
- [x] 流式持久化失败时用户能看到提示
- [x] 停止流式失败时用户能看到 toast 提示
- [x] `pi:send` 返回 IpcError 时聊天界面显示错误消息
- [x] `startStreaming` catch 块中用户能看到 toast 提示

## ErrorBoundary
- [x] ChatView 崩溃时显示错误回退 UI，不影响其他面板
- [x] SkillsPanel 崩溃时显示错误回退 UI，不影响其他面板
- [x] GitPanel 崩溃时显示错误回退 UI，不影响其他面板
- [x] FileWorkspace 崩溃时显示错误回退 UI，不影响其他面板
- [x] SessionCenter 崩溃时显示错误回退 UI，不影响其他面板

## 加载态和空态
- [x] SkillsPanel 搜索中显示 loading 指示器（已有）
- [x] SkillsPanel 无结果时显示空态提示（已有）
- [x] SessionCenter 加载中显示 loading
- [x] SessionCenter 无会话时显示空态提示
- [x] GitPanel 加载中显示 loading（已有）
- [x] FileWorkspace 加载中显示 loading（已有）

## 回归测试
- [x] `pnpm build` 构建成功
- [x] 所有现有单元测试通过（734 passed, 2 skipped）
- [x] 新增单元测试通过（usePiStream 4个 + plan-store 15个）
