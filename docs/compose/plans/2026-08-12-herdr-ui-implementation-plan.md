# Herdr GUI 生产实现计划 — 防需求降级 · 防偏离原型

> 状态：待用户批准
> 配套契约：
> - 视觉契约（唯一权威）：`docs/prototypes/herdr-desktop-ui-prototype.html`（已批准）
> - 语义契约：`docs/compose/specs/2026-08-12-herdr-ui-prototype-approved.md`（已批准）
> - 运行时契约：`docs/spikes/2026-08-12-herdr-source-deep-dive.md` + 后续 `real-herdr-integration` 规格

---

## 0. 铁律

1. **原型 HTML 是视觉唯一权威**：任何布局、控件、文案、交互与原型不一致，一律视为偏离，必须停工上报。
2. **设计契约是语义唯一权威**：需求解释冲突时以契约为准，不以"我理解"为准。
3. **任何需求删除、延期、替换、重新定义完成标准 = 变更请求**，必须用户显式批准后才能继续。
4. **技术困难只能标 `BLOCKED`，不能自行降级**；mock/近似实现永远不是交付物。
5. **本计划是执行合同**：每阶段有硬门，门不过即停，不进入下一阶段。

---

## 1. 需求基线（从已批准原型提取，全部编号）

### A. 全局框架

| ID | 需求 | 生产落点 | 对齐验证 |
|---|---|---|---|
| UI-REQ-001 | 顶栏 5 tab：对话/智能体/任务编排/运行/工作台/扩展，右侧 ⚙ 设置入口 | `TopTabBar` | 原型对比 |
| UI-REQ-002 | 状态条：仅连接状态+会话/进程、来源+版本、兼容性、⚙；**不得出现**检查更新/验证/切换按钮 | 新 `HerdrStatusBar` | 原型对比+负向检查 |
| UI-REQ-003 | 三种布局：studio（默认三栏）/ mission（任务优先）/ terminal（终端优先），可切换 | 视图模式状态 | 三视图截图对比 |
| UI-REQ-004 | 中文界面为主；技术名词（Herdr/Pi/Codex/Claude/pane/session）保留 | i18n | 文案抽查 |

### B. 左侧 Herdr 层级树

| ID | 需求 | 生产落点 | 对齐验证 |
|---|---|---|---|
| UI-REQ-010 | 会话→工作区→标签→窗格 4 级真实层级，不是扁平卡片 | 新 `HerdrTree` | 结构断言 |
| UI-REQ-011 | 展开/收起、搜索、状态过滤（全部/阻塞/待查看） | `HerdrTree` | 交互测试 |
| UI-REQ-012 | 每项显示身份：kind、pane id、待查看标记；状态点+文字 | `HerdrTree` | 数据断言 |
| UI-REQ-013 | 点 pane → 打开实时终端；选中态与中部/右栏联动 | `HerdrTree`+store | 联动测试 |
| UI-REQ-014 | 数据源：Main 权威 snapshot+seq，不跨进程推导 | `herdr-event-stream` | 事件测试 |

### C. 中部 Fleet（智能体 tab）

| ID | 需求 | 生产落点 | 对齐验证 |
|---|---|---|---|
| UI-REQ-020 | 按 workspace 分组卡片；宽屏多列、窄屏单列 | `AgentsPanel` 重构 | 响应式检查 |
| UI-REQ-021 | 状态徽章：工作中/已阻塞/已完成·待查看/空闲/状态未知/连接已断开 | `AgentCard` | 状态矩阵测试 |
| UI-REQ-022 | 卡片无彩色侧边框；选中用统一蓝色描边 | `AgentCard` | 负向检查 |
| UI-REQ-023 | 单状态主 CTA：阻塞→处理阻塞 / 待查看→标记已查看 / 其他→打开终端；+最近输出+更多 | `AgentCard` | 交互测试 |
| UI-REQ-024 | 显示名、kind、窗格、任务一句话、会话、工作树、状态来源 | `AgentCard` | 数据断言 |
| UI-REQ-025 | Done=Idle+unseen；Mark Seen→Idle | `fleet-store` | 状态机测试 |
| UI-REQ-026 | 优先级 Blocked>Done>Working>Idle>Unknown | `useAgentFleet` 重写 | rollup 测试 |
| UI-REQ-027 | server 断线→全部 disconnected，禁止陈旧 done；重连→snapshot+subscribe，不重放 prompt | `herdr-connection-supervisor` | 断线测试 |

### D. 实时终端（Live Pane）

