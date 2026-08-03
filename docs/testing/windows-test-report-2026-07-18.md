# Pi Desktop Windows Test Report

> **Historical / Superseded report.** This report covers the `1.0.13` test object and is retained as dated evidence. It does not define the current source or release state; use [`../current/facts.md`](../current/facts.md) and [`../current/testing-and-qa.md`](../current/testing-and-qa.md).

测试日期：2026-07-18  
测试对象：Pi Desktop `1.0.13`  
测试平台：Windows 11（build 10.0.26200），Electron 41.2.0，Node.js 24.15.0，pnpm 9.0.0，Pi CLI 0.78.1。

## 结论

**当前版本不建议作为“全功能通过”版本发布。**

核心编译、类型、lint、单元/集成测试、主进程 IPC 冒烟和 Windows 打包均通过；但真实 Electron E2E 仍有稳定失败，覆盖到设置窗口生命周期、Git/Workbench 路由、历史搜索、模型设置、连续验收和视觉入口。按发布门槛，P0 相关路径存在未关闭风险，结论为 **Conditional / Not Ready**。

## 测试设计

已建立 174 条 Windows 功能测试用例矩阵：

| 优先级 | 数量 | 范围 |
|---|---:|---|
| P0 | 55 | 启动、聊天、会话、工作区、权限、文件安全、终端、错误契约 |
| P1 | 101 | Git、设置、模型、计划/任务/记忆、技能/插件、更新器、窗口生命周期 |
| P2 | 18 | 视觉、无障碍、DPI、性能、诊断、安装升级和异常恢复 |

完整用例见 [windows-test-matrix.md](windows-test-matrix.md)。每条用例按正常、空值/边界、非法输入、错误恢复、重复操作、重启/并发和越权场景设计；实际执行状态以本报告为准。

## 执行结果

| 层级 | 命令/范围 | 结果 |
|---|---|---|
| TypeScript | `pnpm -r typecheck` | PASS，shared-types 和 desktop 均通过 |
| ESLint | `pnpm -r lint` | PASS |
| Unit/Integration | `pnpm -r test` | PASS，192 个测试文件，2,123 个测试通过，2 个跳过 |
| Production build | `pnpm --filter @pi-desktop/desktop build` | PASS |
| Main runtime smoke | `node scripts/smoke-main-runtime.cjs` | PASS，149 个唯一 `handle`、8 个唯一 `on`，无重复 IPC |
| Electron E2E | `pnpm --filter @pi-desktop/desktop e2e` | 113 tests：79 PASS、2 flaky、6 skipped、26 FAIL，约 52.1 分钟 |
| Windows unpacked | `pnpm --filter @pi-desktop/desktop package:dir` | PASS |
| Windows NSIS | `pnpm --filter @pi-desktop/desktop package` | PASS |

打包产物：

- `apps/desktop/dist/Pi-Desktop-1.0.13-setup.exe`，159,103,822 bytes。
- `apps/desktop/dist/Pi-Desktop-1.0.13-setup.exe.blockmap`，167,534 bytes。
- `apps/desktop/dist/win-unpacked/Pi Desktop.exe`，222,589,440 bytes。

本次没有在隔离虚拟机中执行安装、卸载、升级回滚和真实发布更新安装；这些用例仍应标记为 `BLOCKED/NOT_RUN`，不能由“安装包构建成功”替代。

## 模块结论

