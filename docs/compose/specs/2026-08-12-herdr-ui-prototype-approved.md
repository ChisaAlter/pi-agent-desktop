# Herdr GUI 原型 — 已批准设计契约

> 状态：**用户已批准**（2026-08-12）
> 原型：`docs/prototypes/herdr-desktop-ui-prototype.html`
> 本文件是生产实现的 UI/UX 契约；与 `2026-08-12-real-herdr-integration.md`（运行时契约）配套。

## 1. 产品定位（已确认）

- Pi Desktop 是 Herdr 的 **GUI 套壳与能力注入层**，不是仿制运行时。
- **智能体 tab** = Herdr 原生控制面（session/workspace/tab/pane + 状态 + 介入）的 GUI 投影。
- **任务编排 tab** = Desktop 注入的持久化业务编排（任务 DAG、轮次、审查、交付物、合并）。
- 运行时真相永远在 Herdr；计划语义永远在 Desktop。两个 tab 看同一批 worker，角度不同。
- 官方 Herdr 本身没有编排层：协调由人（TUI）或主 agent（CLI skill 协议）完成，计划存在调用方上下文里，会丢失。我们的任务编排层正是补这个缺口。

## 2. 三种布局（原型底部切换器，URL `?variant=`）

| variant | 定位 | 何时用 |
|---|---|---|
| `studio`（默认） | IDE 式三栏：左 Herdr 层级树 + 中工作区 + 右上下文详情 | 日常使用 |
| `mission` | 任务优先：DAG 大图 + 交付物/审查/整合三栏 | 大型自动编排 |
| `terminal` | 终端优先：pane 全宽 + 暗色，隐藏重复身份面板 | 重度控制/blocked 介入 |

生产默认实现 `studio` 三栏结构；`mission`/`terminal` 作为视图密度切换保留（待定：是否并入视图设置）。

## 3. 布局与信息架构

### 顶栏 + 状态条（精简版，已批准）

```text
[TopTabBar] 对话 | 智能体 | 任务编排 | 运行 | 工作台 | 扩展        [⚙]
[状态条] ● Herdr 已连接 · 会话/进程 ｜ Desktop 托管 v0.9.0 ｜ 完全兼容   [⚙]
```

- 状态条**只保留连接状态、来源/版本、兼容性**；检查更新/验证/切换全部在设置内。
- 顶栏右侧 ⚙ 打开设置；状态条右侧 ⚙ 也打开设置（入口同源）。

### 左侧 Herdr 层级树

```text
◫ 会话 pi-desktop
 └ ◇ 工作区 primary
    └ ▣ 任务协调 → ● 规划智能体 · Pi · p-01
    └ ▣ 并行实现 → ● 认证实现智能体 · Pi · p-02（阻塞）
                  → ● 测试智能体 · Codex（已完成待查看）
 └ ◇ 工作树 wt/auth-fix
    └ ▣ 独立审查 → ● 审查智能体 · Claude · p-04
```

- 展开/收起、搜索、状态过滤（全部/阻塞/待查看）。
- 层级展示真实 identity（pane、agent kind、native session、worktree），不是扁平卡片。
- 状态点小圆点 + 文字说明；点击 pane 打开实时终端。

### 中部 Fleet（智能体 tab）

- 按 workspace 分组卡片。
- 状态：工作中/已阻塞/已完成·待查看/空闲/状态未知/连接已断开。
- 卡片信息：显示名、kind、窗格、任务一句话、会话、工作树、状态来源。
- 操作收敛为：**一个状态主 CTA**（阻塞→处理阻塞 / 待查看→标记已查看 / 其他→打开终端）+ 最近输出 + 更多。
- **无彩色侧边框**：状态用徽章表达；选中用统一蓝色描边。
- server 断线时全部变「连接已断开」，禁止显示陈旧 done；重连后重新 snapshot，不重放 prompt。

### 实时终端（Live Pane）

