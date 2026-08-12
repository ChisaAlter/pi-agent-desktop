# herdr 调研：Pi 生态的多 agent 编排运行时 — 外部调研笔记

> 日期：2026-08-11
> 目的：弄清用户口耳相传的 "pi + herdr 组合效果好" 到底指什么——herdr 是什么、如何与 pi-coding-agent 集成、社区反馈如何、有何限制，以及对我们（Pi Desktop，单 agent 会话 + 多 workspace 的 Electron GUI）的借鉴价值。
> 范围：纯外部调研，未修改仓库任何代码。主要一手来源：herdr 官方 GitHub repo、herdr.dev 官网/文档/博客、npm 页面、HN 原帖、pi-coding-agent 官方 README。

---

## 0. 结论摘要

**一句话**：herdr 是 2026 年年中爆火的 Rust 终端多路复用器（"tmux for AI agents"，官方自称 "the runtime your coding agents live on"），本身**不是** pi 插件，而是用「真实终端 pane + 生命周期状态 + socket/CLI API」把多个 agent 进程（pi、Claude Code、Codex 等）编排进常驻后台的运行时；pi 与它的结合点在于 pi 官方不支持内置 subagent（"No sub-agents… Spawn pi instances via tmux, or build your own with extensions"），而 herdr 恰好提供了 agent 原生驱动（spawn/等待/收割）的替代层，两者一拍即合——herdr 作者本人就是重度 pi 用户，pi 也是 herdr 官方一等集成对象（"state + session" 双级集成）。

| 维度 | 结论 |
|---|---|
| 是什么 | Rust 编写的终端多路复用器 + 常驻后台 server，为 AI coding agent 提供真实终端与生命周期状态（working/blocked/done/idle） |
| 与 pi 的关系 | 不是 wrapper/plugin，是**独立运行时**；通过 CLI + socket API + 官方 lifecycle hooks（`herdr integration install pi`）集成 |
| 规模 | 27.5k stars、~340k downloads、500+ 插件、刚进 YC F26（2026-08）；Apache-2.0（v0.8.0 起由 AGPL 改为 Apache） |
| 关键限制 | **Windows 仍为 beta**（ConPTY 打包、named-pipe API 尚在打磨）；无文件隔离、无共享记忆；server 重启会杀进程（仅 agent 会话可原生恢复） |
| 对 Pi Desktop | 直接嵌入价值低（它是终端层工具，我们是 GUI）；**借鉴价值高**：多 agent 编排模式、状态侧栏模型、hook 式生命周期上报、git worktree 工作流 |

---

## 1. herdr 是什么

### 1.1 定位