| 模块 | 状态 | 结论 |
|---|---|---|
| 启动、窗口、托盘、窗口几何 | PARTIAL PASS | 启动、托盘、几何通过；设置窗口 close 事件相关 E2E 与实现语义不一致 |
| Pi 状态、Onboarding、配置 | PARTIAL PASS | 状态检测、onboarding、基础配置通过；provider 文案契约和跨窗口同步有失败 |
| 工作区、会话中心、历史 | PARTIAL PASS | 工作区生命周期、会话持久化、归档/恢复通过；历史搜索结果和部分 workspace 入口失败 |
| 聊天、模式、流式运行 | PARTIAL PASS | ChatInput、Plan 单次提交、附件、权限模式通过；空态右栏、Compose 任务可见性和真实 Provider 路径仍有问题 |
| 审批与权限 | PASS WITH FLAKY | 文件写保护、Plan 工具限制、更多决策和 overlay 通过；权限卡测试有一次 worker 崩溃后重试通过 |
| 文件与 Workbench | PARTIAL PASS | 项目探测和 IPC 文件能力通过；从右栏进入 Git/文件面板的复合入口不稳定 |
| Git | PARTIAL PASS | status、分支、commit/push 右栏工作流通过；部分入口没有挂载 `Git 面板` region |
| Terminal | PARTIAL PASS | 终端基础路径和权限卡通过；设置窗口关闭、侧栏像素布局和 Git 入口失败 |
| Plan/Task/Memory/Long Horizon | PARTIAL PASS | 相关单测和部分 E2E 通过；需要真实配置的 long-horizon/Provider 场景有跳过或失败 |
| Skills/Plugins/Pi packages | PASS WITH LIMITS | 空列表、IPC、可见安装/更新/卸载按钮通过；真实网络 marketplace 深度失败恢复仍需环境测试 |
| Updater/Diagnostics | PARTIAL PASS | updater UI 流程通过；未执行有真实新版本的下载/安装重启回归 |
| A11y/视觉/主题 | PARTIAL PASS | 2 个 axe 基线通过，深色 settings surfaces 通过；主要视觉审计被 Git region 缺失阻断 |
| Windows packaging | BUILD PASS | unpacked 和 NSIS 构建通过，安装/升级/卸载尚未在隔离环境执行 |

## 失败清单与归因

以下失败均在首次执行和 Playwright retry 后保留失败，除非注明为 flaky。失败截图、trace 和 DOM snapshot 位于 `apps/desktop/e2e-output/`。

### 高优先级产品/契约候选

1. `apps/desktop/e2e/file-and-git.spec.ts:104`：Git panel UI 入口按钮等待 30 秒超时；复现为部分工作区/新任务状态下右栏没有 `提交或推送，打开 Git 面板`。
2. `apps/desktop/e2e/smoke.spec.ts:68`：顶层导航 smoke 在进入 Git 后找不到 `region[aria-label="Git 面板"]`。
3. `apps/desktop/e2e/terminal-and-tools.spec.ts:272`：右栏 Files/Git 入口中的 Git region 未挂载；`visual-audit.spec.ts` 的两个视觉用例同样失败。
4. `apps/desktop/e2e/settings-interactions.spec.ts:445`：API 类型选项实际是 `OpenAI 兼容`、`Codex`、`Claude Code`，测试仍期待 `OpenAI Chat Completions`、`OpenAI Responses`、`Anthropic Messages`。这是 UI 文案/测试契约不一致，需要产品和测试共同决定兼容策略。
5. `apps/desktop/e2e/terminal-and-tools.spec.ts:343`：侧栏顶部对齐断言收到 1.1667px，要求 <=1px；需要统一布局 rounding 或放宽到设备像素误差。
6. `apps/desktop/e2e/compose-workflow-runtime.spec.ts:392`：任务总览中 `Brainstorm`、`Design`、`Implement`、`Verify` 未达到可见状态，且重试仍失败。
7. `apps/desktop/e2e/chat-view.spec.ts:178`：发送后测试等待右栏 `进度` heading，但 `RightRail` 的进度区是条件渲染，`showProgress` 为 false 时整个区块不挂载。需要明确空闲态是否应显示进度区。

### 测试脚本/环境前置问题

