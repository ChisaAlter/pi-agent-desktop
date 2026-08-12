# herdr 源码深度解析：编排机制的代码级事实与 GUI 复刻方案

> 日期：2026-08-12
> 触发：用户对 2026-08-11 的舰队壳子审查不满意（"你这个还是降级了，深度解析herdr的代码"），要求先吃透 herdr 真实代码再谈实现。
> 范围：clone `herdrdev/herdr`（commit 5600197f, 2026-08-12, Rust 22.3 万行），三个并行子代理 + 人工精读核心文件。所有结论带文件:行号。
> 后续动作：本文取代 `2026-08-12-herdr-integration-downgrade-review.md` §5 的整改路线（那份路线仍是降级版），以此为准。

---

## 0. 一句话结论

**herdr 的价值不在"编排"本身——它根本没有 planner/任务图/汇总/委托原语；它的价值是"可靠的多 agent 并行运行环境"：真实终端 + 生命周期状态机（hook 权威 + 屏幕检测双通道）+ 一套以 `agent.prompt/wait/read` 为核心的终端控制原语 + worktree 隔离 + 重启恢复。** 用户要的"总任务→拆解→并行→汇总→再派发"在 herdr 里不存在（那是 pi-herdr 扩展层的薄工具面 + 用户愿景），**这正是 GUI 的增值空间**：底座复刻 herdr 的并行运行环境与状态原语，编排层（planner/harvest/reviewer）做在底座之上。上一版"顺序化批次 + 复用现有信号"的方案是降级，本文给出不降级方案。

---

## 1. 架构分层（代码级）

```
session (server 实例命名空间, HERDR_SESSION)   src/session.rs
  └─ workspace (git 空间 / worktree checkout)   src/workspace.rs
      └─ tab (BSP 布局)                          src/workspace/tab.rs
          └─ pane (真实 PTY)                     src/pane.rs
              └─ terminal (TerminalState 状态机)  src/terminal/state.rs
                  └─ agent (pane 内被识别的进程)  src/detect/mod.rs
```

- **agent 不是一层**：它是 pane 内被识别的进程，状态机挂在 TerminalState 上（`src/detect/mod.rs:10-20`）。
- server 是分离守护进程（unix setsid / Windows WMI，`src/platform/windows.rs:778-830`），**拥有全部 PTY**；client（TUI/CLI/API）只是连接者。detach 保证是架构性的：client 断开 `remove_client` 只做清理从不 kill（`src/server/headless.rs:1571-1606`，"Continues running after client disconnect"）。
- 双 socket：`herdr.sock`（JSON-RPC API）+ `herdr-client.sock`（二进制帧协议 v20，`src/protocol/wire.rs:16`）。

## 2. 状态机：4 态 + done 派生 + 多源仲裁

### 2.1 核心状态（`src/detect/mod.rs:10-20`）

```rust
pub enum AgentState { Idle, Working, Blocked, Unknown }  // 没有 error、没有 done！
```

**done 是派生标签 = Idle + 未 seen**（`src/app/agent_view.rs:393-397`：`(Idle, false) => Done`）。seen 在 pane 聚焦/标记时置 true（`src/app/actions.rs:1292`）。即 **"done" = 完成且结果还没被用户看到**。

### 2.2 无显式状态转换表——是"检测循环 → 去抖 → 仲裁"流水线

1. **pane 检测循环**（`src/pane.rs:694-973`）：300ms tick（pending_idle 时 100ms）→ 进程探针（≤5s 一次，识别 agent 身份，含 node/bun/cmd/powershell 包装解包 + npm 包路径识别 pi `@earendil-works/pi-coding-agent/dist/cli`，`src/detect/mod.rs:332-631`）→ 屏幕底部 buffer 快照 → manifest 匹配 → 发布决策。
2. **去抖**（`src/pane/agent_detection.rs:39-78`）：Working→Idle 必须连续 3 次确认且 ≤700ms 上限，防止输出间隙误判。
3. **仲裁**（`src/terminal/state.rs:2120-2161`）：最终状态 = `visible_blocker 覆写 ? Blocked : hook_authority(有效)?.state ?? screen_fallback`。