- herdr 是一个 **Rust 编写的终端多路复用器（tmux-like）**，官方仓库自述 "the runtime your coding agents live on"（[repo](https://github.com/herdrdev/herdr)）。
- 它解决的核心问题：AI agent 在终端会话结束/合盖/断网/重启后容易死掉或卡死。herdr 作为**常驻后台 server** 拥有所有 pane 的真实 PTY，"herdr doesn't wrap or replace them; it owns their terminals"（[repo README](https://github.com/herdrdev/herdr)）。
- 定位语（[herdr.dev](https://herdr.dev/)）：
  - "Run them anywhere. Leave them running."
  - "You never hunt for the stuck one."（每个 pane 标记 working / blocked / idle）
  - "Give them somewhere to live."
- 它**不包装** agent 工具本身："Codex stays Codex. Claude Code stays Claude Code."（[flaviocopes 深度评测](https://flaviocopes.com/herdr/)）
- 官网支持列表明确包含 **Pi**：Claude Code、Codex、Pi、opencode、Cursor、Grok、Copilot、Hermes，共 "19 agents detected out of the box"（[herdr.dev](https://herdr.dev/)）。

### 1.2 发展时间线（一手来源）

| 时间 | 事件 | 来源 |
|---|---|---|
| 2026-03-17 | herdr 作者（Can Celik, GitHub: ogulcancelik）先发布 pi 扩展套件 `ogulcancelik/pi-extensions`（367 stars） | [GitHub API / repo](https://github.com/ogulcancelik/pi-extensions) |
| 2026-06 中 | herdr 作为 solo 项目起步（"started as a solo project about four months ago"） | [YC 博客](https://herdr.dev/blog/herdr-is-joining-y-combinator/) |
| 2026-07-02 | HN 首发热帖 "Herdr: One terminal to rule them all"，**404 分 / 178 评论** | [HN](https://news.ycombinator.com/item?id=48756578) |
| 2026-07 上 | 原仓库 `ogulcancelik/herdr` 发布帖，166 分 / 110 评论（后迁至 org `herdrdev/herdr`） | [HN](https://news.ycombinator.com/item?id=48714802) |
| 2026-08-06 | 宣布**加入 Y Combinator F26 批次**，281 分 / 189 评论；25k stars、340k downloads、插件市场首月 500+ 插件 | [YC 博客](https://herdr.dev/blog/herdr-is-joining-y-combinator/) |
| 2026-08-03 | v0.8.0：license 由 **AGPL-3.0 改为 Apache-2.0**；Windows preview 下载开始自带 ConPTY 运行时 | [Releases](https://github.com/herdrdev/herdr/releases) |

> 名称变体：官方拼写就是 **herdr**（Herdr），npm 上另有 `herdr` 保留包名（"Reserved package name for Herdr, a terminal workspace manager for AI coding agents"，[npm](https://www.npmjs.com/search?q=herdr)）。未发现 "h3rdr" 等其他拼写对应此工具。注意区分同名/近义概念：`agentherder.com`（"AgentHerder" 是一种使用 AI 的工作实践，与 herdr 无关）以及同类竞品 `captain-miao`（kitty/zellij 上的 agent 编排，[HN](https://news.ycombinator.com/item?id=49225782)）。

---

## 2. 与 pi 的集成方式

### 2.1 为什么是 pi + herdr：pi 官方明确不做内置 subagent

pi 官方 README 的哲学声明（[npm @earendil-works/pi-coding-agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)，v0.84.1，MIT）：

> "No sub-agents. There's many ways to do this. Spawn pi instances via tmux, or build your own with extensions."

即：pi 官方把多 agent 编排**留给外部**（tmux / 扩展 / 自建）。herdr 恰好补上了这个生态位——它提供 "agent-native automation"：agent 通过 CLI/socket API 互相 spawn pane、发 prompt、等待对方真正 blocked（[herdr.dev](https://herdr.dev/)、[repo README](https://github.com/herdrdev/herdr)）。

### 2.2 官方一等集成：state + session 双级

- herdr 文档的 supported-agents 表中，**Pi 的集成角色是 "state and session"**——即装了 hooks 后 Pi 是"生命周期权威"（working/blocked/done 的精确来源），同时提供原生会话身份用于 server 重启后恢复对话；没装 hooks 则退回屏幕识别（screen manifest）。（[herdr.dev/docs/agents](https://herdr.dev/docs/agents/)）
- 安装方式：`herdr integration install pi`（CHANGELOG 中 "The Pi, OMP, OpenCode, and Kilo Code integrations can now be installed on Windows and report lifecycle state and native session identity through Herdr's named-pipe API"，[CHANGELOG](https://github.com/herdrdev/herdr/blob/main/CHANGELOG.md)）。
- Pi 状态上报细节有专门打磨：`Pi lifecycle state now reanchors after native session replacement`；`reports Ask/tool approval waits as blocked`；`Pi launched through npm wrappers on Windows is now detected as Pi`（[CHANGELOG](https://github.com/herdrdev/herdr/blob/main/CHANGELOG.md)）。
- **herdr 官方团队自己就用 pi**：repo 根目录自带 `.pi/extensions/`（如 github-issues-autocomplete）和 `.pi/prompts/pre-release-audit.md`（[repo 目录](https://github.com/herdrdev/herdr/tree/main/.pi)）——这是 "pi + herdr" 组合可信度最强的内部证据。

### 2.3 pi 侧的集成：npm 扩展生态（pi-herdr 系）

pi 的扩展机制是 `pi install npm:<pkg>`（官方包注册表 [pi.dev](https://pi.dev/packages/@andrewjacop/pi-herdr)）。npm 上已有一整层 herdr 集成包（[npm 搜索结果](https://www.npmjs.com/search?q=herdr)），代表：

| 包 | 说明 | 数据 |
|---|---|---|
| `@andrewjacop/pi-herdr` | "turns pi into an orchestrator over a fleet of visible AI agent panes running in herdr"：spawn → send → wait → harvest；工具面 `herdr_delegate`（复合一次调用）、`herdr_start_agent` / `herdr_wait_agent` / `herdr_read_agent` 等；README 明确 "Tested on Windows and macOS" | v0.3.0，MIT，0 依赖，~232 下载/周（[npm](https://www.npmjs.com/package/@andrewjacop/pi-herdr) / [GitHub](https://github.com/AndrewJacop/pi-herdr)） |
| `@ogulcancelik/pi-herdr` | herdr 作者本人的 pi 扩展（布局/panes/agents），标注 🧪 Experimental | 附属于 pi-extensions（367 stars，[repo](https://github.com/ogulcancelik/pi-extensions)） |
| `pi-herdr-subagents` / `aldrickdev/herdr_subagents` / `kirel/herdr-subagents` | 各类"pi subagent 跑在 herdr pane 里"的实现（可见、可重连、可回调） | 见 [awesome-herdr](https://github.com/yigitkonur/awesome-herdr) |
| `SecretAardvark/pi-overseer` | 基于角色的 pi agent 舰队（allowlist 权限） | [repo](https://github.com/SecretAardvark/pi-overseer) |
| `Jackliu-miaozi/pi-herdr-workflow-kit` | gated planner → coder → reviewer 流水线 | [awesome-herdr](https://github.com/yigitkonur/awesome-herdr) |
| `herdr-mcp` / `herdr-simple-mcp` | MCP server（21 / 75 个工具），非 pi 专用 | [awesome-herdr](https://github.com/yigitkonur/awesome-herdr) |

---

## 3. 核心功能与架构

（技术细节主要来自 [flaviocopes.com/herdr/](https://flaviocopes.com/herdr/) 深度评测与 [herdr.dev/docs](https://herdr.dev/docs/agents/)，辅以 CHANGELOG）

### 3.1 架构

- **单一 Rust 二进制**，无 Electron、无账号、无云端仪表盘、无遥测。
- 后台 server 拥有所有 PTY、子进程、pane 状态与布局；**客户端（本地 / SSH / 手机）只负责渲染状态与回传输入**——关掉客户端不影响 agent 继续跑，多客户端可同时 attach 同一会话（[flaviocopes](https://flaviocopes.com/herdr/)）。
- 分层模型：`session（server 命名空间）→ workspace（项目）→ tab（布局）→ pane（真实终端）`；agent 是 pane 内被识别的进程，独立于 pane 层（测试进程只有 pane 层，agent 才有生命周期状态）（[flaviocopes](https://flaviocopes.com/herdr/)）。
- **CLI 与 socket API 是同一面**：返回结构化 JSON，可建布局、读 pane、发输入、控制 agent、订阅事件、等待状态变化。agent 能通过同一 API 编排彼此（"rather than faking keystrokes and sleeping"）（[flaviocopes](https://flaviocopes.com/herdr/)）。

### 3.2 Agent 状态检测（两种机制）

1. **无 hook 兜底**：识别 pane 前台进程 + 读终端底部 buffer 快照，与 TOML "screen manifests" 匹配 → idle/working/blocked。blocked 判定很严格：只有快照命中已知的审批/提问/权限 UI 才标 blocked（[herdr.dev/docs/agents](https://herdr.dev/docs/agents/)）。
2. **官方 hook 集成**（codex/claude/cursor/pi 等）：上报生命周期状态 + 原生会话 ID，server 重启后可 `--resume` 恢复对话（[herdr.dev/docs/agents](https://herdr.dev/docs/agents/)）。

### 3.3 三类持久化（重要区分）

- **detach**：进程全部存活，随时重连（跨合盖、断网、SSH）。
- **server 重启**：布局恢复，但任意进程被杀；仅支持原生会话恢复的 agent 可续聊。
- **pane 历史**：实验性、默认关闭（终端输出可能含密钥）。（[flaviocopes](https://flaviocopes.com/herdr/)）

### 3.4 其他特性

- 键鼠双一等公民：tmux 风格 prefix 键（Ctrl+b）+ 鼠标点击/拖拽/分屏（[repo README](https://github.com/herdrdev/herdr)）。
- 侧栏状态聚合：blocked 的 agent 让其 pane/tab/workspace 整体变红，可折叠的 workspace/agent 列表（HN 用户 [linsomniac 实测](https://news.ycombinator.com/item?id=48756578)）。
- git worktree 集成：被称为 "killer feature"（[HN kkapelon](https://news.ycombinator.com/item?id=48756578)）。
- 插件系统：可执行包 + `herdr-plugin.toml` 清单，无独立 SDK，复用同一 CLI/socket API；官方 skill 由 `herdr --skill` 输出（[repo README](https://github.com/herdrdev/herdr)）。
- 远程：`herdr --remote`、SSH 直连、手机/iOS 客户端（[YC 博客](https://herdr.dev/blog/herdr-is-joining-y-combinator/)）。
- 官方提供了与 tmux 的逐项对比页 [herdr.dev/compare](https://herdr.dev/compare/)。

---

## 4. 社区反馈与证据

### 4.1 热度与增长（一手数据）

- GitHub **27.5k stars / 1.9k forks**（[repo](https://github.com/herdrdev/herdr)，2026-08-11 时点）；**340k downloads、500+ 插件**、社区自发做出 Raycast 扩展、Stream Deck 集成、iOS app（[YC 博客](https://herdr.dev/blog/herdr-is-joining-y-combinator/)）。
- HN 两连爆：首发 404 分/178 评论（[item 48756578](https://news.ycombinator.com/item?id=48756578)）、YC 帖 281 分/189 评论（[item 49201003](https://news.ycombinator.com/item?id=49201003)），另有原仓库发布帖 166 分/110 评论（[item 48714802](https://news.ycombinator.com/item?id=48714802)）。

### 4.2 "效果好"体现在哪（HN 实测反馈摘录）

- **多会话重连**："I've been using Herdr for running my AI agents and it has been really nice… reconnect to it from multiple sessions… attach to it over SSH from my laptop"（[linsomniac](https://news.ycombinator.com/item?id=48756578)）。
- **状态侧栏 vs tmux 手工轮询**：workspace 可重命名 + agent 状态列表（idle/blocked/working）是核心卖点；"If you aren't working with multiple agents at once, I'm not sure you'd pick Herdr"（[linsomniac](https://news.ycombinator.com/item?id=48756578)）。
- **"tmux on steroids (specifically for agents)"**，killer feature 是 git worktree 管理（[kkapelon](https://news.ycombinator.com/item?id=48756578)）。
- **易用性**："tmux came naturally so did herdr that just clicked"（[Trufa](https://news.ycombinator.com/item?id=48756578)）；"This works much better than tmux"（[nullbio](https://news.ycombinator.com/item?id=48714802)）。
- 独立评测结论：flaviocopes 称其 "a very compelling foundation"，补上了"看 agent"与"编排 agent"之间缺失的一层（[flaviocopes.com/herdr](https://flaviocopes.com/herdr/)）。
- **KOL 背书**：Shopify CEO **Tobi Lütke** 同时背书两者——对 pi："Pi is the most interesting agent harness. Tiny core, able to write plugins for itself as you use it"（[X](https://x.com/tobi/status/2018506396321419760)）；对 herdr：演示 agent 读 `herdr --skill` 后自己分 10 个 pane（[X](https://x.com/tobi/status/2086488457132626052)）。这也是 "pi + herdr" 组合口碑的重要传播源。

### 4.3 争议与质疑（同样来自 HN）

- **"Just use tmux?"** 是最大质疑线：tmux + bell/OSC 标题/钩子可近似实现状态提示（[item 48714802](https://news.ycombinator.com/item?id=48714802)）；支持者回应"tmux 做不到 agent 语义级的 blocked 判定"。
- 首发帖有 "Vibecoded" 指责与反方回应 "quality of the project is great"（[item 48756578](https://news.ycombinator.com/item?id=48756578)）。
- 实测问题：某用户在 wezterm 里"terminal 持续重绘导致键盘/vi 模式无法复制粘贴"（[vantassell](https://news.ycombinator.com/item?id=48756578)）。
- 非 git VCS 支持缺位：jj workspaces 不支持，有专门讨论帖（[discussion #522](https://github.com/ogulcancelik/herdr/discussions/522)）。

---

## 5. 已知问题与限制

| 限制 | 详情 | 来源 |
|---|---|---|
| **Windows 仍是 beta** | 官网明确 "macOS · Linux · Windows beta"；Windows 安装走 PowerShell（`irm https://herdr.dev/install.ps1 \| iex`）；v0.8.0 起 preview 包自带 ConPTY；named-pipe API 曾间歇 BrokenPipe；Git Bash 检测、IME、raw Escape 等持续修 | [herdr.dev/install](https://herdr.dev/install/)、[Releases v0.8.0/v0.7.4](https://github.com/herdrdev/herdr/releases) |
| pi 在 Windows 的具体坑 | `agent start --kind` 无法启动 npm `.cmd` shim，pi-herdr 需回退 `pane run` 裸命令 + 自动检测（[pi-herdr README](https://www.npmjs.com/package/@andrewjacop/pi-herdr)）；npm wrapper 启动的 pi 曾有识别问题（#754，已修） | [npm](https://www.npmjs.com/package/@andrewjacop/pi-herdr)、[CHANGELOG](https://github.com/herdrdev/herdr/blob/main/CHANGELOG.md) |
| 无文件变更隔离 | 同目录两个 pane 可改同一文件；安全 worktree 仍是用户自己的 Git 决策 | [flaviocopes](https://flaviocopes.com/herdr/) |
| 无共享记忆/上下文合并 | 提供编排，不合并 agent 上下文；agent 间通过文件/Git/命令通信 | [flaviocopes](https://flaviocopes.com/herdr/) |
| 不是 agent 平台 | 无任务图、issue 库、审批策略、完整逐 turn 事件历史 | [flaviocopes](https://flaviocopes.com/herdr/) |
| server 重启 ≠ detach | 任意 dev server / 测试进程要手动重启；仅原生会话 ID 的 agent 可续聊 | [flaviocopes](https://flaviocopes.com/herdr/) |
| 检测非完美 | agent 更新可能破坏 screen manifest；"unknown" 就是真的不知道；早期曾出现检测循环导致高 CPU（#560/#565，已修） | [flaviocopes](https://flaviocopes.com/herdr/)、[CHANGELOG](https://github.com/herdrdev/herdr/blob/main/CHANGELOG.md) |
| 插件供应链风险 | 插件以用户权限运行，官方文档建议安装前审查 | [flaviocopes](https://flaviocopes.com/herdr/) |
| 稳定性/成熟度 | 近每日 preview 构建、周级 minor 版本，API 处于快速变动期（v0.7.5 插件状态改为全局即 breaking change）；license 在 v0.8.0 才从 AGPL 改为 Apache-2.0 | [Releases](https://github.com/herdrdev/herdr/releases) |
| 商业化未定 | YC 后 monetization 无细节（"keep supporting the open source while building the features people really need"） | [YC 博客](https://herdr.dev/blog/herdr-is-joining-y-combinator/) |

---

## 6. 对本项目（Pi Desktop）的启示

**总体判断**：herdr 是**终端层**工具，Pi Desktop 是 **GUI 层**包装 pi SDK 的桌面应用——两者不在同一层，把 herdr 直接嵌进 Pi Desktop（比如让应用内 terminal 用 herdr 渲染）没有明显收益，且其 Windows beta 状态与我们的 Windows-only 定位冲突（目前我们已有 node-pty 终端，见 AGENTS.md）。但 herdr 生态回答了一个我们**尚未回答**的问题：单 agent 会话之外的多 agent 编排应该长什么样。具体可借鉴点：

1. **多 agent 编排的需求已被验证**：pi 官方"不做内置 subagent"的哲学 + pi-herdr 系扩展（spawn/send/wait/harvest 工具面、`herdr_delegate` 复合调用）证明"主 pi 会话 + 子 agent pane 舰队"是 pi 用户的主流诉求。Pi Desktop 若做"多会话并行 + 结果回收"，可直接参考 `@andrewjacop/pi-herdr` 的工具契约设计（[npm](https://www.npmjs.com/package/@andrewjacop/pi-herdr)），而不是从零发明。
2. **状态模型值得抄**：herdr 的 `working / blocked / done / idle` + 严格 blocked 判定（命中审批/提问 UI 才算）+ 聚合到 tab/workspace 的 rollup，与我们现有 RightRail 的进度/状态展示（AGENTS.md 中 `right-rail-progress`）是同一思路的深化。我们的审批流（classifier/interceptor）天然知道"agent 在等审批"，可以低成本把"等待审批"状态暴露给用户。
3. **hook 式生命周期上报是可移植的架构模式**：herdr 的 integration（named-pipe/socket 上报 + 原生会话 ID 恢复）≈ 我们 event-bridge + SqliteSessionRepository 的职责。若未来做"关窗口 agent 继续跑"，herdr 的 detach/restart/resume 三态模型（[flaviocopes](https://flaviocopes.com/herdr/)）是现成的设计参照。
4. **git worktree 工作流**：HN 公认 killer feature。我们的 Workbench 已有 git 面板，可借鉴"每 agent/每任务一个 worktree"的隔离模式（Pi Desktop 已有 worktree 相关技能生态：`pi-worktree` 等）。
5. **风险提示**：herdr 处于周级快速迭代期（近每日 preview），pi-herdr 扩展多为个人实验性质（stars 1~8），**不应**作为我们架构依赖；要借鉴的是模式而非代码。我们的位置优势是：GUI 可以比终端 multiplexer 做得更好的正是上下文可视化与审批体验。
6. **跟进建议**：关注 herdr 的 Windows 正式支持进展（[Releases](https://github.com/herdrdev/herdr/releases)）与 pi 官方是否改变 "No sub-agents" 立场（[npm README](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)）；在 Pi Desktop 中可选地支持 `pi install` pi-herdr 类扩展的安装入口，让终端用户自行组合，而不必内建。

---

## 7. 来源汇总（全部一手或直接链接）

**官方**
- herdr repo：https://github.com/herdrdev/herdr （27.5k stars，Apache-2.0）
- 官网：https://herdr.dev/ ；安装页（Windows beta）：https://herdr.dev/install/ ；对比页：https://herdr.dev/compare/
- 文档（agents 表，Pi = state + session）：https://herdr.dev/docs/agents/ ；远程持久化：https://herdr.dev/docs/persistence-remote/
- YC 博客：https://herdr.dev/blog/herdr-is-joining-y-combinator/
- Releases（v0.8.0 license 变更 / Windows ConPTY）：https://github.com/herdrdev/herdr/releases
- CHANGELOG（Pi 生命周期集成史）：https://github.com/herdrdev/herdr/blob/main/CHANGELOG.md
- herdr repo 内 `.pi/` 目录（官方用 pi 的证据）：https://github.com/herdrdev/herdr/tree/main/.pi

**pi 官方**
- npm @earendil-works/pi-coding-agent（"No sub-agents" 引文）：https://www.npmjs.com/package/@earendil-works/pi-coding-agent
- pi 官方包注册表（pi-herdr 收录）：https://pi.dev/packages/@andrewjacop/pi-herdr

**社区 / 评测**
- HN 首发帖（404 分/178 评论）：https://news.ycombinator.com/item?id=48756578
- HN 原仓库帖（166 分/110 评论）：https://news.ycombinator.com/item?id=48714802
- HN YC 帖（281 分/189 评论）：https://news.ycombinator.com/item?id=49201003
- Flavio Copes 深度评测：https://flaviocopes.com/herdr/
- awesome-herdr 生态清单：https://github.com/yigitkonur/awesome-herdr
- jj workspaces 讨论：https://github.com/ogulcancelik/herdr/discussions/522
- Tobi Lütke 谈 pi：https://x.com/tobi/status/2018506396321419760 ；谈 herdr：https://x.com/tobi/status/2086488457132626052

**pi-herdr 集成包**
- @andrewjacop/pi-herdr（npm）：https://www.npmjs.com/package/@andrewjacop/pi-herdr
- ogulcancelik/pi-extensions（herdr 作者的 pi 扩展，367 stars）：https://github.com/ogulcancelik/pi-extensions
- npm herdr 搜索结果（20+ 相关包）：https://www.npmjs.com/search?q=herdr

**调研局限**：Reddit 检索被 403 拦截，社区反馈以 HN 两帖 + 独立评测 + X 为主；herdr 迭代极快（2026-08-11 时点 v0.8.0），本文所有状态数据以该日期为准。