8. 9 个测试在设置关闭处等待 Electron `close` 事件，但实现明确在 `settings-window.ipc.ts:103-106` 对非退出场景 `preventDefault()` 并 `hide()`；这些测试应等待窗口不可见而不是等待销毁。受影响包括 continuous acceptance、full-demo、interactive-demo、notification-settings、settings-persistence、settings-pi-config-sync、smoke、terminal-and-tools、third-party-model。
9. `apps/desktop/e2e/m6-final-electron-acceptance.spec.ts:265`：测试模型 `e2e / stub-model` 未配置 API key，`agents:create` 被正确拒绝；这是环境阻塞，不应当计为产品功能通过。
10. `apps/desktop/e2e/continuous-f06-f10.spec.ts:298` 与 `apps/desktop/e2e/smoke.spec.ts:259`：`高`/`低` thinking menu 的 locator 解析到两个元素，属于重复 DOM 或测试 locator 过宽，需要加 `exact`/限定可见菜单。
11. `apps/desktop/e2e/session-history.spec.ts:108` 和 `apps/desktop/e2e/m2-workspace-routing-acceptance.spec.ts:43`：期待“找到 1 条结果”，但历史搜索结果未产生；需先确认 fixture 是否成功创建会话、索引是否完成，再判断搜索实现缺陷。
12. `apps/desktop/e2e/m5-search-io-export-acceptance.spec.ts:73` 与 `deep-use-current-fixes-acceptance.spec.ts:109`：期待工作区切换按钮，但页面处于没有该 workspace 入口的状态；可能是工作区异步注册/选择时序问题，也可能是新任务页的右栏契约问题。
13. `apps/desktop/e2e/programmer-workflow.spec.ts:39`：真实程序员流程没有看到用户消息，属于真实 Agent/Provider 依赖的路径，需要配置可用模型后复测。

### Flaky/稳定性

- `plan-mode-current-ui.spec.ts:311`：thinking block 首次失败，retry 通过。
- `terminal-and-tools.spec.ts:297`：runtime permission card 首次失败，retry 通过。
- E2E 过程中出现 Electron worker `3221226505`（Windows native crash/abnormal exit code）迹象，虽然对应测试有重试或最终归入 flaky，仍应作为 Windows 稳定性风险单独追踪。

## 证据与实现核对

- 设置窗口隐藏语义：`apps/desktop/src/main/ipc/settings-window.ipc.ts:103-106`。
- 右栏进度条件渲染：`apps/desktop/src/renderer/src/components/MiniMaxCode/RightRail.tsx:199-237`。
- Git 面板只有在 Workbench `view === "git"` 且 surface 可见时挂载：`apps/desktop/src/renderer/src/components/Workbench/WorkbenchPanel.tsx`。
- provider API 类型当前中文标签：`apps/desktop/src/renderer/src/components/Settings/tabs/ManagedModelsPanel.tsx:45-47`。
- 主进程 IPC 唯一性：`scripts/smoke-main-runtime.cjs` 输出 149/149 和 8/8。

## 发布建议

1. 先修正或统一设置窗口关闭契约，并将受影响 E2E 从 `waitForEvent("close")` 改为等待 `isVisible() === false`；然后重新跑所有设置/连续验收。
2. 复现并修复 Git 面板入口在新任务/无 session/异步 workspace 选择状态下的挂载问题；这是当前最集中的用户可见失败。
3. 给 E2E 使用隔离且明确的 stub provider/api key，避免 M6 和 programmer workflow 被环境配置污染。
4. 修正 thinking 菜单和 API 类型测试契约，处理中文本地化与 exact locator。
5. 重新执行 113 条 E2E，目标为 `0 failed`、flaky 不超过既定阈值；再进行隔离环境的安装、启动、卸载、升级、回滚和 updater install 实测。

## 最终判定

- **代码质量门禁：PASS**
- **构建与打包：PASS**
- **核心自动化单元/集成：PASS**
- **真实 Windows Electron 全功能验收：FAIL / NOT READY**
- **本次测试任务：已完成用例设计、执行、失败归因和报告；产品发布门槛未通过。**