### 2.3 screen manifest：可下发的声明式规则集（`src/detect/manifest.rs`）

- TOML 规则：`{state, priority, region, visible_idle/blocker/working, skip_state_update, 门控}`；region 有 `whole_recent / bottom_lines(n) / prompt_box_body / after_last_horizontal_rule / osc_title / osc_progress` 等（manifest.rs:1254-1292）；按 priority 降序取最高匹配。
- 三级来源：bundled `include_str!` < remote 缓存 < 本地 override（manifest.rs:239-259, 738-752, 1097-1103）。
- **blocked 严格判定**：只有命中已知审批/提问/权限 UI 才算（如 claude.toml 的 `bash_permission_prompt` 规则命中 "do you want to proceed?" + 门控）；**命中不了就回退 Idle**（`default_known_agent_idle_fallback`），绝不做文本启发式猜 blocked。
- **pi.toml 只有一条规则**：`contains: ["Working..."]` → working（screen 永远不能把 pi 判 blocked——blocked 只能来自 hook）。

### 2.4 hook 权威分级（`src/detect/mod.rs:289-306`, `src/terminal/state.rs:633-747`）

- **full-lifecycle hook**（herdr:pi / omp / mastracode / opencode / kilo / kimi）：hook 独占状态，权威期内 screen 检测被忽略；但要求进程仍在且 agent 标签一致（`hook_authority_is_effective`，state.rs:1786-1791）。
- **session-identity-only**（hermes / agy）：hook 只锚定会话，状态完全交给 screen。
- **普通 hook**（claude/codex 等）：hook 状态为权威，但 screen 的 `visible_blocker` 可覆写非 blocked hook 状态（state.rs:1832-1843）。
- 防御链：进程退出即清除权威、hook 与 detected agent 冲突丢弃、seq 乱序去重（`accept_hook_report`）、owner 冲突需前台确认接管、reanchor（会话替换后重新锚定，CHANGELOG #943/#1189）。

### 2.5 聚合：一张注意力优先级表（`src/workspace/aggregate.rs:75-100`）

```
Blocked(4) > Done-unseen(3) > Working(2) > Idle-seen(1) > Unknown(0)
```

**Done-unseen 压过 Working**——"有未收割的结果"比"正在干活"更值得注意。workspace 取所有 pane 的 max；无 tab 级 rollup（tab 只是展示分组）。

## 3. 编排能力面：API 契约全表

**socket API = newline-delimited JSON-RPC**（`{id, method, params}` → `{id, result}`/`{id, error:{code,message}}`，`src/api/schema.rs:33-46`）。**CLI 是同一 socket 的薄客户端**（`src/cli.rs:744-779`）。**没有 agent→agent 委托原语**——"一个 agent 编排另一个"的唯一方式就是编排者（人/CLI/GUI/agent 自己跑 CLI）操作 pane PTY。

