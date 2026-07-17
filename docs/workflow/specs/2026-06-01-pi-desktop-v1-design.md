# Pi Desktop v1.0 — 设计 Spec

**日期**: 2026-06-01
**状态**: 草稿, 待用户审阅
**作者**: 头脑风暴会话 (Mavis + 用户)

---

## 1. 目标

发布一个精致的、开源的 Windows 桌面 GUI, 为 [Pi](https://github.com/earendil-works/pi-coding-agent) 服务, 满足:

- **长得像、感觉像** MiniMax Code (Mavis) — 三列布局, 浅色主题, 大留白, 右侧双面板 (进度 + 工作文件夹)
- **保留 Pi 的招牌特色**: 通过 Skills / Providers / Plugins 自由扩展
- **默认安全** 通过分层工具审批
- **不是花架子**: 每个 UI 元素都接通真实数据流

## 2. 非目标 (v1.0)

- macOS / Linux 支持 (v1.1+)
- 埋点 / 云同步 / 账户体系
- 我们自己托管的 marketplace 后端
- 超出 "用 Monaco 高亮编辑 SKILL.md" 的插件开发 IDE
- 多窗口、多账户、协作功能

## 3. 目标用户

满足以下条件的开发者:

- 现在就在用 Pi CLI (或想用)
- 想要一个精致的 GUI 替代终端
- 喜欢 Mavis / MiniMax Code 的 UX, 想在 Pi 上也得到同样的体验
- 会给 Pi 加 skills / providers / plugins 来适配自己的工作流
- 运行 Windows 10/11

## 4. 参考产品

**MiniMax Code (Mavis)** — 用户提供截图作为视觉基准。核心设计语言:

- **三列布局** (左导航 + 中聊天 + 右双面板)
- **浅色 + 高对比文字 + 低饱和背景** 配色 (`#FFFFFF` / `#F7F7F7` / 纯黑文字)
- **大留白**, 段落间距宽, 阅读压力小
- **大圆角** (主容器 12-20px, 标签 4-6px)
- **结构化元数据** (键值表 + Pill 标签) 与对话流分离
- **悬浮感输入框** (stadium shape, 高圆角矩形), 居中悬浮, 不贴底
- **右侧双面板** (进度 checklist + 工作文件夹文件列表)
- **模态化设置** (60-70% 屏宽, 半透明遮罩 + 模糊, 左侧导航 + 右侧内容)
- **底部用户菜单** (UID / 订阅 / 切换到经典 / 设置 / 用户指南 / 退出)

参考细节 (从截图中识别):
- 主题切换: 浅色 / 深色 / 跟随系统, 选中态用蓝色细边框
- 进度项: 完成时字体变灰 + 中划线
- 圆角: 大容器 12-20px, 标签/按钮 4-6px
- 字体: 系统无衬线 (PingFang SC / Inter), 行高约 1.6
- Pill 标签: 蓝紫/淡蓝/淡灰背景, 不抢注意力
- 选中菜单: 浅灰 `#F0F0F0` 圆角背景

## 5. 架构

### 5.1 三层 + 每个 workspace 一个常驻进程

```
┌─────────────────────────────────────────────────────────┐
│ Renderer (React)                                         │
│  ├─ 3 列布局: LeftNav (合并图标栏+项目) | Chat | RightPanel │
│  ├─ Zustand stores: session, workspace, approval,        │
│  │  skills, settings, tasks, search, ui                  │
│  └─ contextBridge: window.piAPI / window.shellAPI        │
└────────────────┬────────────────────────────────────────┘
                 │ IPC (类型化)
┌────────────────┴────────────────────────────────────────┐
│ Main Process (Electron)                                  │
│  ├─ WindowManager       窗口/托盘/快捷键                 │
│  ├─ WorkspaceManager    workspace 元数据 + 切换          │
│  ├─ PiSessionManager ⭐ 每个 workspace 1 个长连接 Pi 进程│
│  │    ├─ ProcessSupervisor  生命周期 / 重启 / 崩溃恢复   │
│  │    ├─ EventBridge        JSON 事件 → IPC 广播        │
│  │    ├─ ApprovalInterceptor 分层工具审批               │
│  │    └─ HistoryBuffer      内存 + 持久化              │
│  ├─ SkillsManager       本地扫描 / 启用 / 安装          │
│  ├─ GitService          状态/diff/log/blame/undo        │
│  ├─ ShellManager ⭐     node-pty 多 tab 终端            │
│  ├─ FileSearcher        ripgrep + SQLite FTS5            │
│  └─ AutoUpdater         electron-updater → GitHub        │
└────────────────┬────────────────────────────────────────┘
                 │ spawn / pipe
┌────────────────┴────────────────────────────────────────┐
│ 外部进程                                                 │
│  ├─ pi-coding-agent (每个 workspace 1 个, 长连接)        │
│  └─ node-pty shells (每个 terminal tab 一个 PowerShell)  │
└─────────────────────────────────────────────────────────┘
```

### 5.2 关键决策

| 决策 | 选择 | 原因 |
|------|------|------|
| Pi 调用方式 | 每个 workspace 长连接 | 真多轮, 状态在 Pi 进程内, 更便宜 |
| 多 workspace | 并发 Pi 进程 | 状态独立, 不互相污染 |
| Pi 崩溃 | 自动重启最多 3 次, 然后弹对话框 | 应用不能跟着 Pi 一起挂 |
| 审批 | 分层 (见 §7) | 在安全和摩擦之间取平衡 |
| 会话持久化 | 双层 (Pi 内存 + electron-store) | 崩溃也不丢 |
| Skills 数据源 | 本地 + SkillHub CLI + GitHub 导入 | 不需要我们自己维护中央市场 |
| 终端 | node-pty + xterm.js, 多 tab | 真 PTY, TUI 应用能跑 |
| 自动更新 | electron-updater + GitHub Releases | OSS 标准做法 |
| IPC | `packages/shared-types` 类型化契约 | 自带文档, 贡献者友好 |

### 5.3 失败模式

- **Pi 进程 OOM/segfault**: Supervisor 捕获, 自动重启最多 3 次, 失败后弹 "Pi 崩了" 对话框, 附 "复制日志" 按钮
- **electron-store 损坏**: 备份损坏文件, 重建空配置, 弹警告
- **workspace 路径被删**: 标记为 `missing`, 不自动删除记录
- **同一 workspace 重复打开**: 复用现有 Pi 进程 (pid 去重)
- **离线**: registry / GitHub / SkillHub API 失败静默降级, 不阻塞启动

## 6. 关键流程

### 6.1 聊天发送 (主路径)

```
[Renderer] ChatInput → useChatStore.send(text)
  → ipc: pi:send(workspaceId, text, attachments)
  → [Main] PiSessionManager.sendPrompt(workspaceId, text)
    1. 从 HistoryBuffer 取出上一轮历史
    2. 交给当前 workspace 的 Pi 进程 stdin
    3. 标记 streaming=true
  → Pi 进程 stdout: JSONL 事件
  → [Main] EventBridge 解析:
    - text_delta       → ipc: pi:event → renderer 追加到当前消息
    - thinking_delta   → ipc: pi:event → renderer 更新 ThinkingBlock
    - tool_execution_start → ApprovalInterceptor.classify()
    - tool_execution_end   → ipc: pi:event (tool 卡片更新)
    - turn_end         → streaming=false, HistoryBuffer.flush()
```

### 6.2 分层审批 (核心创新)

```
Pi 发出 tool_execution_start { name, args }
  │
  ▼
ApprovalInterceptor.classify(tool):
  │
  ├─ HIGH_RISK (高危)
  │    硬编码清单 (配置可覆盖):
  │      • bash 子命令含: rm -rf /, sudo, mkfs, dd,
  │        chmod 777 /, curl|sh, force push, git reset --hard
  │      • 写路径匹配: ~/.ssh/**, ~/.aws/**, /etc/**,
  │        .git/hooks/**, .git/config
  │    动作:
  │      1. 暂停 Pi 进程 (Unix SIGSTOP, Windows suspend)
  │      2. ipc: approval:request { risk: 'high', preview, options }
  │      3. 等用户响应
  │      4. 通过: 恢复 Pi (SIGCONT)
  │      5. 拒绝: 中止工具, 通知 Pi 取消
  │
  ├─ FILE_EDIT (文件编辑, write/edit/批量)
  │    动作:
  │      1. 不暂停 Pi
  │      2. 记录到 _pendingEdits: { toolCallId, filePath,
  │         oldContent (事前读), newContent }
  │      3. ipc: approval:deferred { toolCallId }
  │      4. tool_execution_end 时: 读最新文件 → diff →
  │         ipc: approval:review { toolCallId, diff, options:
  │         [Approve | Reject | Undo] }
  │      5. "Undo" = `git checkout -- <file>` (git 仓库) 或
  │         用记录的 oldContent 还原
  │
  └─ READ_ONLY (read/grep/ls/glob 等)
       动作: 不拦截, 只显示 tool call 卡片。
```

### 6.3 Skills: 市场 + 安装 + 管理

**市场 tab** (用 SkillHub CLI):
```
[Renderer] SkillsMarketplace
  → ipc: skills:search(query, filter)
  → [Main] exec('skillhub search ' + query), 解析输出
  → ipc: skills:results → renderer 渲染卡片
  → 用户点安装
  → ipc: skills:install(name)
  → [Main] exec('skillhub install ' + name, cwd=workspace)
  → 成功: 重新扫描 ~/.pi/agent/skills/ → ipc: skills:updated
```

**我的 tab** (本地技能):
```
ipc: skills:list → 重新扫描 ~/.pi/agent/skills/ + .agents/skills/
ipc: skills:toggle(name, enabled) → 写 .state.json
ipc: skills:uninstall(name) → rm -rf ~/.pi/agent/skills/<name>
```

**+ 创建菜单** (3 个选项):
- 💬 **用 Pi 构建** — 打开聊天, 预填 "帮我写一个 skill, 它..." 提示词
- ✏️ **编写技能** — Monaco 编辑器, 左侧 SKILL.md 模板, 右侧 live preview
- 🔗 **从 GitHub 导入** — 输入 GitHub URL → 拉 SKILL.md → 校验 → 安装

> **注意**: SkillHub 主要为 OpenClaw agent 设计。我们需要在 `services/skills/skillhub-adapter.ts` 里加一层**适配器**, 把 OpenClaw 格式的 skill normalize 成 Pi 的 SKILL.md 格式, 或者确认 Pi 能直接读。**开放问题 — M3 spike 时验证。**

### 6.4 Ctrl+K 命令面板

```
Ctrl+K → 打开 CommandPalette (模态)
  ├─ 模式 1: 文件搜索 (ripgrep, 模糊匹配)
  ├─ 模式 2: 历史搜索 (SQLite FTS5, 跨所有 session)
  └─ 模式 3: 命令 (新建对话 / 切 workspace / 装 skill)
  结果流式回推 ipc: search:results
```

### 6.5 终端

```
[Renderer] TerminalPanel 多 tab
  → ipc: shell:create(tabId, cwd=workspacePath)
  → [Main] ShellManager.spawn(node-pty, 'powershell.exe', cwd, env)
  → 输出流: ipc: shell:output { tabId, data }
  → 输入: ipc: shell:input(tabId, data)
  → 调整大小: ipc: shell:resize(tabId, cols, rows) — 真 PTY resize
  → 关闭: ipc: shell:close(tabId) → kill

每个 workspace 默认 1 个 terminal tab, + 按钮加更多。
Ctrl+\` 切换显隐。
```

### 6.6 工作文件夹面板 (右栏第二块)

跟踪本轮对话中 agent 引用 / 创建 / 修改过的文件, 显示在右栏第二块"工作文件夹"。

```
[Main] ApprovalInterceptor 拦截到 write/edit/多文件批量工具时:
  → 把 filePath 推 ipc: referenced-files:add { path, op: 'write'|'edit' }
[Main] Read 工具 (user 主动 @file 引用的):
  → 把 filePath 推 ipc: referenced-files:add { path, op: 'read' }

[Renderer] ReferencedFilesStore 累积, 去重, 按时间倒序
  → 渲染在右栏 WorkingFolderPanel
  → 列表项: 📄 文件名 (省略过长) + 文件路径 tooltip
  → 点击 → 跳到文件 (通过 ipc: file:reveal 调出 OS 文件管理器)
```

### 6.7 进度面板 (右栏第一块)

显示当前 agent 任务的 sub-tasks, 用 checklist 形式:

```
[Renderer] 监听 Pi 发出的 task_start / task_end 事件
  → ProgressStore 维护 [{ id, label, status: 'pending'|'running'|'completed' }]
  → 渲染: ● 步骤描述 (完成时变灰 + 中划线)

Pi 在执行一个长任务时, 拆出子步骤 (例如: "读 package.json", "修改 tsconfig", "跑 typecheck")
这些子步骤显示在右栏, 用户实时看到 agent 在干啥
```

**注意**: Pi CLI 当前可能没有显式暴露 "sub-task" 事件。如果 Pi 自己不发, 进度面板只能显示我们从 tool calls 推断的步骤 (每次 tool_execution_start = 一个新步骤)。**M1 spike 时验证**。

## 7. UI 结构

### 7.1 三列布局

```
┌──────────┬───────────────────────────────┬──────────────┐
│ 240px    │ flex-1                         │ 280px        │
│          │                                │              │
│ 左导航    │ 中间聊天                       │ 右双面板      │
│ (合并     │                                │              │
│ (合并栏)  │  ┌─ Workspace Header ─┐        │  进度 ▾      │
│ + Proj)  │  │ 了解项目 ▾         │        │  ▢ 步骤 1    │
│          │  ├──────────────────┤        │  ✓ 步骤 2    │
│ [新对话]  │  │                  │        │  ▢ 步骤 3    │
│ [技能]   │  │  消息流           │        │              │
│ [定时]   │  │  (Markdown 渲染)  │        │  工作文件夹 ▾│
│ [手机]   │  │                  │        │  📄 spec.md  │
│          │  │                  │        │  📄 other.md │
│ 项目 ▾   │  │                  │        │              │
│  了解项目●│  │                  │        │              │
│          │  │                  │        │              │
│ 历史 ▾   │  │                  │        │              │
│  ...     │  │                  │        │              │
│          │  │                  │        │              │
│ Agents ▾ │  ├──────────────────┤        │              │
│ 已归档 ▾ │  │  ⊕输入框(stadium) │        │              │
│          │  │ [+][授权▾] [模型▾]⏎       │              │
│ [用户]   │  └──────────────────┘        │              │
└──────────┴───────────────────────────────┴──────────────┘
```

- **左导航 (240px, 可折叠)**: 顶部快速操作 (新对话 / 技能 / 定时任务 / 连接手机) + 分组的 workspace / 历史 / Agents / 已归档 列表 + 底部用户区
- **中间 (flex)**: workspace header + 消息流 + 悬浮输入框
- **右双面板 (280px, 每块独立折叠)**: 进度 checklist + 工作文件夹文件列表

### 7.2 关键交互与快捷键

| 操作 | 快捷键 | 备注 |
|------|--------|------|
| 全局搜索 | `Ctrl+K` | 命令面板 |
| 新建对话 | `Ctrl+N` | 当前 workspace |
| 切换 workspace | `Ctrl+P` | workspace 切换器 |
| 打开 skills | `Ctrl+Shift+S` | 跳到 Skills 页 |
| 切换终端 | `Ctrl+\`` | 已存在 |
| 折叠/展开左导航 | `Ctrl+B` | 收起为图标条 |
| 折叠/展开右面板 | `Ctrl+J` | 收起整个右栏 |
| 通过高危工具 | `Y` | 审批弹窗聚焦时 |
| 拒绝高危工具 | `N` | 同上 |
| 发送消息 | `Enter` | |
| 换行 | `Shift+Enter` | |
| 跳到底部 | `Ctrl+End` | 滚动到最新消息 |

### 7.3 Skills 页面布局 (匹配参考)

```
技能  [市场 | 我的]  [全部 | 官方 | 贡献]  [搜索...]  [热门▾]   [+ 创建]
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ 卡片    │ │ 卡片    │ │ 卡片    │ │ 卡片    │
│ 标题    │ │ 标题    │ │ 标题    │ │ 标题    │
│ 描述    │ │ 描述    │ │ 描述    │ │ 描述    │
│ @作者  │ │ @作者  │ │ @作者  │ │ @作者  │
│ 使用次数│ │ 使用次数│ │ 使用次数│ │ 使用次数│
└─────────┘ └─────────┘ └─────────┘ └─────────┘
... (4 列网格, 分页) ...
```

**+ 创建下拉** (点 + 后):
- 💬 用 Pi 构建 — 让 Pi 帮忙起草 skill
- ✏️ 编写技能 — Monaco 编辑器
- 🔗 从 GitHub 导入 — 粘 URL

### 7.4 设置弹窗 (模态)

```
┌─────────────────────────────────────────────┐
│  设置                            × 关闭     │
│ ┌──────┐                                    │
│ │ ⊙外观 │  外观                             │
│ │  账户 │  ┌──────┐ ┌──────┐ ┌──────┐        │
│ │  用量 │  │ 浅   │ │ 深   │ │ 跟随 │        │
│ ├──────┤  │  色  │ │  色  │ │ 系统 │        │
│ │  通用 │  └──────┘ └──────┘ └──────┘        │
│ │      │   浅色     深色     ●跟随            │
│ └──────┘                                    │
└─────────────────────────────────────────────┘
  (黑色半透明遮罩 + 模糊背景)
```

- 居中, 屏宽 60-70%, 高 60-70%
- 左侧导航: 外观 (图标+文字, 选中态浅灰圆角背景)
- 右侧内容: 大标题 + X 关闭, 下方控件
- 主题切换: 3 张横向缩略图卡片, 选中态蓝边框
- 弹窗圆角 20-24px, 内部 8-12px
- 大面积柔和投影

### 7.6 核心 UI 模式 (从参考截图提炼)

- **结构化数据 + 对话流分离**: 像"文件路径"、"CLI 命令"这种键值对用 Pill 标签固定在消息顶部, 不全塞在对话气泡里
- **悬浮输入框**: 居中悬浮, 不贴底; 圆角矩形 (stadium shape); 背景纯白 + 浅灰细边框 + 微弱投影; 左右留页边距
- **多面板独立折叠**: 右栏的"进度"和"工作文件夹"各带 `▾` 箭头, 可独立展开/收起
- **大留白**: 段落间 32-48px, 段落内行高 1.6
- **选中态**: 菜单项用浅灰圆角背景 (`#F0F0F0`), 不加重颜色
- **完成态**: checklist 完成项字体变灰 + 中划线, 视觉清晰区分"已做"和"待做"
- **主题切换三宫格**: 横向卡片缩略图, 选中态蓝边框, 比下拉框更直观

### 7.7 文件树归宿 (新布局衍生问题)

Mavis Code 参考布局没有"文件树"组件。原 Pi Desktop 的 `FileTreeView` 在新布局下需要重新考虑放哪:

- **方案 A**: 收进 workspace 详情弹窗 (点 workspace 名字弹窗, 内嵌文件树)
- **方案 B**: 在 `LeftNav` 下方可折叠区域 (默认折叠, 点击展开)
- **方案 C**: 完全删除独立文件树, 改用 `@` 引用 + Ctrl+K 搜索代替
- **方案 D**: 集成到 chat 里 (agent 自动注入相关文件, 用户无需手动浏览)

**推荐 D** — 在 Mavis Code 风格的 chat 体验下, 显式文件树反而是累赘。让 Pi 自己根据对话上下文智能注入相关文件。**M1 spike 验证 Pi 是否有"自动注入 workspace 文件"的能力**。

```
┌──────────────────────┐
│ UID: 4994116895...   │
│ Default              │
│ Plus Plan    [升级]  │
├──────────────────────┤
│ ⤺ 切换到经典          │
│ ⚙ 设置                │
│ ?  用户指南            │
│ 💬 联系我们         › │
│ 📄 了解更多         › │
│ ⤴ 退出登录            │
└──────────────────────┘
  (卡片浮窗, 紧贴头像上方)
```

- 顶部: UID + 账户名 + 订阅计划 + 升级按钮 (黑色胶囊, 仅订阅用户显示)
- 中间: 6 个菜单项, 图标 + 文字, 部分带 › 表示有二级菜单
- 触发: 点击左下角头像/用户名区域

### 7.8 用户菜单 (左下角点击头像展开)

## 8. 组件拆解

### 8.1 Renderer

```
src/renderer/src/
├── App.tsx                          # 3 列 shell
├── stores/
│   ├── session-store.ts             # 当前 session + 消息流
│   ├── workspace-store.ts
│   ├── approval-store.ts            # 分层队列
│   ├── skills-store.ts              # 市场 + 我的 skills
│   ├── progress-store.ts            # 右侧进度 checklist
│   ├── referenced-files-store.ts    # 右侧工作文件夹
│   ├── settings-store.ts
│   ├── search-store.ts              # Ctrl+K 状态
│   └── ui-store.ts                  # 面板显隐, 主题, 主题模式
├── components/
│   ├── LeftNav/                     # 合并的 240px 左侧导航
│   │   ├── LeftNav.tsx              # 容器
│   │   ├── QuickActions.tsx         # 顶部快速操作
│   │   ├── WorkspaceList.tsx        # 项目分组
│   │   ├── HistoryList.tsx          # 历史
│   │   ├── AgentsList.tsx           # Agents 分组
│   │   ├── ArchivedList.tsx         # 已归档
│   │   └── UserMenu.tsx             # 左下角用户菜单
│   ├── ChatView/
│   │   ├── MessageBubble.tsx
│   │   ├── MarkdownRenderer.tsx
│   │   ├── CodeBlock.tsx
│   │   ├── ThinkingBlock.tsx        # 可折叠的推理
│   │   ├── ToolCallCard.tsx
│   │   ├── CommandCard.tsx
│   │   ├── ChatInput.tsx            # 悬浮 stadium shape
│   │   ├── AttachmentChip.tsx       # @文件/图片预览
│   │   ├── MentionPopover.tsx       # @ 触发的下拉
│   │   └── WorkspaceHeader.tsx      # 顶部 workspace 切换
│   ├── RightPanel/                  # 280px 右双面板
│   │   ├── ProgressPanel.tsx        # 进度 checklist
│   │   └── WorkingFolderPanel.tsx   # 工作文件夹 (本轮引用的文件)
│   ├── ApprovalPanel/
│   │   ├── HighRiskModal.tsx        # 预审批门
│   │   └── EditReviewList.tsx       # 事后审批 diff 队列
│   ├── SkillsPanel/
│   │   ├── SkillsMarketplace.tsx    # 市场 tab
│   │   ├── MySkills.tsx             # 我的 tab
│   │   ├── SkillCard.tsx
│   │   └── SkillCreateDropdown.tsx
│   ├── SkillEditor/                 # Monaco 写的 SKILL.md 编辑器
│   ├── Terminal/
│   ├── GitPanel/
│   ├── CommandPalette/              # Ctrl+K
│   ├── SettingsModal/               # 模态设置弹窗
│   │   ├── SettingsModal.tsx        # 容器 + 遮罩
│   │   ├── SettingsNav.tsx          # 左侧导航
│   │   ├── AppearanceSettings.tsx   # 外观 (主题)
│   │   ├── AccountSettings.tsx
│   │   ├── UsageSettings.tsx
│   │   ├── GeneralSettings.tsx
│   │   └── ThemeCard.tsx            # 主题缩略图卡片
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
├── index.ts                         # app 启动 + DI
├── window-manager.ts
├── ipc/                             # IPC 路由层 (按域分文件)
│   ├── chat.ipc.ts
│   ├── workspace.ipc.ts
│   ├── approval.ipc.ts
│   ├── skills.ipc.ts
│   ├── git.ipc.ts
│   ├── shell.ipc.ts
│   ├── search.ipc.ts
│   └── settings.ipc.ts
├── services/                        # 业务逻辑
│   ├── pi-session/
│   │   ├── manager.ts               # 多 workspace 编排
│   │   ├── process.ts               # 单个 Pi 进程生命周期
│   │   ├── event-bridge.ts          # JSONL → IPC 事件
│   │   ├── approval-interceptor.ts  # 分层审批
│   │   └── history-buffer.ts
│   ├── skills/
│   │   ├── scanner.ts
│   │   ├── installer.ts
│   │   ├── toggler.ts
│   │   └── skillhub-adapter.ts      # ← M3 验证兼容性
│   ├── shell/                       # node-pty 封装
│   ├── git/
│   ├── search/
│   │   ├── file-indexer.ts          # ripgrep
│   │   └── history-indexer.ts       # SQLite FTS5
│   ├── updater.ts                   # electron-updater
│   └── store.ts                     # electron-store schema
└── utils/
    ├── logger.ts
    ├── paths.ts
    └── platform.ts                  # Windows 特定
```

### 8.3 Packages

```
packages/
├── shared-types/                    # 跨进程类型
│   ├── ipc.ts                       # IPC 入参出参
│   ├── events.ts                    # Pi JSON 事件类型
│   ├── pi.ts                        # PiStatus, PiAgentConfig
│   └── approval.ts                  # ApprovalRequest, RiskLevel
└── ui-tokens/                       # 设计 token
    └── tailwind-preset.ts
```

> **清理**: `packages/pi-driver/` 是死代码 (跟 `apps/desktop/src/main/pi-driver.ts` 重复)。**M5 阶段删掉**。

## 9. 数据契约 (类型化)

```ts
// packages/shared-types/src/ipc.ts
export interface IpcContract {
  // Chat
  'pi:send':       (workspaceId: string, text: string, attachments: Attachment[]) => void;
  'pi:stop':       (workspaceId: string) => void;
  'pi:event':      PiEvent;                              // main → renderer 推送
  'pi:history':    (workspaceId: string) => HistorySnapshot;

  // Approval
  'approval:respond':   (requestId: string, decision: 'approve' | 'reject' | 'edit', edit?: string) => void;
  'approval:request':   ApprovalRequest;                 // 推送
  'approval:deferred':  DeferredEdit;                    // 推送
  'approval:review':    FileReview;                      // 推送

  // Skills
  'skills:list':     () => SkillInfo[];
  'skills:search':   (query: string, filter?: SkillFilter) => SkillInfo[];
  'skills:install':  (name: string, source: 'skillhub' | 'github' | 'local') => SkillInfo;
  'skills:toggle':   (name: string, enabled: boolean) => void;
  'skills:uninstall': (name: string) => void;

  // Shell (node-pty 终端)
  'shell:create':  (tabId: string, cwd: string) => void;
  'shell:input':   (tabId: string, data: string) => void;
  'shell:resize':  (tabId: string, cols: number, rows: number) => void;
  'shell:close':   (tabId: string) => void;
  'shell:output':  { tabId: string; data: string };      // 推送

  // Search
  'search:query':   (q: string, mode: 'file' | 'history' | 'cmd') => void;
  'search:results': SearchResults;                       // 推送

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

## 10. 审批风险分层 (具体清单)

### 10.1 HIGH_RISK (需要预审批)

**Bash 子命令匹配**:
- `rm -rf /` 或 `rm -rf ~` (大范围破坏)
- `sudo` 任意命令
- `mkfs`, `dd if=`, `fdisk`
- `chmod 777 /`
- `curl ... | sh` 或 `wget ... | sh`
- `git push --force` 任意分支
- `git reset --hard`
- `npm uninstall -g`
- `pip uninstall` 系统级
- `reg delete` 操作 Windows 注册表

**写路径匹配** (基于路径):
- `~/.ssh/**`
- `~/.aws/**`
- `~/.config/**` (大范围配置目录)
- `~/.bashrc`, `~/.zshrc`, `~/.profile`
- `/etc/**`, `C:\Windows\System32\**`
- `.git/hooks/**`, `.git/config`
- `~/.pi/agent/settings.json` (用户主动保存除外)

### 10.2 FILE_EDIT (事后审批 + 可撤销)

- `write` 工具, `edit` 工具, 多文件批量工具
- Bash: `> file` (写重定向), `sed -i`, `awk ... > file`

### 10.3 READ_ONLY (不弹审批)

- `read`, `grep`, `glob`, `ls`, `find` (有限范围)
- Bash: 查询类命令 (`ls`, `cat`, `head`, `tail`, `git status`, `git log` 等)

> 分类器**可在 settings.json 里配置**, 高手可以覆盖默认规则。

## 11. Skills 集成细节

### 11.1 SkillHub CLI

前置条件 (README 写清楚):
```bash
curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash
```

Pi Desktop 假设 `skillhub` 在 PATH 里。如果不在, 市场 tab 显示:
> "SkillHub CLI 未安装。[安装说明]"

### 11.2 适配器层

`services/skills/skillhub-adapter.ts` 包装 `skillhub` CLI:
```ts
async search(query: string): Promise<SkillInfo[]>
  → exec('skillhub search ' + query)
  → 解析输出 (先试 JSON, 兜底解析表格)
  → 返回 normalize 后的 SkillInfo[]

async install(name: string, workspacePath: string): Promise<SkillInfo>
  → exec('skillhub install ' + name, { cwd: workspacePath })
  → 重新扫描 ~/.pi/agent/skills/<name>/
  → 返回 SkillInfo (校验 SKILL.md 存在)
```

**开放问题**: skillhub 装的是 OpenClaw 格式。需验证 Pi 是否能直接读, 否则实现格式转换。**M3 spike 时验证**。

### 11.3 Skill 格式 (Pi 标准)

```yaml
# SKILL.md frontmatter
---
name: skill-name
description: 一句话描述
author: @handle
version: 1.0.0
tags: [category1, category2]
---

# Skill Instructions (markdown 正文)
...
```

## 12. 分发与发布

- **渠道**: GitHub Releases, 公开
- **安装包**: electron-builder NSIS `.exe`, Windows x64
- **自动更新**: `electron-updater` 检查 GitHub Releases, 提示用户, 下载 delta, 重启
- **版本号**: semver, 每个 release 写 CHANGELOG.md
- **代码签名**: 推迟到 v1.1 (要钱; 用户首次会看到 SmartScreen 警告)
- **分发镜像** (winget / scoop manifest): v1.1 再说

## 13. 工程卫生

### 13.1 测试

- **单元 (vitest)**: 审批分类器, history buffer, IPC 契约类型, 文件扫描, electron-store schema
- **集成**: PiSessionManager 用 mock Pi 进程 (假 JSONL)
- **E2E (Playwright + Electron)**: 冒烟测试 — 聊天发送, 审批流, skill 安装
- **手工 checklist**: 每次发版在全新 Windows 虚拟机上跑一遍

### 13.2 CI

GitHub Actions:
- `ci.yml`: 每个 PR 跑 lint + typecheck + 单元测试
- `release.yml`: tag 推送时构建安装包 → 发布到 GitHub Release

### 13.3 仓库清理 (M5)

- 删 `packages/pi-driver/` (死代码)
- mockup HTML 移到 `docs/design-archive/`
- 删 `ts-errors2.txt`, `app-output.log`
- `test-*.png`, `screenshot-*.png` 移到 `docs/screenshots/`
- `.codebuddy/` 加进 `.gitignore` 或正式提交
- 配 `.gitattributes` 处理行尾

### 13.4 日志与可观测性

- `utils/logger.ts` (electron-log) 写到 `app.getPath('logs')`
- Renderer 错误由 ErrorBoundary 捕获 → main 进程日志
- 设置 → 帮助里加 "打开日志目录" 按钮

## 14. Milestone 拆解

### M1 — 基础 (3 个关键 bug)

1. **Cwd bug 修复**: `pi:prompt` 用 `currentWorkspace.path`, 不是 `process.cwd()`
2. **PiSessionManager 重写**: 每个 workspace 长连接 Pi, 持久 IPC, 历史持久化
3. **ApprovalInterceptor v1**: 分层分类器, HIGH_RISK 预审批门, FILE_EDIT 事后 diff, READ_ONLY 直通

### M2 — 上下文 (UX 支柱)

1. `@ file` mention 解析器 + popover
2. 图片粘贴 (剪贴板 + 拖拽)
3. Ctrl+K CommandPalette (文件 + 历史 + 命令)
4. AttachmentChip 组件

### M3 — Pi 特色 (Skills + 生命周期)

1. SkillsPanel + SkillCard (市场 + 我的)
2. SkillHub 适配器 (验证兼容性)
3. GitHub 导入流程
4. Monaco 写的 SkillEditor
5. PiStatusPanel 打磨 (已存在, 优化)
6. Skill 创建下拉的 3 个选项

### M4 — 终端

1. node-pty + xterm.js 集成
2. 多 tab 终端面板
3. resize / 颜色 / TUI 应用都能跑
4. 每个 workspace 默认一个 tab

### M5 — 工程卫生

1. vitest 搭建, 核心模块单元测试
2. GitHub Actions (ci + release)
3. electron-updater 集成
4. 仓库清理 (删死代码, 归档 mockup, 修 gitignore)
5. README 打磨, CONTRIBUTING.md, issue 模板
6. Renderer 的 ErrorBoundary
7. CHANGELOG.md 首条记录

## 15. 开放问题 (实施前/中验证)

1. **Pi CLI 长连接的具体协议是什么?** — 用户已确认支持长连接, M1 spike 时验证精确的调用 flags 和协议
2. **skillhub 装到 Pi 兼容的路径吗?** — M3 验证
3. **Pi 能直接读 OpenClaw 格式的 skill 吗?** — 若不能, 在 `skillhub-adapter.ts` 实现转换器
4. **Pi 工具调用的 JSON 事件完整 schema 是什么?** — 现有代码里看到 `tool_execution_start` / `_end`, 但要验证完整结构
5. **Pi 如何处理中途取消工具调用?** — 审批 "拒绝" 路径需要
6. **node-pty + xterm 在大输出下的渲染性能?** — M4 spike 验证

## 16. 不在 v1.0 范围

- macOS / Linux 安装包
- 埋点 / 崩溃上报服务端
- 代码签名证书
- 应用内按分类搜索 marketplace
- 语音输入
- AI 生成的 commit message
- Git 面板里切分支
- 超出 SKILL.md 编辑器的插件开发 IDE
- 多账户 / 云同步
- 插件自动更新

## 17. 验收标准

v1.0 满足以下条件算发布:

- [ ] 5 个 milestone 全部完成
- [ ] `pnpm test` 通过, `services/` 覆盖率 ≥60%
- [ ] main 分支每次提交 CI 绿
- [ ] 全新 Windows 10 虚拟机上手工冒烟通过
- [ ] NSIS 安装包能构建并干净安装
- [ ] 从旧版本自动更新能跑通
- [ ] README 有安装 + 使用 + 截图
- [ ] GitHub 仓库有 issue 模板 + CONTRIBUTING.md
- [ ] CHANGELOG.md 写了 v1.0.0 条目

## 18. 参考

- MiniMax Code (Mavis) — 视觉参考 (用户提供截图, 3 张)
- Pi CLI: `@earendil-works/pi-coding-agent` (npm)
- SkillHub: https://skillhub.cn
- electron-vite, React 19, Tailwind 4, Zustand 5 — 当前技术栈
