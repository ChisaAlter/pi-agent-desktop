# Pi Desktop Compose Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use workflow:subagent-driven-development (recommended) or workflow:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `C:\Ai\pi-desktop` 落地一个真实可执行的 Compose runtime：在桌面端提供 `workflow` 工具和内建 `compose` 流程，接通设置/能力报告/UI 状态，并完成真实 Electron 验收。

**Architecture:** 以现有 Pi SDK extension system 为 runtime host，在 `apps/desktop/extensions/compose-mode` 内新增 workflow tool、run registry、child-agent/worktree helpers 和 built-in compose executor；主进程只负责能力真相、bundle 加载和设置接线。真实 Compose 优先走 workflow runtime，关闭时回退到现有 prompt-only Compose。

**Tech Stack:** Electron 41, TypeScript 5, Pi SDK extension API, PowerShell, git worktree, Vitest 4, Playwright, pnpm 9

---

## File Structure

### New

- `apps/desktop/extensions/compose-mode/types.ts`
- `apps/desktop/extensions/compose-mode/workflow-tool.ts`
- `apps/desktop/extensions/compose-mode/workflow-run-store.ts`
- `apps/desktop/extensions/compose-mode/compose-workflow.ts`
- `apps/desktop/extensions/compose-mode/child-agent.ts`
- `apps/desktop/extensions/compose-mode/git-worktree.ts`
- `apps/desktop/extensions/compose-mode/artifact-paths.ts`
- `apps/desktop/extensions/compose-mode/__tests__/workflow-run-store.test.ts`
- `apps/desktop/extensions/compose-mode/__tests__/artifact-paths.test.ts`
- `apps/desktop/extensions/compose-mode/__tests__/git-worktree.test.ts`
- `apps/desktop/e2e/compose-workflow-runtime.spec.ts`

### Modify

- `apps/desktop/extensions/compose-mode/index.ts`
- `apps/desktop/extensions/compose-mode/events.ts`
- `apps/desktop/extensions/compose-mode/prompts.ts`
- `apps/desktop/src/main/services/pi-session/factory.ts`
- `apps/desktop/src/main/services/agent-runtime/registry.ts`
- `apps/desktop/src/main/services/mimocode-runtime-port.ts`
- `apps/desktop/src/main/services/__tests__/mimocode-runtime-port.test.ts`
- `apps/desktop/src/main/ipc/chat.ipc.ts`
- `apps/desktop/src/renderer/src/components/Settings/tabs/LongHorizonTab.tsx`
- `apps/desktop/src/renderer/src/stores/runtime-feature-store.ts`
- `apps/desktop/e2e/deep-use-agent-mode-runtime.spec.ts`
- `apps/desktop/e2e/long-horizon-live-acceptance.spec.ts`

## Task 1: 接通 Workflow Runtime 能力真相

**Files:**

- Modify: `apps/desktop/src/main/services/pi-session/factory.ts`
- Modify: `apps/desktop/src/main/services/mimocode-runtime-port.ts`
- Modify: `apps/desktop/src/main/services/__tests__/mimocode-runtime-port.test.ts`
- Modify: `apps/desktop/src/renderer/src/components/Settings/tabs/LongHorizonTab.tsx`
- Modify: `apps/desktop/src/main/ipc/chat.ipc.ts`

- [ ] **Step 1: 扩展 desktop extension 加载条件**

目标：

- `resolveBundledDesktopExtensionPaths()` 增加 `workflowEnabled` 和 `composeWorkflowEnabled`
- 只要任一开关需要 Compose runtime，就加载 `compose-mode` bundle

Run:

```powershell
rg -n "resolveBundledDesktopExtensionPaths|composeModeEnabled" apps/desktop/src/main/services/pi-session/factory.ts apps/desktop/src/main/ipc/chat.ipc.ts
```

Expected:

- 能精确定位 `factory.ts` 和 `chat.ipc.ts` 的现有加载入口

- [ ] **Step 2: 让 runtime port 报告真实 workflow 能力**

目标：

- `workflow` 不再固定 `unsupported`
- `supported` 取决于 bundle 是否存在
- `enabled` 取决于 `longHorizon.workflow.enabled`
- `dream` / `distill` 保持 `unsupported`

Run:

```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/__tests__/mimocode-runtime-port.test.ts
```

Expected:

- workflow 相关断言从 “unsupported only” 更新为真实支持矩阵

- [ ] **Step 3: 补齐设置页开关**

目标：

- `LongHorizonTab.tsx` 暴露 `workflow` 与 `composeWorkflow`
- UI 不再只有 `planMode` 和 `composeMode`

Run:

```powershell
rg -n "\"workflow\"|\"composeWorkflow\"" apps/desktop/src/renderer/src/components/Settings/tabs/LongHorizonTab.tsx apps/desktop/src/renderer/src/i18n/locales/zh-CN.json apps/desktop/src/renderer/src/i18n/locales/en.json
```