| 操作 | 作用 | 实现位置 |
|---|---|---|
| `agent.list` / `agent.get` | 枚举/解析 agent（target=唯一 agent 名或 pane id，歧义报 `agent_target_ambiguous`） | app/agents.rs:20-71 |
| `agent.start` | 在空闲 shell pane 启动命名 agent（写 shell 命令进 PTY，3s settle + 30s 超时；`launch_pending`/`interactive_ready` 两阶段状态） | app/agents.rs:143-225 |
| `agent.prompt` | bracketed-paste 感知写入 + 300ms 延迟补回车；带 `wait` 时转长轮询 | app/api/agents.rs:62-111；api/wait.rs:177-306 |
| `agent.wait` | 等待状态命中 `until`（默认 Idle/Done/Blocked），身份三重锁定，超时报 `timeout` | api/wait.rs:132-175, 348-498 |
| `agent.read` | 读 pane 输出（visible/recent/recent_unwrapped/detection，strip_ansi，限行数） | app/api/agents.rs:113-152 |
| `agent.send_keys` | 发送按键序列（逐个校验 key） | app/api/agents.rs:225-268 |
| `agent.rename` / `focus` / `explain` | 命名 / 聚焦（置 seen）/ 解释检测命中证据 | app/agents.rs:73-141 |
| `agent.view.set` / `clear` | 侧栏视图过滤/排序（token 表达式） | app/api/agent_view.rs:7-70 |
| `pane.send_text` / `send_keys` / `read` / `wait_for_output` | 任意 pane 的注入与读取（wait_for_output = 轮询 read + regex 匹配，命中即返 `OutputMatched`） | app/api/panes.rs:1200-1540；api/wait.rs:22-130 |
| `pane.report_agent` / `report_agent_session` / `report_metadata` | **集成反向上报通道**：hook 上报状态/会话身份/展示元数据 | app/api/panes.rs:1231-1460 |
| `pane.clear_agent_authority` / `release_agent` | 撤销 hook 权威 / 释放 pane 回 shell | app/api/panes.rs:1462-1499 |
| `events.subscribe` / `events.wait` | 带 seq 事件流订阅（24 种事件） / 长轮询单事件 | api/server.rs:695-724；api/wait.rs:661-780 |
| `integration.install` / `uninstall` | 安装 16 个 agent 集成（写 hook 文件 + 改配置） | integration/actions.rs |
| `session.snapshot` | 全量快照（workspaces/tabs/panes/agents + agent_session） | schema/session.rs:8-23 |
| `server.live_handoff` | unix 热替换：SCM_RIGHTS 传 PTY fd + pid，进程不退出 | server/handoff.rs:32-47 |

### 3.1 wait 的代码实现（`src/api/wait.rs:348-498`）——事件驱动等待

```rust
// 记录 event_hub.current_sequence() → agent_get 快照 → 未命中则循环：
for (sequence, event) in event_hub.events_after(last_event_sequence) {
    match event.data {
        PaneAgentDetected { released, final_status, .. } => { released→final_status 命中即返；否则 agent_not_running }
        PaneAgentStatusChanged { agent_status, .. } => { 命中 until 记录 matched_event_status }
        PaneClosed | PaneExited => agent_not_running
    }
}
// 事件提示后 probe：agent_get 拉快照，三重身份校验（terminal_id + name + agent），
// 匹配要求 state_change_seq > baseline（wait.rs:540-547）
// 兜底：CONNECTION_POLL_INTERVAL 轮询 + deadline 超时
```

**关键原语：`state_change_seq` 单调计数**（AgentInfo 字段）——wait 匹配和 stalled 检测都靠它，没有它就无法区分"状态没变"和"事件没到"。

### 3.2 prompt-and-wait 的"效果检测"（`src/api/wait.rs:177-306`）

发送后若状态不是 Working：等最多 **5s** 观察 `state_change_seq` 前进（`AgentWaitTimeoutKind::PromptStalled`）——**"prompt 被吞了/没生效"的检测**；随后才进入 settle-state 等待（直到 Idle/Done/Blocked）。

### 3.3 身份三重锁定（`src/api/wait.rs:525-538`）

等待期间锁 `terminal_id + name + agent` 三重一致——agent 重启/替换后等待不被错误满足。

## 4. pi 集成深度（`src/integration/assets/pi/herdr-agent-state.ts`，257 行）

