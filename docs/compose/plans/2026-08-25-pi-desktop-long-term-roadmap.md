# Pi Desktop 长期路线图 — 审计后续（2026-08-25）

> 状态：**待执行**（Wave 0 可立即开工；Wave 3–5 有外部阻塞，见各 Wave 门条件）
> 依据：2026-08-25 全仓审计结论 + 现行门禁记录
> 配套契约与事实源（本计划不复述，只引用）：
> - 语义契约：`docs/compose/specs/2026-08-12-herdr-ui-prototype-approved.md`
> - 运行时契约（初稿）：`docs/compose/specs/2026-08-12-real-herdr-integration.md`
> - 执行合同：`docs/compose/plans/2026-08-12-herdr-ui-implementation-plan.md`（Phase 0–5 + 硬门定义）
> - 门禁记录：`docs/verification/herdr-ui-gates.yml`
> - 需求登记表：`docs/verification/herdr-ui-requirements.yml`（38 PASS / 3 BLOCKED）
> - 当前事实：`docs/current/facts.md`（以 `pnpm verify:docs` 校验）
> - 历史路线图：`docs/compose/plans/2026-06-18-pi-desktop-improvement-roadmap.md`（**Historical** — v1.0→v1.2 质量基线计划，其未尽项已并入本计划 Wave 2/6，不再单独执行）

---

## 0. 铁律（继承执行合同 §0，全程有效）

1. **技术困难只能标 `BLOCKED`，不能自行降级**；mock/近似实现永远不是交付物（禁止替代清单见执行合同 §2）。
2. **需求删除、延期、替换、重新定义完成标准 = 变更请求**，必须用户显式批准。
3. **运行时真相永远在 Herdr**（snapshot+seq，UI-REQ-014）；桌面端不跨进程推导状态。
4. **每个 Wave 有硬门（PASS / BLOCKED / STOP），门不过即停**，不进入依赖它的后续 Wave。
5. 验证顺序不可变：`pnpm -r typecheck && pnpm -r lint && pnpm -r test`，事实变更再跑 `pnpm verify:docs`，Herdr 相关再跑 `pnpm verify:herdr`。
6. **本计划不估日历时间**：工作量只用技术口径描述（涉及组件、侵入度、依赖与风险）。

---

## 1. 目标

把 Pi Desktop 从当前基线（`1.0.14`，Herdr GUI Phase 0–2 完成、Phase 3–5 阻塞）推进到：

1. 文档/CI 事实零漂移（Wave 0）；
2. Herdr GUI G1 用户签署闭环 + parity 阈值收紧（Wave 1）；
3. 主进程/渲染层超大文件结构债清偿，为 Phase 3 接线降低侵入风险（Wave 2）;
4. 官方 Herdr 二进制就绪后完成真实运行时接入、数据切换、打包验收（Wave 3–5）；
5. NSIS 安装隔离门解锁，release 证据链完整（Wave 6）。

---

## 2. 基线（今天为真的事实，2026-08-25 核对）

