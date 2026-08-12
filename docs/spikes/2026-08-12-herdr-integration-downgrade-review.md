# herdr 集成需求降级审查：舰队视图为何是"壳子"

> 日期：2026-08-12
> 触发：用户实机演示后否定（"那你做了个P啊，你做的这个一点意义都没有"），要求全面审查"集成 herdr 需求被降级、做成了壳子"的问题。
> 范围：纯审查，未修改任何代码。需求链还原自 2026-08-11 会话（sess_6f223487）与仓库现状（未提交工作区）。

---

## 0. 结论摘要

**一句话**：用户要求的是"GUI 版 herdr 编排体验"（原话"我需要效果最好的方式，不要在意开发量"），交付的是"多 Agent 卡片管理页"——**状态展示层真实，编排引擎层完全缺失**。已实现部分（舰队面板、状态合成、子代理展示、收割展示、右栏 rollup）是真实可用的底座，但 herdr 的核心价值（总任务 → 自动拆解 → 并行 spawn → wait → harvest → 汇总 → 再派发）一个都没有；验收也只用 UI 结构断言和"创建两个空卡片"的实机演示，抓不到编排层缺失。结论：**需求降级属实，交付物是状态外壳，不是编排体验。**

## 1. 需求链还原（原话）

| 阶段 | 用户原话 | 对应交付 |
|---|---|---|
| 调研 | "据说pi+ herdr 的效果很不错，你调研一下" | `docs/spikes/2026-08-11-pi-herdr-research.md`（真实完成） |
| 决策 | "看看怎么在GUI实现herdr"；"**我需要效果最好的方式，不要在意开发量**" | 批准方案：完整 GUI 版 agent fleet/orchestration 体验 |
| 执行 | "`/goal 执行计划`" | 本次未提交工作区（AgentsPanel 等全部 untracked） |
| 验证 | "实机测试一下" → "**那你做了个P啊，你做的这个一点意义都没有**" | 实机演示 = 创建两个空 Agent 卡片（`e2e/_demo-visible-temp.ts`） |

关键约束：用户明确排除了"开发量"作为缩减理由；调研结论（spike §6）也明确建议参考 `@andrewjacop/pi-herdr` 的 spawn→send→wait→harvest 工具契约，而不是从零发明。

## 2. 交付物盘点：哪些是真的

以下全部为真实实现（不是假数据）：

- **多 agent 运行底座**：`AgentRuntimeRegistry`（`services/agent-runtime/registry.ts`）支持同 workspace 多个独立 agent，每个是完整 Pi WorkspaceSession；`agents:create/prompt/abort/stop/restart` IPC 全通。
- **状态合成**：`useAgentFleet` + `fleet-signals-store` 从真实信号合成 working/blocked/done/idle/error/closed；blocked 严格语义（permission/plan/approval/queue），`approval:resolved` 是本次新增的挂起解除信号（修复了响应/超时双路径计数泄漏）。
- **子代理展示**：`SubagentManager`（Phase E 既有，移植自 mimo runtime）真实 spawn/cancel/GC 子会话，`subagent:event` 广播桥 + `subagent-store` 快照刷新真实接线。
- **收割展示**：`HarvestSection` 显示 done agent 最后一条 assistant 全文 + git 改动列表（共享 `git-snapshot-cache`，LRU 8）。
- **UI 完整**：TopTabBar 5 tab、AgentsPanel 分组/rollup/展开消息流、NewAgentDialog、RightRail Agents 卡、`onOpenAgent` 跳转 chat。E2E `agents-fleet.spec.ts` 通过。

## 3. 壳子在哪：核心能力缺口

对照 herdr 价值主张与 pi-herdr 契约（spawn/send/wait/harvest），逐项缺失：