- **形态**：pi 扩展（TypeScript），编译进 herdr 二进制（`include_str!`），`herdr integration install pi` 时写到 `$PI_CODING_AGENT_DIR/extensions/herdr-agent-state.ts`（默认 `~/.pi/agent`）。
- **通道**：herdr 向每个 pane 子进程注入 `HERDR_ENV=1 / HERDR_SOCKET_PATH / HERDR_PANE_ID`（`src/pane.rs:127-149`），hook 反向连 socket（Windows 命名管道 `\\.\pipe\...`）发 JSON-RPC。
- **上报方法**：`pane.report_agent`（state + message + seq + session ref）/ `pane.report_agent_session`（session_start_source 白名单：startup/resume/clear/compact/new/fork/select）。
- **状态推导（pi 侧）**：
  - `pi.on("session_start")` → 仅 TUI mode 生效，上报会话身份
  - `pi.on("agent_start")` → working
  - `pi.on("agent_settled")`（isIdle()===true）→ idle
  - `pi.events.on("herdr:blocked")` → **blocked 计数栈**（active/label，Ask/tool approval 等待时 pi 发出此事件）
  - 状态串行队列 + 单调 seq + 500/1500ms 两次重试（hook:145-173, 21-54）
- **session identity**：`ctx.sessionManager.getSessionFile()` 绝对路径优先 → `agent_session_path`；`getSessionId()` 兜底 → `agent_session_id`。
- **server 侧**：`handle_pane_report_agent`（app/api/panes.rs:1231-1258）→ `AppEvent::HookStateReported` → `terminal.set_hook_authority_with_session_ref`（terminal/state.rs:633-747）。

### resume 契约（`src/agent_resume.rs:116-213`）

session_ref 持久化 `{source, agent, kind: Id|Path, value}`（pi/omp 必须绝对路径），server 重启后 `restore.rs` 为每个带 session 的 pane 生成 resume argv 并**当命令键入新 shell**：`pi --session <path>`、`claude --resume <id>`、`codex resume <id>`…（16 张映射表）。开关 `session.resume_agents_on_restore` 默认 true。同 session 去重防双开。

## 5. worktree 与持久化

- **worktree = 薄封装 `git worktree`**（`src/worktree.rs` 913 行）+ **每个 checkout 自动成为一个 workspace**（`WorktreeSpaceMembership{key, repo_root, checkout_path, is_linked_worktree}` 挂 workspace 上）+ 侧边栏按 repo_key 分组树。
- 分支命名 `worktree/<adj>-<noun>-<suffix>`；路径 `~/.herdr/worktrees/<repo>/<slug>`；create 走后台线程 + per-checkout pending 表 + operation_id（防并发串台）；remove 保留分支（`worktree_remove_command_preserves_branch...` 测试）；**Windows 删除前必须先杀该 workspace 的 terminal**（文件占用）。
- **从不 merge 分支**（无该代码路径）——合并是用户/工具在共享 repo refs 上的事。
- **agent 不感知 worktree**：隔离纯粹是位置性的（pane cwd = checkout 路径）。
- **持久化 = 布局 + pane 元数据**（cwd/label/agent 名/session ref/argv）+ 独立 ANSI 历史文件；5s 防抖原子写（tmp+rename）；恢复 = **每个 pane 新 shell + 保存的 cwd**（`restore.rs:64` 注释原文 "Each pane gets a fresh shell in its saved cwd"）。**server 重启杀进程属实**（session.rs:127 "Stopping exits pane processes."）；agent 靠 resume argv 续聊。

## 6. 关键洞察：herdr 不做什么（我们 GUI 的增值空间）

| herdr 代码事实 | 含义 |
|---|---|
| 全库无 planner / task graph / reviewer / 结果汇总 / 委托原语 | **编排本身不是 herdr 的能力**——它是"运行环境 + 控制原语" |
| 无 harvest：结果获取 = `agent.read` / `pane.wait_for_output` 读终端 | "收割"在 herdr 里 = 读输出（配合 git 分支上的提交） |
| 无 agent→agent 消息 | 编排者（人/工具）用 start/prompt/wait/read 操作每个 agent |
| done = Idle + unseen | "完成未看"是收割提醒信号 |
| worktree 不 merge | 并行隔离靠 git，合并留给外部 |