Expected:

- 设置页有真实入口，不再出现“配置里有字段、UI 里没有开关”

- [ ] **Step 4: 跑第一轮 capability 回归**

Run:

```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/__tests__/mimocode-runtime-port.test.ts
pnpm --filter @pi-desktop/desktop build
```

Expected:

- runtime feature state 和设置接线不破坏现有构建

## Task 2: 建立 Workflow Tool 和 Run Registry

**Files:**

- Create: `apps/desktop/extensions/compose-mode/types.ts`
- Create: `apps/desktop/extensions/compose-mode/workflow-run-store.ts`
- Create: `apps/desktop/extensions/compose-mode/workflow-tool.ts`
- Modify: `apps/desktop/extensions/compose-mode/index.ts`
- Test: `apps/desktop/extensions/compose-mode/__tests__/workflow-run-store.test.ts`

- [ ] **Step 1: 定义 workflow run / request / result 类型**

目标：

- 统一 `run/status/wait/cancel`
- 限定只支持 built-in `compose`
- 给 run registry、tool、executor 共用

- [ ] **Step 2: 实现内存态 run store**

目标：

- 支持 `createRun`
- 支持 phase/status 更新
- 支持 `wait` promise
- 支持取消

Run:

```powershell
pnpm --filter @pi-desktop/desktop test apps/desktop/extensions/compose-mode/__tests__/workflow-run-store.test.ts
```

Expected:

- run 生命周期在单测里可重复验证

- [ ] **Step 3: 注册 workflow tool**

目标：

- `workflow-tool.ts` 注册名为 `workflow` 的真实 tool
- 操作支持 `run/status/wait/cancel`
- `script` 入参显式拒绝

- [ ] **Step 4: 把 workflow tool 接入 compose extension 入口**

目标：

- `index.ts` 在初始化时同时注册：
  - 现有 Compose slash/status 层
  - 新 workflow tool

Run:

```powershell
pnpm --filter @pi-desktop/desktop build
```

Expected:

- extension bundle 能正常编译

## Task 3: 建立 Child Agent / Worktree / Artifact Helpers

**Files:**

- Create: `apps/desktop/extensions/compose-mode/child-agent.ts`
- Create: `apps/desktop/extensions/compose-mode/git-worktree.ts`
- Create: `apps/desktop/extensions/compose-mode/artifact-paths.ts`
- Test: `apps/desktop/extensions/compose-mode/__tests__/artifact-paths.test.ts`
- Test: `apps/desktop/extensions/compose-mode/__tests__/git-worktree.test.ts`

- [ ] **Step 1: 实现 artifact path helper**

目标：

- 统一输出：
  - `docs/compose/specs`
  - `docs/compose/plans`
  - `docs/compose/reports`
- 目录不存在时自动创建

Run:

```powershell
pnpm --filter @pi-desktop/desktop test apps/desktop/extensions/compose-mode/__tests__/artifact-paths.test.ts
```

Expected:

- 路径计算和目录创建可在测试中验证

- [ ] **Step 2: 实现 git/worktree helper**

目标：

- 探测是否在 Git 仓库中
- 探测 worktree 能力
- 创建 / 清理 worktree
- 失败时给出显式 degraded reason

Run:

```powershell
pnpm --filter @pi-desktop/desktop test apps/desktop/extensions/compose-mode/__tests__/git-worktree.test.ts
```

Expected:

- worktree helper 对非 Git / 失败路径有稳定行为

- [ ] **Step 3: 实现 child-agent runner**

目标：

- 从 extension 内拉起 `pi` 子进程
- 传入 phase prompt / cwd / worktree path
- 捕获 stdout、stderr、退出码、最终文本

- [ ] **Step 4: 跑 helper 层构建回归**

Run:

```powershell
pnpm --filter @pi-desktop/desktop build
```

Expected:

- helper 新文件与 Electron 主进程打包兼容

## Task 4: 实现 Built-in Compose Workflow

**Files:**

- Create: `apps/desktop/extensions/compose-mode/compose-workflow.ts`
- Modify: `apps/desktop/extensions/compose-mode/prompts.ts`
- Modify: `apps/desktop/extensions/compose-mode/events.ts`
- Modify: `apps/desktop/extensions/compose-mode/state.ts`

- [ ] **Step 1: 落地 compose phase executor**

目标：

- phases 顺序固定为：
  - `Brainstorm`
  - `Design`
  - `Implement`
  - `Verify`
  - `Review`
  - `Report`
  - `Merge`
- 每个 phase 都更新 run store 和 UI 状态

- [ ] **Step 2: Brainstorm / Design 产出真实 spec + plan**

目标：