| herdr / pi-herdr 能力 | 需求对应 | 现状 | 缺口 |
|---|---|---|---|
| 总任务入口 → Planner 自动拆解 | "输入一个总任务，自动拆成多个子任务" | 无；只有 `NewAgentDialog` 手动逐个创建 | **无 Planner** |
| 并行 spawn 多个 agent | 并行启动多个 Agent | 可手动 create 多个，但无编排触发 | **无编排 spawn** |
| send（向 agent 派发任务） | 子任务自动派发 | 仅手动填 description 触发一次 prompt | 无批量派发 |
| wait（等待 agent 完成/blocked） | 实时显示 working/blocked/done | 状态可看，但无"等待结果"契约 | **无 wait 语义** |
| harvest（收割结果） | 自动收集各 Agent 结果 | 仅展示单个 agent 最后输出 + git 改动 | **无结果收集/交接** |
| 汇总（Reviewer） | 汇总、发现冲突或缺口 | 无 | **无 Reviewer** |
| 再派发 | 基于结果继续派发修复任务 | 无 | **无下一阶段** |
| worktree 隔离与合并 | 多 agent 并行不踩踏 | 无（同 workspace 共享文件系统） | **无隔离** |
| 任务图/依赖 | 子任务间依赖与交接 | 无 DAG，agent 间唯一关联是"同 workspace 分组" | **无任务图** |

补充观察：
- "舰队"里的 agent 本质上仍是 workspace 会话——单 workspace 单默认 agent 的用户打开面板只有一个卡片，与"舰队"的想象差距极大；多 agent 必须手动逐个创建。
- 子代理（actor tool 的 explore/dream/distill）由 LLM 自主决定 spawn，GUI 用户只能看+cancel，不能直接指挥——这是 pi 扩展层能力，不是 GUI 编排。
- "收割结果"按钮的语义来自 pi-herdr 的 harvest，但实现只做了"展示最后一条输出"，wait/harvest 的交接语义被丢弃。
- `AGENTS.md` 把舰队视图写成已实现事实，强化了"壳子即交付"的印象（无编排能力描述）。

## 4. 根因分析

1. **需求没有落成书面 spec**：docs/compose 无任何 agents 舰队/编排 spec 或 plan。"完整编排体验"停留在会话共识，实现时被默认为"状态展示"——范围收缩无文档可对照。
2. **机制存在 ≠ 编排存在**：实现者把"registry 已支持多 agent、subagent manager 已存在"当作编排的证据。但 agent 创建是**用户手动**触发的，不是编排器触发的；子代理是 LLM 自主的，不是 GUI 编排的。
3. **"不要在意开发量"被误读**：被理解为"UI 可以多做一点"，而非"编排引擎要完整"。
4. **验收标准缺失**：没有提前定义"herdr 体验做好了"的端到端场景。E2E 断言 UI 结构（卡片渲染、tab 导航），打包演示创建两个空卡片——两类验证都抓不到编排层缺失。

## 5. 整改路线（壳子 → 真编排）

按顺序执行，每一步可验收：

1. **写正式 spec**（`docs/compose/specs/`）：定义端到端场景（示例："给 Pi Desktop 增加 GitHub OAuth 登录" → 自动产生 架构分析/UI 实现/IPC-安全/测试/Review agent）与编排契约。
2. **编排引擎（main 侧）**：`OrchestrationService` — 总任务 → Planner（可复用主 agent 会话或专用 planner agent）→ 子任务列表 → 逐个 `registry.create` + `prompt` spawn → 状态聚合（复用现有 `agents:event` 信号）→ wait 完成 → 收集结果。
3. **依赖与交接**：第一版顺序化（一批完成后派发下一批），二期 DAG 并行。
4. **worktree 隔离**：每子任务 agent 一个 worktree（herdr killer feature），完成合并回主分支——并行不踩踏的前提。
5. **UI 入口**：总任务输入框 + 任务图视图（子任务卡片、依赖连线、阶段状态），复用现有 fleet 状态底座。
6. **端到端验证**：打包版实机跑真实多 agent 场景，断言编排产物（N 个子任务完成、汇总报告 + diff 存在），而非 UI 结构。

保留现有真实底座：AgentRuntimeRegistry 多 agent 能力（编排 spawn 的底座）、useAgentFleet 状态模型（编排展示层）、subagent 桥（agent 内部 delegation）、approval:resolved、git-snapshot-cache。