- 面包屑 + 连接状态（● 已实时连接 / ○ 已断开）+ Detach/Focus/Resize/Send Keys。
- blocked 横幅独立一行：「智能体被阻塞 · 在真实 pane 中处理」+ 主按钮「进入终端并批准」。
- 终端正文高对比；右侧身份面板（Agent/Pane/State authority/seq/Native session/Worktree/Transport）。
- 底部 Prompt 输入 + 等待选项（空闲/完成、阻塞、不等待）。
- 明确区分：live attached terminal vs `agent.read` 历史。

### Mission Cockpit（任务编排 tab）

- 顶部深色 hero：目标输入 + 生成任务图 + 开始任务 + 状态徽章（草稿/已规划/执行中/审查中/修订中/已通过）。
- 权威来源横幅：`运行状态唯一真相：Herdr 会话 pi-desktop · 桌面投影序号 N · 非幂等操作不会在重连后自动重放`。
- DAG：节点带状态色条（就绪/执行中/已通过/未通过），显示 worker + pane + 轮次。
- 三栏：交付物（输出/diff/commit/测试/归属）、审查与修订（finding、修订按钮、复审）、分支整合（等待/就绪/请求合入需用户确认）。
- 主流程：生成 DAG → 开始 → 并行 worker → 交付 → Reviewer 驳回 → 创建修订轮次 2 → 复审通过 → 整合 → 用户确认合入。
- 布局切换器在左下，不遮挡主内容；中/右栏有底部安全区。

### 右侧上下文详情（Context Rail）

选中对象驱动：

- 智能体：显示名、层级、运行时连接、状态徽章、状态来源、原生会话引用
- 能力清单（发送指令/等待/读取/发送按键/实时连接/恢复会话）
- 工作树租约（工作区、分支、归属·任务/轮次）
- 证据边界说明（生产版必须从 Herdr 快照/事件序号/窗格终端身份/Git 提交反查，不能从 UI 卡片推导）

## 4. 设置（生产方向已定）

- 生产版把 Herdr 运行时/更新并入**独立设置窗口的一个 tab**（放进「智能体」分组），不是对话框。
- 设置内容：
  - **通用**：安装来源（Desktop 托管 / 系统安装）、自动检查更新、自动切换稳定版
  - **兼容性与能力**：当前版本/API、候选版本、能力清单（握手+契约测试得出）
  - **更新**：检查更新 → 下载候选版（不影响当前服务）→ 验证兼容性（真实契约冒烟）→ 安全切换（有智能体运行时排队，不静默重启）→ 回滚
  - **诊断**：服务连接、Pi 集成状态、运行策略（关闭后保持运行、断线自动重连）、数据目录

## 5. 交互语义（原型已验证，生产必须保持）

1. `Done = Idle + unseen`；Mark Seen 后变 Idle。
2. 优先级 `Blocked > Done-unseen > Working > Idle > Unknown`。
3. blocked 审批在真实 Herdr pane 内完成，不在 GUI 伪造 approval。
4. 断线→重连：状态先 disconnected，恢复后 snapshot+subscribe，不重放非幂等操作。
5. 更新切换等待安全点；active agents 存在时不静默重启 server。
6. 最终合入主分支必须用户明确确认。

## 6. 生产实现映射（组件边界）

| 原型 | 生产 |
|---|---|
| 层级树 | `HerdrTree`（新，替代现有 `useAgentFleet` 扁平推导） |
| Fleet 卡片 | 重构 `AgentsPanel`/`AgentCard`：状态 CTA 单主按钮、无彩边 |
| 实时终端 | `HerdrPaneTerminal`（xterm surface，官方 binary transport） |
| Mission Cockpit | 新 `MissionCockpit` + `mission-store`（snapshot+seq） |
| 上下文详情 | 扩展 `RightRail` 选中联动 |
| 设置 | 新 `HerdrTab` 加入 `Settings/tab-defs.ts`（智能体分组）+ i18n |

## 7. 边界声明（防降级）

- 原型全部为 mock 数据，仅验证体验；不构成运行时已接入的证据。
- 生产实现前必须先具备：官方 Herdr 二进制、named-pipe 协议、官方 integration、真实 lifecycle（见运行时契约文档）。
- 任何「用 UI 卡片推导运行状态」「用空卡片冒充 worker」「用 mock 通过真实验收」均被禁止。