| ID | 需求 | 生产落点 | 对齐验证 |
|---|---|---|---|
| UI-REQ-030 | 面包屑+连接状态（● 已实时连接/○ 已断开）+ Detach/Focus/Resize/Send Keys | 新 `HerdrPaneTerminal` | 交互测试 |
| UI-REQ-031 | blocked 横幅独立一行：「智能体被阻塞 · 在真实 pane 中处理」+主按钮 | `HerdrPaneTerminal` | 状态测试 |
| UI-REQ-032 | 真实终端内容（官方 transport），不轮询冒充 live | 官方 binary client | 协议测试 |
| UI-REQ-033 | 右侧身份面板：Agent/Pane/终端/状态权威来源/变更序号/原生会话/工作树/传输方式 | `HerdrPaneTerminal` | 数据断言 |
| UI-REQ-034 | Prompt 输入+等待选项（空闲/完成、阻塞、不等待）+发送并等待 | `HerdrPaneTerminal` | 交互测试 |
| UI-REQ-035 | live terminal 与 agent.read 历史明确区分 | `HerdrPaneTerminal` | UI 检查 |

### E. Mission Cockpit（任务编排 tab）

| ID | 需求 | 生产落点 | 对齐验证 |
|---|---|---|---|
| UI-REQ-040 | Hero：目标输入+生成任务图+开始任务+状态徽章（草稿/已规划/执行中/审查中/修订中/已通过） | 新 `MissionCockpit` | 交互测试 |
| UI-REQ-041 | 权威来源横幅：Herdr 会话+桌面投影序号+非幂等不重放 | `MissionCockpit` | 文案断言 |
| UI-REQ-042 | DAG 节点：状态色条+任务名+worker+pane+轮次；依赖箭头 | `MissionDag` | 结构断言 |
| UI-REQ-043 | 三栏：交付物（输出/diff/commit/测试/归属）、审查与修订（finding/修订/复审）、分支整合（等待/就绪/请求合入） | `MissionCockpit` | 状态矩阵测试 |
| UI-REQ-044 | 完整闭环：生成→开始→并行→交付→驳回→修订轮次2→复审通过→整合→**用户确认合入** | `mission-store`+`integration-service` | 全流程测试 |
| UI-REQ-045 | Mission 是持久化业务投影；运行时真相来自 Herdr；重启可恢复 | `missions.db` | 恢复测试 |

### F. 右侧上下文详情

| ID | 需求 | 生产落点 | 对齐验证 |
|---|---|---|---|
| UI-REQ-050 | 随选中联动：智能体身份/层级/运行时/状态/状态来源/原生会话 | `RightRail` 扩展 | 联动测试 |
| UI-REQ-051 | 能力清单（发送指令/等待/读取/发送按键/实时连接/恢复会话） | `RightRail` | 数据断言 |
| UI-REQ-052 | 工作树租约：工作区/分支/归属（任务·轮次） | `RightRail` | 数据断言 |
| UI-REQ-053 | 证据边界说明：生产状态必须反查 Herdr 证据，不来自 UI 推导 | `RightRail` | 文案断言 |

### G. 设置（生产方向已批准：设置窗口内 tab）

| ID | 需求 | 生产落点 | 对齐验证 |
|---|---|---|---|
| UI-REQ-060 | `HerdrTab` 加入设置窗口「智能体」分组（`tab-defs.ts` + `SettingsNav` 图标 + i18n 中英） | `Settings/HerdrTab.tsx` | 设置测试 |
| UI-REQ-061 | 通用：安装来源（托管/系统）、自动检查更新、自动切换稳定版 | `HerdrTab` | 交互测试 |
| UI-REQ-062 | 兼容性与能力：当前版本/API、候选版本、能力清单（握手+契约得出） | `HerdrTab` | 数据断言 |
| UI-REQ-063 | 更新流程：检查→下载候选（不影响当前）→验证兼容（真实契约冒烟）→安全切换（有智能体排队，不静默重启）→回滚 | `HerdrTab`+`herdr-updater` | 流程测试 |
| UI-REQ-064 | 诊断：服务连接、Pi 集成、运行策略（关闭保持运行/断线重连）、数据目录 | `HerdrTab` | 交互测试 |
| UI-REQ-065 | 主界面任何位置不得出现更新/验证/切换按钮（全部收敛设置） | 全局 | 负向检查 |

### H. 布局安全

