# Herdr GUI 证据清单

> 每阶段证据逐条登记于此，供需求追踪与整体验收复查。
> 每条证据 = 文件路径 + 断言/内容摘要 + 生成命令。证据缺失即视为未完成。

## Phase 0 — 治理基线

| 需求 | 证据 | 类型 |
|---|---|---|
| 治理（全部） | `docs/verification/herdr-ui-requirements.yml` — 41 条登记 + 8 决策 + 15 负面清单项 | 登记表 |
| 治理（全部） | `scripts/verification/check-herdr-ui.cjs --self-test` — 8/8 PASS（T1 假 PASS 必须 FAIL） | negative-check |
| 治理（全部） | `pnpm verify:herdr` — 41 条校验通过、负面清单 0 命中、BLOCKED 3 条如实报告 | negative-check |
| 治理（全部） | `docs/verification/herdr-ui-gates.yml` — G0 门禁记录（含独立审查-修复闭环 14 项） | 门禁 |
| UI-REQ-003/020/070/071 基线 | `docs/verification/baselines/herdr/*.png` — 9 张黄金基线（1440×960，studio/mission/terminal × fleet/pane/mission + settings + merge），manifest 带 SHA-256 | visual-diff |
| 治理（全部） | `apps/desktop/e2e/herdr/prototype-parity/` — parity 框架（target 抽象、visual-compare 区域对比按 variant 几何、parity 独立配置） | 框架 |
| 交互流（原型 oracle） | `npx playwright test --config=playwright.parity.config.ts` — 17/17 PASS（树层级结构/选中联动/blocked 处理/seen/断线/mission 闭环/设置更新流/基线自检 9 项 + manifest 哈希） | interaction-test |
| 原型修复 | `docs/prototypes/herdr-desktop-ui-prototype.html` PROTOTYPE-FIX-001（事件委托修复加载崩溃）+ PROTOTYPE-FIX-002（row/card 顶层化修复更新面板）— 零视觉改动 | 修复记录 |
| 文档 | `AGENTS.md` Herdr GUI 章节 + `package.json` verify:herdr + ci.yml 步骤 | 文档 |

## Phase 1 — 生产 UI 骨架（2026-08-12，G1 技术门 PASS，用户签署待完成）

| 需求 | 证据 | 类型 |
|---|---|---|
| UI-REQ-001/010~013/020~027/030~035/040~044/050~053/070~071 | `apps/desktop/e2e/herdr/prototype-parity/parity-flows.spec.ts` — production 目标 5/5 PASS（HERDR_PARITY_TARGET=production + build:mock） | interaction-test |
| UI-REQ-003/020/070/071 | `apps/desktop/e2e/herdr/prototype-parity/parity-visual.spec.ts` — 视觉对比 8/8 PASS（阈值校准：studio 6.5-7.5%/merge 23%/terminal 14%）；截图 `docs/verification/herdr-shots/*.png` | visual-diff |
| UI-REQ-002/022/053/065 | `scripts/verification/check-herdr-ui.cjs` — 负面清单 0 命中（NL-002 状态条只扫 StatusBar、NL-065 data-action 模式） | negative-check |
| 状态语义 | `src/renderer/src/stores/__tests__/herdr-store.test.ts` 18 项（displayState/priority/rollup/DAG/panels）+ AgentsPanel 8 项 | interaction-test |
| 组件单测 | Herdr 组件 5 文件 39 项 + Agents 8 项（jsdom，zh-CN） | interaction-test |
| 门禁 | `docs/verification/herdr-ui-gates.yml` G1 记录；需求表 33 PASS | 门禁 |

## Phase 2 — 设置 tab（待做）

（待填充）

## Phase 3-5 — BLOCKED

| 需求 | 证据 | 类型 |
|---|---|---|
| UI-REQ-014/032/045 | BLOCKED — 前置依赖：运行时契约文档 `docs/compose/specs/2026-08-12-real-herdr-integration.md`（**待产出**，Phase 3 前置交付物）与官方 Herdr 二进制（可用性未验证） | real-runtime |

## 已知问题与残余风险

1. production 视觉对比阈值（0.03）为初始值，G1 首次实测校准后更新
2. NL-005 由 Phase 1 M3（mission tab）关闭
3. 36 个 acceptance PNG 1.5x 重导出，未纳入基线，待用户处置
