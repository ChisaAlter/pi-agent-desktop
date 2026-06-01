# 实施计划: Codex App 对齐

## Phase 1: UI 主题统一 (当前)

### Task 1.1: 统一 Sidebar 组件为浅色主题
- 文件: `apps/desktop/src/renderer/src/components/Sidebar/Sidebar.tsx`
- 改动: 暗色系 → 浅色系，与 App.tsx 和 DESIGN.md 一致
- 验证: 截图对比，颜色一致性检查

### Task 1.2: 优化 ChatView 组件
- 文件: ChatView.tsx, MessageBubble.tsx, ChatInput.tsx
- 改动: 优化流式渲染、Markdown 代码块复制按钮、多行输入
- 验证: 发送消息测试

### Task 1.3: 增强 ToolCallCard 可视化
- 文件: ToolCallCard.tsx, CommandCard.tsx
- 改动: 统一样式、添加文件路径显示、改进输出格式化
- 验证: 工具调用渲染测试

## Phase 2: 代码 Diff 视图

### Task 2.1: 实现 DiffViewer 组件
- 新文件: `components/DiffView/DiffViewer.tsx`
- 改动: 解析 unified diff、语法高亮、行号
- 依赖: 可能需要 diff 库

### Task 2.2: 增强工具调用的 Diff 渲染
- 文件: ToolCallCard.tsx, CommandCard.tsx
- 改动: read/write/edit 自动渲染 diff

## Phase 3: 任务侧边栏

### Task 3.1: 重设计 FloatingPanel
- 文件: FloatingPanel.tsx
- 改动: 从静态面板改为实时任务追踪

### Task 3.2: 实现进度状态机
- 新文件: stores/task-store.ts
- 改动: 任务状态管理

## Phase 4: 内置终端

### Task 4.1: 集成 xterm.js
- 新文件: components/Terminal/
- 依赖: xterm.js, xterm-addon-fit

## Phase 5: 线程管理

### Task 5.1: 线程模型
- 改动: stores/session-store.ts → thread-store.ts

### Task 5.2: 线程列表 UI
- 文件: Sidebar 组件扩展