- 从 repo context 生成或更新 `docs/compose/specs/*.md`
- 生成或更新 `docs/compose/plans/*.md`
- 提取 task list 与依赖

- [ ] **Step 3: Implement phase 支持顺序执行和 worktree 隔离**

目标：

- 单任务顺序执行
- 独立任务批次在 Git 可用时自动 worktree 隔离
- 无 Git 时顺序降级并上报

- [ ] **Step 4: Verify / Review / Report / Merge 形成闭环**

目标：

- Verify 跑真实项目命令
- Review 产出 must-fix / minor 分类
- Report 写入 `docs/compose/reports`
- Merge 至少支持本地 commit；无法 commit 时明确返回原因

- [ ] **Step 5: Compose mode prompt 改为“优先用 workflow tool”**

目标：

- workflow runtime enabled 时，Compose 注入 prompt 明确要求模型对非 trivial 任务调用 `workflow`
- workflow disabled 时保留现有 prompt-only fallback

Run:

```powershell
pnpm --filter @pi-desktop/desktop build
```

Expected:

- Compose phase executor 和 prompt integration 同时通过编译

## Task 5: 接通 Renderer / Agent Mode / Runtime UI

**Files:**

- Modify: `apps/desktop/src/main/services/agent-runtime/registry.ts`
- Modify: `apps/desktop/src/renderer/src/stores/runtime-feature-store.ts`
- Modify: `apps/desktop/e2e/deep-use-agent-mode-runtime.spec.ts`
- Modify: `apps/desktop/e2e/long-horizon-live-acceptance.spec.ts`

- [ ] **Step 1: 保持模式切换兼容**

目标：

- `Build` / `Plan` / `Compose` 模式切换仍可用
- `Compose` 模式继续通过 `/compose on` 激活 extension state
- 但后续真实执行依赖 `workflow` tool

- [ ] **Step 2: 更新 runtime feature E2E 预期**

目标：

- Compose mode 相关验收不再只断言 `/compose on`
- 新增 workflow-enabled 与 workflow-disabled 两类预期

- [ ] **Step 3: 更新 long-horizon live acceptance**

目标：

- 设置页能操作 `workflow` / `composeWorkflow`
- runtime flags 变化后，Compose 的真实行为跟着切换

Run:

```powershell
pnpm --filter @pi-desktop/desktop test
pnpm --filter @pi-desktop/desktop build
```

Expected:

- 现有 renderer/main 单测不因模式/runtime 接线而倒退

## Task 6: 自动化验证 + Windows Electron 验收

**Files:**

- Create: `apps/desktop/e2e/compose-workflow-runtime.spec.ts`
- Modify: acceptance screenshot artifacts under `docs/compose/acceptance/`

- [ ] **Step 1: 新增 workflow-backed Compose Electron E2E**

目标：

- 在真实 Electron 中验证：
  - 打开 workflow/composeWorkflow
  - 进入 Compose mode
  - 触发真实 workflow phase sequence
  - 产出 Compose artifacts

- [ ] **Step 2: 跑完整自动化闸门**

Run:

```powershell
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @pi-desktop/desktop build
pnpm --filter @pi-desktop/desktop e2e
```

Expected:

- 仓库级验证链全部通过

- [ ] **Step 3: 做真实 Windows Electron 验收并截图**

必须截图并人工核对：

- `compose-runtime-01-settings-enabled.png`
- `compose-runtime-02-mode-and-phase-sequence.png`
- `compose-runtime-03-artifacts-written.png`
- `compose-runtime-04-fallback-disabled-honest.png`

验收点：

1. workflow / composeWorkflow 开关真实可用
2. Compose 不再只是 prompt wrapper
3. spec/plan/report 文件真实出现在工作区
4. workflow disabled 时行为诚实退化

- [ ] **Step 4: 最终代码审查与提交**

Run:

```powershell
git diff --stat
git diff
git status --short
```

Expected:

- 只包含 Compose runtime 相关改动
- 无无关回归

Suggested commit:

```bash
git commit -m "feat(compose): add workflow-backed compose runtime"
```

## Verification Matrix

- Runtime truth: `mimocode-runtime-port.test.ts`
- Extension helpers: `workflow-run-store.test.ts`, `artifact-paths.test.ts`, `git-worktree.test.ts`
- Repo gate: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
- Desktop build: `pnpm --filter @pi-desktop/desktop build`
- Electron acceptance: existing mode specs + new `compose-workflow-runtime.spec.ts`

## Exit Criteria

- [ ] `workflow` no longer reports permanently unsupported
- [ ] Compose mode can drive a real `workflow` tool run
- [ ] Compose artifacts are written under `docs/compose`
- [ ] Worktree isolation or honest fallback is implemented
- [ ] Automated verification passes
- [ ] Real Windows Electron acceptance and screenshots pass
- [ ] Final review confirms “不是假 Compose”