**结论**：用户要的"总任务→自动拆解→并行 agent→自动收割→汇总→再派发" = **herdr 底座（并行运行环境 + 状态 + wait/read 原语 + worktree）+ 编排层（planner/dispatcher/harvester/reviewer）**。后者在 herdr 生态里只有 `@andrewjacop/pi-herdr` 的薄工具面（spawn/send/wait/harvest 各一个函数），没有完整闭环——**GUI 做完整闭环就是"效果最好的方式"**，不算降级，而是 herdr 之上的正当增值。

---

## 7. 我们现状 vs herdr 底座：差距映射

| herdr 机制 | 我们现状 | 差距 |
|---|---|---|
| 真多 agent 并行运行（每 agent 独立会话） | ✅ AgentRuntimeRegistry 同 workspace 多 agent（真 WorkspaceSession） | 无 |
| 生命周期状态（4 态 + hook/screen 双通道） | ⚠️ 有 agents:event 驱动的状态 + blocked 严格语义（permission/plan/approval/queue） | 信号真实但缺 **state_change_seq 单调计数**（wait 基石） |
| done = Idle + unseen | ⚠️ done = idle + hasAssistantOutput（useAgentFleet.ts:217） | 无 seen 概念，语义不准 |
| `agent.wait`（until + 身份锁定 + 事件驱动） | ❌ 无任何 wait 原语 | **缺** |
| `agent.prompt --wait`（效果检测 5s stalled） | ❌ prompt 是 fire-and-forget | **缺** |
| `agent.read`（4 种 source） | ⚠️ 有 messagesByAgent 全文流 | 无"读某 agent 最近输出快照"原语 |
| `agent.start` managed（launch_pending/interactive_ready/settle+timeout） | ⚠️ create 有 starting→idle | 无 interactive_ready（何时可投喂） |
| 事件环（seq 环形缓冲 + 过滤订阅） | ⚠️ agents:event 广播无 seq 无过滤 | 部分 |
| worktree 隔离 | ❌ 完全无 | **缺** |
| resume（重启恢复 agent 会话） | ⚠️ sqlite 会话持久化 + pi JSONL 原生会话 | 无"重启后自动 --resume 多 agent" |
| 聚合优先级 Blocked > Done-unseen > Working | ✅ STATUS_PRIORITY 同构（error>blocked>working>done>idle） | 无 done-unseen>working 规则 |
| 进程退出清理 hook 权威 | ⚠️ watchdog 有，无进程探针 | 部分 |

## 8. 不降级实现方案（底座层 + 编排层）

### 阶段 A — 编排原语层（复刻 herdr 底座，GUI 化）

1. **state_change_seq**：给每个 AgentRuntime 加单调 `state_change_seq`，随 `agents:event`/`agents:state` 广播；渲染层 fleet 状态、wait 匹配、stalled 检测全部基于它。
2. **`waitAgent(agentId, until[], timeoutMs)` 原语**（main 侧）：事件驱动等待 + 快照 probe + 身份锁定（agentId 即身份，天然锁定）+ 超时错误码；renderer 与编排层共用。
3. **`promptAndWait(agentId, text, {until, timeoutMs})`**：prompt 后先等 seq 前进（5s stalled 检测 → `agent_prompt_stalled`），再等 settle 状态——所有"派发任务等结果"的调用走它。
4. **`readAgentOutput(agentId, {source, lines})`**：读最近输出快照（对齐 herdr 的 recent-unwrapped 语义——从 messagesByAgent 派生即可，但要定义"未看到的新输出"口径）。
5. **seen 语义**：pane 级 seen → agent 级（展开卡片/聚焦 = seen）；done = idle + unseen；聚合表改为 Blocked > Done-unseen > Working > Idle > Unknown。
6. **managed start 状态**：create 返回后增加 `interactive_ready`（settle 检测），编排层在 ready 前不投喂。
7. **事件环**：agents:event 加 seq + 订阅过滤（可选，先加 seq 足够）。

### 阶段 B — worktree 隔离层