| 事实 | 值 | 来源 |
|---|---|---|
| 版本 / Electron / 目标平台 | `1.0.14` / `41.2.0` / Windows 10/11 x64（v1 仅 Windows） | `docs/current/facts.md` |
| Herdr 门禁 | G0 PASS；G1 技术门 PASS、**用户浏览器签署 PENDING**；G2 PASS | `docs/verification/herdr-ui-gates.yml` |
| Herdr Phase 3–5 | **BLOCKED** — 依赖官方 Herdr 二进制 + 运行时契约评审细化 | `AGENTS.md` Herdr「当前阶段」 |
| 运行时契约 | 初稿已存在：`docs/compose/specs/2026-08-12-real-herdr-integration.md`（Phase 3 开工前需细化评审） | 该文件头部状态行 |
| 需求登记表 | 38 PASS / 3 BLOCKED（UI-REQ-014 / 032 / 045，均为 real-runtime 证据类） | `docs/verification/herdr-ui-requirements.yml` |
| parity 视觉阈值（G1 校准值，待收紧） | studio 6.5–7.5%；`studio-mission-merge` 实测 20.90%（阈值 23%）；`terminal-fleet` 实测 12.67%（阈值 14%） | gates.yml G1 证据审查 |
| NSIS 隔离门 | **BLOCKED** — 测试主机无提权 / 无 Windows Sandbox / 无 Docker，且已装 Pi Desktop，禁止在其上做安装实验 | `docs/current/facts.md` 「Verification and release boundaries」 |
| 待合入 PR | Draft [PR #5](https://github.com/ChisaAlter/pi-agent-desktop/pull/5)（分支 `cursor/audit-fixes-defb`）：docs/CI 事实同步 + 调试产物清理 + `verify-doc-facts` 契约检查扩展 | PR 描述 |
| 结构债（行数为当前实测） | `chat.ipc.ts` 1380 行；`ChatInput.tsx` 1865 行；`FileWorkspace.tsx` 1110 行；`config-manager.ts` 1179 行（含同步 I/O，源码内已有 `TODO: convert to async`）；`TaskService`/`TaskRegistry` 双层并存 | 源码 |
| `--strict` 完成门 | 人工门，无 CI 接线（G0 遗留项 6，归属 Phase 5） | gates.yml G0 遗留项 |

---

## 3. Wave 索引

| Wave | 焦点 | 硬门 | 外部阻塞 |
|---|---|---|---|
| W0 | 卫生合入：PR #5 + 文档一致性 | PR 合入且 CI 绿 + `verify:docs` PASS | 无 |
| W1 | G1 用户签署 + parity 阈值收紧 + 残留门项清理 | G1 完整 PASS（含签署）写入 gates.yml | **用户浏览器实测**（外部人工） |
| W2 | 可维护性：chat.ipc 拆分 / ChatInput 抽取 / FileWorkspace / config-manager 异步 / TaskService 收敛 | 仓库门禁全绿 + 行为零回归证据 | 无（可与等待 Herdr 二进制并行） |
| W3 | Herdr Phase 3 真实运行时 | G3（执行合同 §4 + 运行时契约 §8 九条验收） | **官方 Herdr 二进制** + 契约评审 |
| W4 | Herdr Phase 4 真实数据切换（mock 退出默认路径） | G4（mock 标识 0 残留 + parity 真实数据仍全 PASS） | 依赖 W3 |
| W5 | Herdr Phase 5 打包验收 + `--strict` CI 接线 | G5（evidence manifest 全绿 + `verify:herdr --strict` exit 0 进 CI） | 依赖 W4、W6 |
| W6 | 发布信心：NSIS 隔离环境（一次性 Windows VM / Sandbox） | 安装/升级/卸载隔离矩阵 PASS 并归档证据 | **管理员可控隔离 Windows 环境**（外部资源） |

依赖图：`W0 → W1`；`W2` 与 `W1/W3 等待期`并行；`W3 → W4 → W5`；`W6` 独立推进但是 `W5` 完成门的输入（G5 要求 NSIS 生命周期通过）。

---

## 4. Wave 0 — 卫生合入（PR #5）+ 文档一致性

**范围**：零运行时逻辑变更。合入已开的 Draft [PR #5](https://github.com/ChisaAlter/pi-agent-desktop/pull/5)（`cursor/audit-fixes-defb`），并确认合入后主干文档事实无漂移。

- [ ] W0-1 复核 PR #5 diff 仍与 `master` 无冲突（docs 同步 + 9 个 `vision-*.tmp.spec.ts`/`debug-send-message.debug.ts` 清理 + `build_output.txt` 删除 + `composer-prototype-output/` 取消跟踪 + `scripts/verify-doc-facts.cjs` 新增 `verify:herdr`/`HERDR_PARITY_TARGET`/`playwright.parity.config.ts` CI 契约检查）
- [ ] W0-2 将 PR #5 从 Draft 转正并等待 `windows-latest` CI 全绿（typecheck → lint → test → coverage → docs facts → build → smoke）
- [ ] W0-3 **用户合入**（合入操作属用户决策，agent 不代合）
- [ ] W0-4 合入后在 `master` 上跑 `pnpm verify:docs` 与 `pnpm verify:herdr`，确认 0 漂移；若 AGENTS.md 的 tab 数/CI 描述与实现再有出入，追加 docs-only 修正

**门 W0**：PR #5 合入 `master` 且 CI 绿；`verify:docs` PASS。不满足 → 后续 Wave 的文档引用基线不成立，STOP。

---

## 5. Wave 1 — G1 用户签署 + parity 阈值收紧 + 残留门项清理

**范围**：关闭 `herdr-ui-gates.yml` G1/G2 登记的全部遗留项中不依赖 Phase 3 的部分。零新功能。

- [ ] W1-1 【外部阻塞：用户人工操作】`pnpm --filter @pi-desktop/desktop build:mock` 后用户浏览器实测生产 UI 与原型一致性并签署；结论写入 `docs/verification/herdr-ui-gates.yml` G1 段（把「用户浏览器实测签署待完成」改为签署记录）
- [ ] W1-2 签署后收紧 parity 视觉阈值（`apps/desktop/e2e/herdr/prototype-parity/`）：优先压缩 `studio-mission-merge`（实测 20.90%，现阈值 23%）与 `terminal-fleet`（实测 12.67%，现阈值 14%）的余量；studio 系列同步下调至实测值 +0.5–1 个百分点；每次调整跑全矩阵取证
- [ ] W1-3 若 20.9% 的 merge 残余（遮罩下任务驾驶舱布局差异：生产 hero 更高）判定为需消除而非容忍，走变更控制向用户提交视觉调整请求（原型是唯一权威，禁止单方面改生产布局去凑 diff）
- [ ] W1-4 G1 遗留项 4：G1 后跑完整主套件 e2e（含重写为空态语义的 `e2e/agents-fleet.spec.ts`），结果登记 gates.yml
- [ ] W1-5 复核 G0 遗留项 7（36 个 acceptance PNG 1.5x 重导出）向用户提请处置决定（入库基线 or 删除）

**门 W1**：G1 完整 PASS（技术 + 用户签署）写入 gates.yml；收紧后的阈值全矩阵 PASS。W1-1 未获用户签署 → 本 Wave 保持 **BLOCKED**，不阻塞 W2 开工。

---

## 6. Wave 2 — 可维护性（结构债清偿，可与 Herdr 二进制等待期并行）

**范围**：仅结构重组，不改行为、不改 IPC 通道名、不改持久化 schema。每项独立可 PR、可回滚。这一 Wave 的动机不只是整洁：`chat.ipc.ts` 与 `config-manager.ts` 是 Phase 3 接线（新增 herdr IPC 面 + 设置持久化）必然触碰的文件，先降复杂度可显著降低 W3 的合并风险。

- [ ] W2-1 `apps/desktop/src/main/ipc/chat.ipc.ts`（1380 行）按职责拆分为子模块（消息发送/流事件转发/会话生命周期/task 联动），保持 `setupChatIpc()` 对外签名与全部通道名不变；现有 `__tests__` 全部原样通过
- [ ] W2-2 `apps/desktop/src/renderer/src/components/ChatView/ChatInput.tsx`（1865 行）抽取子组件与 hooks（附件轨道/发送控制/高度联动），**不得违反** `docs/current/composer-layout.md` 契约；`e2e/composer-layout.spec.ts` 作为回归门
- [ ] W2-3 `apps/desktop/src/renderer/src/components/FileWorkspace/FileWorkspace.tsx`（1110 行）状态收敛为 reducer + 对话框子组件抽取；`FileWorkspace.test.tsx` 全绿
- [ ] W2-4 `apps/desktop/src/main/services/config/config-manager.ts`（1179 行）同步 I/O（`existsSync`/`readFileSync`，源码 46 行已有 TODO）转异步；调用点（含 `main/index.ts`）同步适配；启动路径不得引入未 await 的竞态
- [ ] W2-5 `TaskService` / `TaskRegistry`（`services/long-horizon/`）双层收敛：明确 `TaskRegistry` 为唯一业务层，`TaskService` 收敛为薄门面或移除 `getRegistry()` 泄漏；`task.ipc.ts` 9 个通道行为不变；`task-registry.test.ts` / `task-integration.test.ts` 全绿
- [ ] W2-6 每项完成即单独提交（conventional commits），仓库门禁 `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿后方可进入下一项

**门 W2**：全部子项门禁绿 + 无任何通道名/契约变化（`verify:docs`、`verify:herdr` 均 PASS）。任一子项造成行为回归 → 回滚该项，不阻塞其余子项。

---

## 7. Wave 3 — Herdr Phase 3 真实运行时【外部阻塞：官方 Herdr 二进制】

**前置（全部满足才开工，缺一 STOP）**：

1. 官方 Herdr 二进制可获取（发行渠道 + 签名/SHA-256 校验链明确）；
2. `docs/compose/specs/2026-08-12-real-herdr-integration.md` 从初稿细化并通过评审（重点补齐其 §9 待细化项：Windows named-pipe 客户端选型、二进制帧协议 v20 解析器、`terminal.attach` 与 xterm.js 集成、`live_handoff` 降级路径）;
3. W0 完成（文档基线干净）。W2 完成为强烈建议但非硬前置。

- [ ] W3-1 细化并评审运行时契约（解除初稿状态），评审结论登记 gates.yml
- [ ] W3-2 named-pipe JSON-RPC 客户端（`herdr.sock`）+ 二进制帧 v20 客户端（`herdr-client.sock`），Electron main 内实现；preload invoke/send 白名单硬门同步登记
- [ ] W3-3 连接监督（spawn/健康探测/优雅退出/断线重连 snapshot+subscribe 不重放）与 `lastEventSeq` 去重
- [ ] W3-4 官方 `integration.install`（pi 等 hook 上报）+ worktree 租约 + `agent.prompt --wait`/PromptStalled 语义
- [ ] W3-5 设置 `HerdrTab` 的开关/来源选择从 mock 状态接真实持久化与运行时数据（G2 遗留项 2）
- [ ] W3-6 逐条执行运行时契约 §8 的 9 条 G3 验收（真实 server / 事件流 ≤1s / 断线重连 / blocked 真实 pane / 帧流终端 / worktree / integration / resume / 无 mock）

**门 G3**：9 条验收全 PASS 且证据登记；`UI-REQ-014` / `UI-REQ-032` 从 BLOCKED 转 PASS 的证据类必须是 `real-runtime`。二进制不可得 → 全 Wave 保持 **BLOCKED**，禁止以 mock 冒充交付（负面清单 NL-010/015）。

---

## 8. Wave 4 — Herdr Phase 4 真实数据切换（mock 退出默认路径）

**前置**：G3 PASS。

- [ ] W4-1 `HerdrTree` / `AgentCard` / `HerdrPaneTerminal` / `MissionCockpit` 绑定真实数据源；`useAgentFleet` 按 D7 六态语义重写收尾
- [ ] W4-2 `missions.db` 持久化服务落地，`UI-REQ-045`（重启可恢复）以真实证据转 PASS
- [ ] W4-3 移除 `stores/herdr-mock-data.ts` 的默认激活路径：`PI_HERDR_MOCK=1` 仅保留为 parity 测试基础设施（`build:mock`），不出现在用户可达路径；`PROTOTYPE_MOCK` 标识生产扫描 0 残留
- [ ] W4-4 parity 全矩阵在真实数据下重跑（语义一致），阈值沿用 W1 收紧值

**门 G4**：UI 每个实体可反查真实 Herdr/Mission identity；mock 标识 0 残留；断线/重连/blocked/mission 闭环真实通过；requirements.yml 41/41 无 BLOCKED（或余项均有用户批准的变更记录）。

---

## 9. Wave 5 — Herdr Phase 5 打包验收 + `--strict` CI 接线

**前置**：G4 PASS；W6 的隔离环境可用（G5 要求 NSIS 生命周期证据）。

- [ ] W5-1 unpacked/installed 环境真实模型验收（运行时契约 G11/G12 对应项）
- [ ] W5-2 `scripts/verification/check-herdr-ui.cjs --strict` 接入 CI（G0 遗留项 6 关闭）：BLOCKED≥1 即 CI FAIL，从人工门升级为机器门
- [ ] W5-3 evidence manifest（`docs/verification/herdr-ui-evidence.md`）全绿复查 + 用户实测签署

**门 G5**：evidence manifest 全绿；NSIS 生命周期通过（来自 W6）；`verify:herdr --strict` 在 CI exit 0；无任何 BLOCKED。

---

## 10. Wave 6 — 发布信心：NSIS 隔离验收【外部阻塞：隔离 Windows 环境】

**前置**：获得管理员可控的一次性 Windows 环境（Windows Sandbox / 一次性 VM / 等效方案）。**禁止**在现维护测试主机上做安装实验（`docs/current/facts.md` 明令）。

- [ ] W6-1 【外部阻塞：环境资源】确定并搭建隔离环境（推荐顺序：Windows Sandbox → Hyper-V 一次性 VM → 云 Windows VM）
- [ ] W6-2 隔离矩阵执行：全新安装 → 升级安装（上一 release 版 → 当前）→ 卸载残留检查（`%LOCALAPPDATA%`、注册表、快捷方式）
- [ ] W6-3 electron-updater（GitHub Releases）升级链路在隔离环境验证
- [ ] W6-4 结果与复现步骤归档到 `docs/verification/`（供 G5 引用），`docs/current/facts.md` 的 NSIS BLOCKED 段落更新为已解锁事实并过 `verify:docs`

**门 W6**：隔离矩阵全 PASS 且证据归档。环境不可得 → 保持 **BLOCKED** 并如实反映在 facts.md，release 说明须继续声明该证据层缺失。

---

## 11. 横切关注（不属于单一 Wave，随触发执行）

- **安全矩阵防漂移**：任何 IPC 面/权限/审批分类变更必须同步 `docs/security/PERMISSION-MATRIX.md`，并评估是否纳入 `verify-doc-facts.cjs` 机器检查（延续 PR #5 的做法：能机器检查的事实不留给人）。
- **docs/CI 校验扩展**：`scripts/verify-doc-facts.cjs` 随新增门禁同步扩展（W5-2 的 `--strict` 接线、W6-4 的 NSIS 事实更新都属于此类）。
- **跨平台（Linux/macOS）**：仅为既有远期意向（facts.md「v1 line is Windows-only」），**本路线图不含任何跨平台工作项**；若启动须以新计划立项，前置是 W2 完成（`node-pty`/路径处理等平台耦合点先收敛）。
- **测试环境事实**：云端 Linux 环境跑 `pnpm -r test` 存在既有 Windows 路径/platform 相关失败（PR #5 记录约 35 个）；`windows-latest` CI 为权威。各 Wave 证据以 CI 结果为准，本地 Linux 失败不单独立项。

---

## 12. 决策日志与变更控制

变更控制规则（继承执行合同 §3.5）：Wave 的删除/合并/降级、门条件放宽、外部阻塞的替代方案（如用非官方二进制、跳过用户签署）一律**立即停工 → 提交受影响项 + 证据 + 替代方案 → 等用户显式批准**。批准记录追加到下表：

| 日期 | 决策 | 影响 Wave | 批准人 | 记录 |
|---|---|---|---|---|
| 2026-08-25 | 路线图基线建立（本文件） | 全部 | — | 初版 |
| _占位_ | _merge 20.9% 残余的处置（W1-3）_ | W1 | 待用户 | |
| _占位_ | _acceptance PNG 处置（W1-5）_ | W1 | 待用户 | |
| _占位_ | _Herdr 二进制渠道确认（W3 前置 1）_ | W3–W5 | 待用户 | |
| _占位_ | _隔离环境方案选定（W6-1）_ | W6 | 待用户 | |

---

## 13. 整体完成定义（Definition of Done）

以下全部满足，本路线图关闭：

1. W0–W6 每个 Wave 的硬门为 PASS，或为带用户批准变更记录的正式豁免（不存在无记录的降级）；
2. `docs/verification/herdr-ui-requirements.yml` 无 BLOCKED；`verify:herdr --strict` 在 CI 常态 exit 0；
3. `pnpm verify:docs` PASS 且 `docs/current/facts.md` 不再含「NSIS 隔离门 BLOCKED」「Phase 3–5 BLOCKED」等待解事实（或如实反映用户接受的最终状态）；
4. parity 阈值为 W1 收紧后的值且全矩阵 PASS（真实数据下）；
5. `chat.ipc.ts` / `ChatInput.tsx` / `FileWorkspace.tsx` / `config-manager.ts` 结构债清偿完成，行为零回归证据在案；
6. 用户对 G1（浏览器实测）与 G5（打包验收）两处人工签署均已登记 `docs/verification/herdr-ui-gates.yml`。

---

## 14. 明确不做（Out of Scope / Non-goals)

- **不做** Linux/macOS 移植（仅在 §11 留远期备注）；
- **不做**代码签名（历史路线图记录用户已决定不考虑）；
- **不做**任何以 mock/轮询/近似替代真实 Herdr 运行时的「提前交付」；
- **不做**原型视觉的单方面修改（原型 HTML 是唯一视觉权威，改动必须走变更控制重新批准）;
- **不在**现维护测试主机上执行任何安装/卸载/升级实验；
- **不重复执行**历史路线图（2026-06-18）中已完成或已被本计划覆盖的任务。