| ID | 需求 | 生产落点 | 对齐验证 |
|---|---|---|---|
| UI-REQ-070 | 切换器/浮层不遮挡主内容；中/右栏底部安全区 | 布局 | 截图检查 |
| UI-REQ-071 | 折叠左栏按钮不遮挡树顶控件（`pl-12` 惯例） | 布局 | 截图检查 |

---

## 2. 禁止替代清单（防偏离原型的负面清单）

以下每一项被检测到即 FAIL，任何一项需要豁免都必须走变更控制：

1. 用扁平 Agent 卡片列表代替 session→workspace→tab→pane 层级树。
2. 状态条放回「检查更新/验证/切换」按钮，或把兼容性/版本塞成第三排。
3. 卡片重新出现彩色侧边框（红/蓝/紫）。
4. 卡片出现多个同权主按钮（超过 1 个 primary CTA）。
5. 删除/改名/合并「智能体」与「任务编排」两个 tab 而不经批准。
6. 设置做成弹窗/对话框而不是设置窗口内的 tab。
7. 断线后显示陈旧 working/done，或把 disconnected 渲染成 idle。
8. 在 GUI 伪造 blocked 审批（必须真实 pane 内处理）。
9. 跳过「最终合入用户确认」。
10. 用 mock 数据、seed 卡片、注入事件通过真实验收门。
11. 用「类似布局」代替原型布局（必须 side-by-side 截图对比通过）。
12. 中文文案又改回大量英文（技术名词除外）。
13. 移除状态权威来源/证据边界等真实身份展示。
14. 用 renderer store 推导 Herdr 状态代替 Main 权威 snapshot+seq。
15. 未实现真实运行时前，把 mock 渲染标成「已完成 Herdr 接入」。

---

## 3. 防降级治理机制（机器可执行，不是口号）

### 3.1 需求登记表（机器可读）

```text
docs/verification/herdr-ui-requirements.yml
```

每条需求记录：

```yaml
- id: UI-REQ-023
  prototype: fleet-card # 对应原型元素
  status: NOT_RUN   # NOT_RUN | IN_PROGRESS | PASS | FAIL | BLOCKED
  evidence_class: interaction-test | visual-diff | negative-check | real-runtime
  forbidden_substitute: 多主按钮并排
  files: [components/Agents/AgentCard.tsx]
  tests: [fleet-card-actions.spec.ts]
```

### 3.2 防降级检查器

```text
scripts/verification/check-herdr-ui.cjs
```

自动检查（在 CI 与本地强制运行）：

- 需求表全部有 status；`PASS` 必须有对应 evidence 文件存在且非空；
- 负面清单扫描：状态条按钮、卡片彩边 CSS、多 primary CTA、设置对话框字样、mock 标识等；
- 未登记 channel/组件引用、被删除的需求 ID 出现 → FAIL；
- `BLOCKED` 需求 ≥1 时，整体报告「未完成」，禁止汇总为 PASS。

### 3.3 原型对齐测试（关键机制）

```text
apps/desktop/e2e/herdr/prototype-parity/
  parity-flows.spec.ts   # 与原型交互流一一对应的生产流
  parity-visual.spec.ts  # 黄金截图对比
```

- **交互流对齐**：原型已定义的操作序列（打开终端→blocked 处理→mark seen→mission 闭环→断线重连→设置更新）逐条在**生产应用**重跑，断言相同的元素、状态、文案。
- **视觉对齐**：先为原型生成黄金截图基线（固定 viewport 1440×960，固定 mock 状态），生产实现后同一状态截图逐视图对比（像素 diff 容差内通过）。studio/mission/terminal × fleet/pane/mission × settings 全矩阵。
- 黄金基线由**本会话已批准的当前原型状态**生成，存 `e2e-output/baselines/herdr/`，任何原型改动必须同步更新基线并重新批准。

### 3.4 阶段门与双重审查

每个阶段结束：

1. **架构审查**：是否接了真实运行时、边界是否被偷换、是否把 mock 当证据。
2. **证据审查**：逐条核对 requirements.yml 的 evidence 文件与断言，拒绝截图自评。

审查人独立于实现者，审查结论写入 `docs/verification/herdr-ui-gates.yml`。

### 3.5 变更控制

任何以下情形 → **立即停工** → 提交受影响需求 ID、证据、替代方案 → 等用户显式批准：

- 需求删除/延期/合并/改名；
- 原型任何视觉元素的修改（布局、文案、间距、颜色、操作）；
- 真实依赖被 mock/fallback 替代；
- 完成标准被重新定义。

---

## 4. 阶段与硬门

### Phase 0 — 治理基线（先建防降级，再写代码）