8. **WorktreeService**：git worktree add/list/remove 封装（herdr 同款：分支 slug、checkout 目录、porcelain 解析、`.git` gitdir 归属校验、remove 保留分支）；`{repo_key, checkout_path, is_linked_worktree}` 挂 workspace；侧边栏按 repo_key 分组。
9. **每编排子任务一个 worktree**：spawn agent 时 cwd = checkout 路径（agent 隔离 = 位置性，与 herdr 一致）；完成后 diff/合并由编排层驱动（herdr 不做，我们做）。
10. Windows 护栏：删除 worktree 前杀该 workspace 的 agent 会话（文件占用）。

### 阶段 C — 编排闭环层（GUI 增值，真"效果最好"）

11. **总任务入口**：chat 内一条总任务 → 编排视图（任务图：子任务卡 + 状态 + 依赖）。
12. **Planner**：一个 planner agent（或主 agent 会话）把总任务拆成子任务列表（每子任务：目标/验收/依赖/worktree 分支）。
13. **Dispatcher**：按依赖拓扑并行 spawn N 个 agent（每 agent 一个 worktree + 一个真 session），全部走 `promptAndWait`（until=done/blocked）——blocked 时通知用户介入（审批流已有）。
14. **Harvester**：agent done 后自动收割 = readAgentOutput 全文 + git 分支 diff 汇总（复用 git-snapshot-cache 思路，按 worktree 分支）。
15. **Reviewer**：汇总阶段一个 reviewer agent（或聚合 prompt）读全部收割产物，产出合并报告 + 冲突/缺口清单。
16. **再派发**：Reviewer 报告中的修复项 → 派发下一批（同 pipeline 递归）。
17. **合并**：每 worktree 分支合并回主分支（用户确认或自动，UI 展示 diff）。

### 验收标准（每条都必须打包版实机跑真 agent）

- A：多 agent 并行跑同一 workspace 真实任务，两个都 working，无串扰（wait 身份锁定生效）。
- B：prompt 被吞场景（agent 忙）返回 `agent_prompt_stalled` 而非无限挂起。
- C：总任务"给 Pi Desktop 增加 GitHub OAuth 登录"→ 自动产生 ≥4 个子任务 agent 并行 → 全部 done → 汇总报告 + 各分支 diff 出现。
- D：重启应用后，编排中的 agent 会话 resume 续聊（sqlite 会话 + pi --session）。
- E：两个 agent 各自 worktree，改同一文件不冲突；完成后合并 diff 可见。

### 明确不做（与 herdr 对齐，防范围漂移）

- 不做真 PTY 终端渲染（我们无 node-pty 需要；agent 在 GUI 内是 SDK 会话，输出走 messages 流——比终端读屏更准，manifest 屏幕检测对我们无意义）。
- 不做 screen manifest 引擎（无终端屏幕可检测；我们的 blocked 信号源已真实）。
- 不做 server 守护进程 detached 模式（v1 保持应用内运行；resume 覆盖重启恢复）。
- 不做 pane/tab 布局（会话模型不同，无终端复用需求）。

---

## 9. 关键文件索引（herdr 侧，供后续对照）

| 主题 | 文件 |
|---|---|
| 状态机仲裁 | `src/terminal/state.rs`（2120-2161 recompute_effective_state；633-747 hook authority） |
| 检测循环/去抖 | `src/pane.rs:694-973`；`src/pane/agent_detection.rs` |
| manifest 引擎 | `src/detect/manifest.rs`；`src/detect/manifests/pi.toml` |
| API 契约 | `src/api/schema.rs`；`src/api/schema/agents.rs`；`src/api/wait.rs` |
| pi hook | `src/integration/assets/pi/herdr-agent-state.ts` |
| resume | `src/agent_resume.rs`；`src/persist/restore.rs` |
| worktree | `src/worktree.rs`；`src/app/api/worktrees.rs`；`src/app/api/worktrees/deferred.rs` |
| 聚合 | `src/workspace/aggregate.rs:75-100` |
| 事件环 | `src/api/event_hub.rs`；`src/api/schema/events.rs` |
