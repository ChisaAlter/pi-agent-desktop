# Real Herdr Integration — 运行时契约（初稿，Phase 3 前置）

> 状态：**初稿（BLOCKED 解除前置）** — 本文件为 Phase 3「真实运行时」的验收规格草案。
> 依据：`docs/spikes/2026-08-12-herdr-source-deep-dive.md`（代码级事实，commit 5600197f）+ 已批准设计契约 §7。
> 路线决策 D1：官方 Herdr 二进制套壳（named-pipe JSON-RPC 客户端、官方 integration、真实 pane 终端）。
> 本文件待 Phase 3 开工前由运行时实现细化并评审。

## 1. 目标

Pi Desktop 作为 Herdr 的 GUI 套壳与能力注入层：
- 「智能体」tab 展示官方 Herdr 控制面（session→workspace→tab→pane + 状态 + 介入操作）的实时投影；
- 「任务编排」tab 在 Herdr 之上注入桌面端持久化业务编排（DAG、轮次、审查、合入）；
- 运行时真相永远在 Herdr（snapshot+seq）；桌面端不跨进程推导状态（UI-REQ-014）。

## 2. 运行时拓扑（来自 spike §1）

```
Herdr server（官方二进制，守护进程形态）
  ├─ herdr.sock        JSON-RPC（newline-delimited {id,method,params} → {id,result}/{id,error}）
  ├─ herdr-client.sock 二进制帧协议 v20（实时终端传输）
  └─ 拥有全部 PTY；client 断开不 kill pane（remove_client 只清理）
Pi Desktop（Electron main）
  └─ named-pipe 客户端（Windows: \\.\pipe\...）—— 连接以上两个 socket
```

关键架构事实（spike 引用）：
- server 是分离守护进程（Windows WMI 启动）；detach 是架构性的——client 断开后 pane 继续运行。
- agent 不是独立层：pane 内被识别的进程，状态机挂 TerminalState。
- 双通道事件：JSON-RPC 层 `events.subscribe`（带 seq）；二进制帧层承载终端内容。

## 3. 必需 API 面（来自 spike §3 API 契约表）

| 方法 | 用途 | 本桌面端消费点 |
|---|---|---|
| `session.snapshot` | 全量快照（workspaces/tabs/panes/agents + agent_session） | 初始渲染（UI-REQ-014 Main 权威） |
| `events.subscribe` | 带 seq 事件流（24 种事件） | 增量更新；seq 去重 |
| `agent.list` / `agent.get` | 枚举/解析 agent | 树/卡片身份 |
| `agent.prompt` | bracketed-paste 感知写入 + wait 长轮询 | 实时终端 prompt（UI-REQ-034） |
| `agent.wait` | until 状态等待（身份三重锁定） | 编排层等待原语 |
| `agent.read` | 读 pane 输出（visible/recent/recent_unwrapped） | 最近输出/收割 |
| `agent.send_keys` / `focus` / `rename` | 按键/聚焦（置 seen）/命名 | 终端工具栏 + seen 语义（UI-REQ-025/030） |
| `pane.send_text` / `wait_for_output` | 任意 pane 注入/读取 | 编排注入 |
| `pane.report_agent` 系列 | **反向上报通道（hook）** | 官方 integration 安装后 pi/Claude/Codex 状态上报 |
| `integration.install` / `uninstall` | 安装 16 个 agent 集成（写 hook 文件） | Desktop 托管安装流程（设置 HerdrTab） |
| `worktree.create` / `remove` | git worktree 封装（分支 slug、checkout 目录） | 编排 worktree 租约（UI-REQ-052） |
| `server.live_handoff` | 热替换（PTY fd 传递） | 更新切换（UI-REQ-063） |

## 4. 状态语义契约（对齐 spike §2）

- 核心 4 态：Idle/Working/Blocked/Unknown；`done = Idle + unseen`（seen 在 pane 聚焦/标记时置 true）。
- 仲裁：`visible_blocker 覆写 ? Blocked : hook_authority(有效)?.state ?? screen_fallback`。
- **blocked 严格判定**：只认已知审批/提问/权限 UI（manifest 命中）；命中不了回退 Idle，绝不启发式猜。
- 聚合优先级：`Blocked(4) > Done-unseen(3) > Working(2) > Idle-seen(1) > Unknown(0)`（与桌面 6 态模型一致，D7）。
- 断线：状态全部 disconnected；重连后 snapshot+subscribe，不重放非幂等操作（UI-REQ-027）。

## 5. 事件环与 seq（对齐 spike §3.1）

- `events.subscribe` 返回带 seq 的事件流；`state_change_seq` 单调计数是 wait 匹配与 stalled 检测的基石。
- 桌面端维护 `lastEventSeq`：断线重连后从 `session.snapshot` 重建，事件按 seq 去重/乱序排序。
- `agent.prompt --wait` 的 5s 效果检测（PromptStalled）与 settle 等待必须实现（spike §3.2）。

## 6. Desktop 托管二进制方案（D1）

- 托管：随应用分发或按需下载官方 Herdr 发行版（签名 + SHA-256 校验），存 `%LOCALAPPDATA%/pi-desktop/herdr/`；
- 生命周期：main 进程监督（spawn/健康探测/优雅退出）；更新走 `server.live_handoff` 或安全点重启（有 agent 排队不静默重启，UI-REQ-063）；
- 系统安装来源：探测 PATH 上的 herdr（设置 HerdrTab 二选一，UI-REQ-061）。

## 7. 能力清单与握手（设置 UI-REQ-062）

- 握手：连接后 `session.snapshot` 成功 + `events.subscribe` 成功 → 版本/API 对齐；
- 能力清单：对 `agent.start/prompt/wait/read/send_keys/focus/worktree.create/events.subscribe/terminal.attach/resume` 逐项契约探测（真实调用 + 超时判定）；
- 未声明能力不在 UI 显示（原型设置「能力清单」语义）。

## 8. 验收标准（G3 门，Phase 3 实现后逐条执行）

1. 真实 server 连接：`session.snapshot` 返回真实 workspaces/panes；渲染树/卡片与 server 一致。
2. 事件流：订阅后 pane 状态变化在 ≤1s 内反映；seq 乱序去重正确。
3. 断线重连：断线 → 全部 disconnected；重连 → snapshot 重建 + 订阅恢复；无重放。
4. blocked 真实处理：审批发生在真实 pane（GUI 只提供进入入口）；hook 上报 blocked/working 转换。
5. 实时终端：二进制帧流渲染真实 pane 输出（非轮询）；send_keys/focus/resize 生效。
6. worktree 租约：`worktree.create` 真实创建 git worktree；删除前杀占用进程（Windows 文件锁）。
7. 官方 integration：`integration.install pi` 后 pi agent 状态经 hook 上报（herdr:pi 生命周期钩子）。
8. resume：server 重启后 pane 内 agent 会话恢复（`pi --session <path>` 等 16 张映射表）。
9. 无 mock：任何 mock/占位不进入本验收证据（NL-010/015）。

## 9. 待细化项（Phase 3 开工时）

- Windows named-pipe 客户端库选型与二进制帧协议 v20 解析器；
- 桌面托管安装包来源/签名链（GitHub Releases 或官方渠道）；
- `terminal.attach` 与 xterm.js 的集成方式（现有 @xterm 依赖）；
- 更新切换与 live_handoff 的降级路径（handoff 不可用时安全点重启）。
