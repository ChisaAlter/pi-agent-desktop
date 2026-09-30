# Real Herdr Integration — 运行时契约

> 状态：**G3A 已落地；G3B/G3C 仍 BLOCKED**。
> 固定运行时：官方 Windows preview `0.8.0-preview.2026-08-04-d78e3d3b5126`（commit `d78e3d3b51266a1ff80ae6858b894e782aac3e9f`，asset `herdr-windows-x86_64.zip`）。
> 依据：官方源码 `C:\Ai\herdr-source` + 已批准设计契约 §7。不得再用 mock 冒充 Herdr 本体。

## 1. 目标

Pi Desktop 是 Herdr 的 GUI 套壳与能力注入层：

- 「智能体」tab 展示官方 Herdr 控制面（session → workspace → tab → pane + 状态 + 介入操作）的实时投影；
- 「任务编排」tab 在 Herdr 之上注入桌面端持久化业务编排（DAG、轮次、审查、合入）；
- 运行时真相永远在 Herdr；Desktop Main 只做权威投影，renderer 不自行推导。

完成定义：

| 切片 | 内容 | 状态 |
|---|---|---|
| G3A | 真实控制面：连接、snapshot 投影、focus/prompt/read/send_keys | 已落地 |
| G3B | 官方 `herdr-client.sock` + xterm.js 实时终端 | BLOCKED |
| G3C | `missions.db` 持久化编排 | BLOCKED |

只有 G3A+B+C 全部通过，才能宣布「Herdr 集成完成」。

## 2. 运行时拓扑

```
Herdr persistent server
  ├─ herdr.sock          newline-delimited JSON API（不是 JSON-RPC 2.0）
  ├─ herdr-client.sock   二进制帧协议 v19（本 preview；G3B）
  └─ 拥有全部 PTY；client 断开不 kill pane
Pi Desktop main
  └─ node:net named-pipe 客户端
       Windows marker: %APPDATA%/herdr/herdr.sock
       NPFS path:     \\.\pipe\%APPDATA%\herdr\herdr.sock
```

关键事实：

- 协议形状是 `{id,method,params}` → `{id,result}` / `{id,error}`，**没有** `jsonrpc: "2.0"`。
- 普通 API：one request per connection。
- `events.subscribe`：独占长连接；首帧 `{id,result:{type:"subscription_started"}}`，后续 `{event,data}`。
- EventHub sequence 只在 server 内部；wire event **不带公开 seq**；snapshot **不带 baseline**；subscribe **没有 after-sequence**。
- Desktop 退出只断开自己的客户端和订阅，**不得**默认 `server.stop`。
- `server.live_handoff` 在本 Windows preview 上不可用。

## 3. G3A 已接入的 API

| 方法 | Desktop 消费点 |
|---|---|
| `ping` | supervisor 健康探测 |
| `session.snapshot` | Main 权威全量投影 |
| `events.subscribe` | 仅作 reconciliation 提示，随后重新 snapshot |
| `agent.focus` | 聚焦 + mark seen（只对已检测 agent） |
| `agent.prompt` | 向真实 agent 注入指令 |
| `agent.read` | 历史输出；**不得叫 live** |
| `agent.send_keys` | 向真实 agent 发送按键 |
| `server.stop` | 仅 `herdrStopServer({confirmed:true})` |
| `integration.install` | 仅 `{target:"pi", confirmed:true}` |

禁止通用 `herdr:request(method, params)` 透传。

会话级订阅只允许空对象事件。`pane.agent_status_changed` / `pane.output_matched` / `pane.scroll_changed` 必须带 `pane_id`，不能放进全局订阅。

## 4. 状态与投影

- Herdr agent 态：`idle | working | blocked | done | unknown`。
- Desktop 展示态另加 `disconnected`。
- `done = idle + unseen`；`agent.focus` 会 mark seen。
- 优先级：`Blocked > Done-unseen > Working > Idle > Unknown`。
- 断线：全部 `displayState=disconnected`；重连重新 subscribe + snapshot，不重放非幂等请求。
- `revision` 是 Desktop 自己的投影序号，**不是**伪造的 Herdr event cursor。
- `state_change_seq` 只透传 Herdr agent 字段，不当 EventHub cursor。
- `agent.*` 的 target 使用 public `pane_id`，不用 `terminal_id`。
- 业务错误（如 `agent_not_found`）不得把整条连接打成 reconnecting。

## 5. 事件环（官方事实，不是旧假设）

正确流程：

1. 建立 `events.subscribe` 独占长连接；
2. 取全量 `session.snapshot`；
3. 后续 event 只作为 75ms debounce 后的 refresh 提示；
4. 每次 refresh 用新 snapshot 替换投影，并递增 Desktop `revision`；
5. 订阅异常关闭后全部 disconnected，再按退避重连。

错误假设（已否决）：

- wire event 有公开 sequence；
- snapshot 带 baseline；
- subscribe 可 after-sequence resume；
- renderer 可直接 patch event payload。

## 6. 生命周期与隔离

- 先 ping/attach 已有 server；连不上再 locate `herdr.exe` 并 `spawn herdr server`。
- 探测顺序：`PI_HERDR_EXECUTABLE_PATH` → PATH → managedDir。
- Desktop 自己启动的 server 记 `owned=true`，但 dispose 仍然只断客户端。
- CI / Playwright / unit test 默认不自动 attach 用户 `default` session。
- 隔离真机必须设置 `HERDR_SESSION` 或 `HERDR_SOCKET_PATH`，并使用临时目录；禁止污染用户真实 Herdr / Pi / Git。

## 7. G3B / G3C 仍未完成

- G3B：读 `herdr-client.sock` 的实际 v19 能力，接 xterm.js；不支持时明确显示不兼容，禁止轮询冒充 live。
- G3C：Main 侧 `missions.db` 存 DAG/轮次/审查/合入；调用真实 `agent.start/prompt/wait/read` 与 `worktree.create/remove`。
- Windows 不承诺 `server.live_handoff`。
- `integration.install pi` 修改用户 Pi 配置前必须展示变更、备份、可回滚。

## 8. G3A 验收

1. 隔离 session 的 `session.snapshot` 与 GUI 树一致。
2. 真实 workspace/tab/pane/agent 状态变化经 Main 投影进入 GUI。
3. 真实 focus / prompt / read 走 typed IPC。
4. Desktop 关闭后隔离 server 仍可 ping；只有确认后的 `server.stop` 才停服务。
5. 生产路径无 mock agent；`agent.read` 明确标成历史输出。
6. UI-REQ-014 PASS；UI-REQ-032 / UI-REQ-045 继续 BLOCKED。