交付：

- `docs/verification/herdr-ui-requirements.yml`（全部需求登记）
- `scripts/verification/check-herdr-ui.cjs`
- 原型黄金截图基线（全矩阵）
- `e2e/prototype-parity/` 框架（跑通 1 条对齐流）
- 执行规则写入 `AGENTS.md`（Herdr 相关条目）

**门 G0**：故意制造一个「UI-only 假 PASS」（例如 mock 卡片冒充 worker），checker 必须 FAIL；原型黄金基线生成成功并入库。

### Phase 1 — 生产 UI 骨架（严格按原型，mock 驱动）

交付：

- `HerdrStatusBar`、`HerdrTree`、`AgentsPanel` 重构、`AgentCard` 重构、`HerdrPaneTerminal`、`MissionCockpit`、`MissionDag`、`RightRail` 扩展、视图模式切换
- 统一的 mock store（明确标记 `PROTOTYPE_MOCK`，不得冒充运行时）
- i18n 中文文案与原型一致

**门 G1**：

- 原型对齐测试全矩阵 PASS（交互流 + 视觉 diff）
- 负面清单扫描 0 命中
- typecheck + lint + test 通过
- 用户在浏览器实测生产 UI，确认与原型一致后签署

### Phase 2 — 设置 tab 接入

交付：`HerdrTab`（tab-defs、SettingsNav 图标、i18n 中英）、更新/诊断交互。

**门 G2**：设置窗口导航含「Herdr 运行时」；原型设置交互流在生产复现 PASS；双语切换正常。

### Phase 3 — 真实运行时（按运行时契约）

交付：官方二进制解析、named-pipe 客户端、连接监督、事件流、官方 integration。

**门 G3**：真实 server 连接/snapshot/事件；断线重连；无 mock 替代（按 `real-herdr-integration` 规格验收）。

### Phase 4 — mock 换真实数据

交付：树/卡片/终端/任务绑定真实数据源；`useAgentFleet` 重写；移除 mock store。

**门 G4**：

- UI 每个实体可反查真实 Herdr/Mission identity；
- mock 标识 0 残留；断线/重连/blocked/mission 闭环真实通过；
- 原型对齐测试仍全 PASS（真实数据下语义一致）。

### Phase 5 — 打包真验收

交付：unpacked/installed 环境真实模型验收（按运行时契约 G11/G12）。

**门 G5**：evidence manifest 全绿；NSIS 生命周期通过；无 `BLOCKED`。

---

## 5. 证据与完成定义

### 证据等级

| 等级 | 定义 | 可证明什么 |
|---|---|---|
| E1 交互测试 | Playwright 真实应用交互断言 | 行为一致 |
| E2 视觉对比 | 原型 vs 生产黄金截图 diff | 视觉一致 |
| E3 负向检查 | 禁止替代扫描 0 命中 | 无降级 |
| E4 真实运行时 | 真实 Herdr/Pi/模型证据 | 真接入 |
| E5 打包验收 | unpacked/installed 环境 | 可交付 |

### 完成定义（全部满足才算完成）

1. 需求表每条 `PASS` 或 `BLOCKED`（BLOCKED 必须有真实原因+等待用户决策）；
2. 负面清单 0 命中；
3. 原型对齐矩阵全绿；
4. 真实运行时门 G3/G4/G5 通过（不允许 mock 通过）；
5. 证据清单 `docs/verification/herdr-ui-evidence.md` 全部可复查；
6. 用户实测签署。

---

## 6. 停机规则（自动触发，不商量）

出现以下任一情况，相关阶段立即停止，仅输出证据与根因：

- checker 检测到负面清单命中；
- 原型对齐 diff 超容差且未经批准；
- 需要以 mock/回退/近似完成某需求；
- 真实运行时依赖缺失（二进制/协议/integration/模型环境）；
- 需求被要求改名、合并、延期；
- 完成标准被要求重新定义。

停机时输出：受影响需求 ID、证据、根因、可选变更方案；**未经用户书面批准，原需求保持 BLOCKED**。

---

## 7. 执行纪律

- 分支：`feature/herdr-gui-*`，每阶段一个分支，阶段门通过才合入 `master`；
- 提交：conventional commits，commit message 带需求 ID（如 `feat(fleet): 单状态主 CTA 卡片 UI-REQ-023`）；
- 验证顺序：`pnpm -r typecheck && pnpm -r lint && pnpm -r test` → 对齐测试 → 门证据；
- 任何阶段不得同时推进两个以上「未过门」的阶段。
