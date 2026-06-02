# Pi Desktop 全面优化路线图

> 编制日期：2026-06-01 · 目标版本：v1.0.1（hotfix） → v1.1.0（功能完善） → v1.2.0（质量）
> 编制说明：基于 v0.1.0 源码扫描（776 行 main、5 处 TS 编译错误、CI 配置、依赖、核心 service）形成的可执行计划。

---

## 0. 关键发现速览（先看这个）

| 严重度 | 类别 | 现状 | 影响 |
|---|---|---|---|
| 🔴 P0 | **CI 在放水** | `ci.yml` 的 lint 和 build 都加了 `continue-on-error: true` | lint 错/build 错不会阻塞 PR，质量退化无防护网 |
| 🔴 P0 | **TS typecheck 5 处错误** | `apps/ts-errors2.txt`：未使用变量、use-before-declare、属性不存在 | CI 应该挂的，但被 `continue-on-error` 救回来 |
| 🔴 P0 | **Chat IPC 订阅泄漏** | `chat.ipc.ts:56` 每次 `pi:send` 都 `.subscribe(...)`，从不取消 | 长会话内存泄漏 + 同一事件被处理 N 次 |
| 🔴 P0 | **Git 命令注入** | `index.ts:484, 502, 509` 等处 `execSync(\`git add ${filesArg}\`)` 字符串拼接 | 渲染层被 XSS 即可执行任意 git 命令 |
| 🟠 P1 | **文档/代码不同步** | README 删了 `pi-driver`，CODEBUDDY.md 还在引用；CHANGELOG `Unreleased` 段已过时 | AI 助手读 CODEBUDDY 会做错事 |
| 🟠 P1 | **messaging/gateway 偏离主线** | Feishu/QQ/WeChat 三个 adapter + GatewayPanel | v0.1 跟 AI 编码 agent 关系弱，需要产品决策 |
| 🟠 P1 | **没有代码签名** | CHANGELOG 自承 SmartScreen 警告 | 普通用户首次安装会被拦截，转化率崩 |
| 🟠 P1 | **e2e 测试缺失** | 根目录有 4 个 `.ps1`/`.js` 脚本，CI 不引用 | 手动 smoke 不进回归，v1.1 改动易炸 |
| 🟡 P2 | **手写 YAML 解析** | `parseSimpleYamlProviders` 30+ 行正则 | 已有 `js-yaml`，少写一半代码更稳 |
| 🟡 P2 | **README 没有截图** | 仓库有 5 张 png 但 README 没挂 | GitHub 首屏说服力低 |
| 🟢 P3 | **致谢链接是死链** | `Mavis Code` 链到 `mavis.local` | 看着不专业 |
| 🟢 P3 | **sandbox: false** | webPreferences 关了沙箱 | 需要明确理由或打开 |

---

## 1. 优先级总览（12 个 track）

```
P0 立即修复（v1.0.1 hotfix，1-2 天）
  T01 修复 CI 放水
  T02 修复 5 处 TS 编译错误
  T03 修复 Chat IPC 订阅泄漏
  T04 修复 Git 命令注入

P1 下一版本（v1.1.0，2-3 周）
  T05 文档与代码同步（README/CODEBUDDY/CHANGELOG）
  T06 messaging/gateway 产品决策
  T07 e2e 测试框架（Playwright for Electron）
  T08 代码签名与 SmartScreen 体验
  T09 安全审查（contextBridge 白名单 + IPC 参数校验 + classifier 加固）

P2 质量提升（v1.2.0，4-6 周）
  T10 性能优化（启动、文件扫描、长会话）
  T11 可观测性（日志、错误上报、metrics）
  T12 可访问性 / i18n / DX
```

**总估算**：单人 6-8 周；双人 3-4 周。

---

## 2. P0 — v1.0.1 hotfix（48 小时内）

### T01. 修复 CI 放水
**现状**：`ci.yml:45, 51` 两处 `continue-on-error: true`。
**问题**：lint 错和 build 错在 PR 上不会挂，掩盖回归。
**动作**：
1. 删除两处 `continue-on-error: true`
2. 配套：把 T02 跑通（否则 CI 直接红，挡住 PR）
3. 补一条 `pnpm -r typecheck` 不允许跳过
**Acceptance**：故意写一个 lint 错，PR 应当红。

### T02. 修复 5 处 TS 编译错误
**文件清单**（来自 `apps/ts-errors2.txt`）：
| # | 文件 | 错误 | 修复方向 |
|---|---|---|---|
| 1 | `main/index.ts:312` | `'sessionId' is declared but its value is never read` | 删除未用参数或加 `_` 前缀 |
| 2 | `ChatView/ChatView.tsx:21` | `'messages' used before its declaration` + assigned | 把 `useState` 移到使用前 |
| 3 | `hooks/usePiDriver.ts:24` | `All destructured elements are unused` | 删空 hook 或补实现 |
| 4 | `stores/workspace-store.ts:47` | `Property 'lastActiveAt' does not exist on type 'WorkspaceData'` | `WorkspaceData` 加 `lastActiveAt?: number` |
**Acceptance**：`pnpm -r typecheck` 全绿；CI 报绿。

### T03. 修复 Chat IPC 订阅泄漏
**现状**：`apps/desktop/src/main/ipc/chat.ipc.ts:56-67`
```ts
wsSession.session.subscribe(async (event) => { ... });
```
每次 `pi:send` 都 push 一个新 handler，**永不取消**。同时 `bridge` 和 `interceptor` 每次也是新的。
**修复方向**：
1. 把 `bridge` / `interceptor` / `subscribe` 的 handler 引用存到 `WorkspaceRegistry` 的 session 记录上
2. 每次 `pi:send` 先检查并 `unsubscribe` 旧的；或者改成"只订阅一次，注册阶段就建好"
3. 推荐第二种：把 `bridge` / `interceptor` 创建提到 `registry.get(wsId, wsPath)` 内部 lazy-init
**Acceptance**：跑 100 次 `pi:send` 后，Pi session 上 event listener 数量恒定。补一个回归测试。

### T04. 修复 Git 命令注入
**现状**（`main/index.ts`）：
- L484 `git diff "${filePath}"` — filePath 来自 renderer
- L502 `git add ${filesArg}` — 拼接，未防 `;`、反引号、`$(...)`
- L509 `git commit -m "${escaped}"` — escaped 只转双引号和换行
- L516 `git log ${format} -n ${count}` — count 是 number 还好
- L297 `git rev-parse --abbrev-ref HEAD` 之类 — 静态

**修复方向**：
1. **强制走参数化数组**：`execFileSync('git', ['add', ...files], { cwd })` 取代 `execSync(\`git add ${...}\`)`
2. 对 commit message：参数化为 `execFileSync('git', ['commit', '-m', message])`
3. 对 file path：参数化传数组
4. 保留 `execSync` 的只用于完全静态的（`git rev-parse --abbrev-ref HEAD` 之类）
**Acceptance**：写一个测试，故意传 `"; rm -rf /"`，验证 git 命令被原样当作文件名处理而不被执行。

---

## 3. P1 — v1.1.0 核心改进（2-3 周）

### T05. 文档与代码同步
**问题清单**：
- `README.md` vs `CODEBUDDY.md`：
  - README 删了 `packages/pi-driver`（housekeeping），CODEBUDDY.md L22, L48 还在引用
  - README 写"in-process `AgentSession` per workspace"，CODEBUDDY.md L60 写"每次 prompt 独立 spawn 进程"（M1 前）
  - README `engines` 写 `>= 22.19.0`，`package.json` 写 `>= 18.0.0`
- `CHANGELOG.md`：`[Unreleased] — M1 through M5 in progress` 段过时（v0.1.0 已发）
- README 致谢 `Mavis Code` 链到 `mavis.local`（死链）
- README 没有挂截图（仓库有 `screenshot.png`、`screenshot-v2.png`）

**动作**：
1. **删除 `CODEBUDDY.md`**——它是给"老版 M1 之前架构"用的，已经误导性 > 价值
2. 以 README 为唯一事实来源（Source of Truth）
3. 修 `package.json` `engines` → `>= 22.19.0`
4. 修 `CHANGELOG.md`：把 M1–M5 从 Unreleased 段移到 `[0.1.0]`，新建 `[Unreleased] — 1.0.1 hotfix`
5. 删 README 致谢里"灵感来自 Mavis Code"那行（`mavis.local` 死链）
6. 挂上 2 张截图到 README"Features"区
**Acceptance**：`grep -r "pi-driver" --include="*.md"` 0 结果；`pnpm pkg get engines.node` = `>=22.19.0`。

### T06. messaging/gateway 产品决策
**现状**：`apps/desktop/src/main/messaging/{gateway.ts, types.ts, adapters/{feishu,qq,wechat}.ts}` + 渲染层 `GatewayPanel/`。
**问题**：跟"AI coding agent 桌面 GUI"主线偏。
**三个选项**：

| 选项 | 描述 | 工作量 | 风险 |
|---|---|---|---|
| **A. 砍掉** | v1.1 删除整个 messaging/ + GatewayPanel + 7 个 IPC handler | 1 天 | 砍掉未来可能加回来的功能 |
| **B. 隔离到 feature flag** | 保留代码但默认关闭，隐藏在 settings | 0.5 天 | 维护负担 |
| **C. 立项做成 v2.0 主线** | 把"统一 AI 收件箱"做成 v2.0 大版本 | 4-6 周 | 偏离 v1.0 修复节奏 |

**建议**：先选 **B（feature flag 隐藏）** 留 1-2 周观察，看用户反馈再决定 v2.0 走向。

### T07. e2e 测试框架（Playwright for Electron）
**现状**：根目录散落 `test-app.ps1`、`test-electron-flow.js`、`test-pi-spawn.js`、`test-full-flow.js`，CI 0 引用。
**目标**：
1. 引入 `@playwright/test` + `playwright`（Electron support）
2. 删掉所有 `.ps1` / `.js` 测试脚本
3. 建 `apps/desktop/e2e/`：
   - `launch.spec.ts`：冷启动 → 显示窗口
   - `chat-happy-path.spec.ts`：mock Pi → 发消息 → 看流式输出
   - `approval-flow.spec.ts`：HIGH_RISK bash → 弹模态 → 拒绝 → abort
   - `terminal.spec.ts`：建 tab → 输入命令 → 看输出
4. CI 跑：`e2e` 单独的 job，只在 PR + nightly
**Acceptance**：4 个 spec 全绿；`pnpm e2e` 一键跑；PR 上 e2e 失败阻断 merge。

### T08. 代码签名与 SmartScreen 体验
**现状**：v0.1.0 NSIS 101MB，无签名，SmartScreen 拦截。
**三阶段**：
1. **v1.0.1**：README + first-run UI 写明"未签名如何放行"（截图步骤），降低用户挫败感
2. **v1.1.0**：
   - 申请 EV 或 OV 代码签名证书（Azure Trusted Signing 较便宜，~$10/月）
   - `electron-builder.yml` 配 `signtoolOptions` 或 `azureSignTool`
   - 加 `publisherName` 到 NSIS metadata
3. **v1.2.0**：HASH 文件上 VirusTotal 自审 + 加 SHA256 校验指南
**Acceptance**：干净 Win11 上双击 installer 不弹 SmartScreen 红屏（弹黄窗可以接受）。

### T09. 安全审查
参考 `security-review` skill 跑一次系统化走查。聚焦：
1. **`contextBridge` 白名单审计**（`preload/index.ts`）：当前 50+ 方法全开放，需要重新审计每个 IPC handler
2. **IPC 参数校验**：
   - 几乎所有 `ipcMain.handle` 都没有 schema 校验
   - 引入 `zod` 或 `@electron-toolkit/typed-ipc`
   - 给每个 handler 加 runtime schema check
3. **classifier 加固**（`approval/classifier.ts`）：
   - 加单元测试覆盖：边界 case（`echo rm -rf /`、`sudo --user root`、反引号、PowerShell）
   - 加 5+ 新 pattern（`sc delete`、`bcdedit`、`net user`、PowerShell `Invoke-Expression`、`Stop-Process -Force`）
   - 加 false-positive 监控：用户拒绝时记录，半年 review
4. **renderer CSP**：`index.html` 加 `<meta http-equiv="Content-Security-Policy">`，禁 inline script/eval
5. **secret 处理**：`AppSettings.apiKey` 默认 `''` 暴露在 store — 改为标记 `hasApiKey: boolean`，明文不入 store
6. **sandbox: false** 评估：是否真的需要？若仅 node-pty 必须 native，主进程独占 node-pty 也可，renderer 不需要 node 集成。建议改成 `sandbox: true` + preload 内做 native 桥

**Acceptance**：security-review skill 输出 PASS；`preload` 暴露的方法数从 50+ 砍到 30 以内；`pnpm audit` 0 high。

---

## 4. P2 — v1.2.0 质量提升（4-6 周）

### T10. 性能优化
- **冷启动**：当前未测。需要 baseline + 优化
  - 拆 `loadPiAgentConfig`（同步 IO）到 `app.whenReady` 之后异步
  - `js-yaml` 替代手写 parser（启动时 models.yml 解析时间减半）
- **文件扫描**（M2 `file-scanner.ts`）：用 chokidar 替代 `readdirSync` 递归；加 worker_threads 防 UI 卡顿
- **长会话内存**：Pi session 长时间累积，需要 LRU 限制 in-memory event buffer（`event-bridge.ts`）
- **xterm 性能**：多 tab 终端 + 大量输出时的渲染卡顿，加 backpressure

### T11. 可观测性
- 引入 `electron-log`（已在 deps 里但没用上）替代 `console.log`
- 加 `ErrorBoundary` 上报（已有组件，需要接 Sentry/PostHog）
- 加启动 metrics：cold start、first paint、chat 首次响应时间
- `pi-session` 加 trace id：每条 prompt 串起 `registry.get → prompt → bridge.handleEvent → renderer`

### T12. 可访问性 / i18n / DX
- **a11y**：
  - ChatView 全部交互加 `aria-label` / `aria-live`
  - CommandPalette 焦点环可见
  - ApprovalModal 加 keyboard trap + Escape
  - 颜色对比度 ≥ 4.5:1（用 `@axe-core/playwright` 在 e2e 里跑）
- **i18n**：
  - 用 `i18next` + `react-i18next`
  - 抽中文字符串到 `locales/zh-CN.json` / `en-US.json`
  - 工具类（classifier 日志）保留英文（dev 用）
- **DX**：
  - `electron-vite` HMR 配 Vite 6 + React 19 完整
  - 启动脚本报错信息更友好（检测到 Pi 没装时给带链接的引导）
  - `pnpm dev` 一步走通（先 build packages 再启 electron-vite）
  - 加 `apps/desktop/scripts/dev-check.ts`：检查 Node 版本、Pi CLI、SkillHub、git，给出缺失项清单

---

## 5. 立即可执行（今天/明天动手）

无依赖、可独立 PR：

- [ ] T02. 修 5 处 TS 错误（半天）
- [ ] T04. Git 命令参数化（半天，5 处）
- [ ] T01. 删 CI `continue-on-error`（5 分钟，但要先确保 T02 跑通）
- [ ] T03. Chat IPC 订阅泄漏（半天）
- [ ] T05. 删 `CODEBUDDY.md` + 修 `package.json` `engines`（5 分钟）
- [ ] T06 决策点：messaging/gateway 去留（今天定）

---

## 6. 时间线（单人 6-8 周 / 双人 3-4 周）

```
Week 1  ┃████ T01-T04 (P0 hotfix)         ┃ v1.0.1 发布
Week 2  ┃████ T05-T09 (P1 启动)            ┃
Week 3  ┃████████████ T07 (e2e) T08 (签名)  ┃
Week 4  ┃████████ T09 (security)            ┃ v1.1.0 发布
Week 5  ┃████████ T10 (性能) T11 (可观测)   ┃
Week 6  ┃████████ T12 (a11y/i18n/DX)        ┃
Week 7  ┃████ 缓冲 / e2e 完善               ┃ v1.2.0 发布
Week 8  ┃████ 缓冲 / 用户反馈处理           ┃
```

---

## 7. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 订阅泄漏已导致线上用户数据丢失 | 中 | 高 | T03 + 加 Sentry 监测 listener count |
| 代码签名申请被拒（公司资质） | 中 | 中 | 先做 v1.0.1 first-run 引导兜底 |
| messaging/gateway 砍掉引发用户投诉 | 低 | 中 | T06 选 B（feature flag 隐藏）观察 |
| Playwright for Electron 与 Electron 34 兼容问题 | 中 | 中 | 锁版本 + nightly 跑，备用 Spectron 路线 |
| 安全审查发现重大问题导致紧急 hotfix | 低 | 极高 | 预留 hotfix 通道 + auto-update 灰度 |

---

## 8. 度量指标（怎么算"优化好了"）

- CI 绿率：100% PR 必跑 lint + typecheck + test + build
- 冷启动：< 2s（v1.2.0 目标）
- 首字节时间（prompt → 第一个 token）：< 500ms
- 内存占用（idle, 单 workspace）：< 400MB
- a11y 评分：axe 0 violations
- 单元测试覆盖率：service 层 ≥ 80%
- e2e 覆盖：核心 4 流程（启动、对话、审批、终端）100%
- 安全审计：高危问题 0

---

## 9. 待用户决策（不动手，先对齐）

1. **T06 messaging/gateway**：A 砍 / B 隐藏 / C 立项
2. **代码签名预算**：是否申请 Azure Trusted Signing（~$10/月）？还是用自签名 + 引导？
3. **v1.1 路线**：是先做 macOS/Linux 跨平台，还是先做 P1 这五项？
4. **是否接受 mavis-team 拆分执行**：P0 已经够独立可并行；要不要让 worker session 分头干

---

> 路线图版本：v1 · 维护者：Pi Desktop contributors
> 下次评审：P0 完成后 / 每月一次

---

## 10. E2E 阻塞说明（2026-06-01，e2e-framework 任务）

**状态**：Playwright 框架已落地（`apps/desktop/playwright.config.ts` + `apps/desktop/e2e/launch.spec.ts` + 根 `package.json` 装上 `@playwright/test@1.60` + `playwright@1.60`），但**实际 spec 无法跑通**。

**根因（不可在 30 分钟切片内修复）**：

`@earendil-works/pi-coding-agent@0.75.5` 这个依赖在启动时同时撞两条互不兼容的硬约束：

1. **包是 ESM-only**：`package.json` 的 `exports` map 只有 `import` 条件，没有 `require` 条件。
   Electron 34 的主进程以 CommonJS 跑，`require("@earendil-works/pi-coding-agent")` 直接抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`。
2. **包硬依赖 `node:sqlite` 内建模块**：这是 Node.js 22.5+ 引入的 builtin。
   Electron 34 自带 Node 20.x，没有这个模块。即使把包 bundle 进主进程让 `require()` 拿到东西，
   包内部的 `require("node:sqlite")` 仍然抛 `ERR_UNKNOWN_BUILTIN_MODULE`。

两条任一都会让主进程在 `app.whenReady` 之前就挂掉，Playwright 起窗口时 `firstWindow()` 永远不 resolve，spec 超时失败。

**已尝试的 workaround**（保留为诊断历史）：

- 把 `@earendil-works/pi-coding-agent` 加进 `externalizeDepsPlugin.exclude` 让 vite 把它 bundle 进主进程 chunk
  → 解决 (1)，但暴露 (2)，`node:sqlite` require 仍然失败，主进程依然 crash
- pnpm patch（不可持久，install 时被还原，已被排除）
- 改 `factory.ts` 用 dynamic `import()`（超出本任务允许的改动范围）

**v1.1 解锁路径**（任选其一）：

| 选项 | 描述 | 风险 |
|---|---|---|
| **A. Electron 升级到 35+** | Electron 35 自带 Node 22.x，暴露 `node:sqlite`。最小成本、向后兼容。 | 需要重测 native 依赖（node-pty、sharp、electron-store）；CI 镜像需同步 |
| **B. 降 pi-coding-agent 到 0.74.x** | 找不带 sqlite 的旧版（如果有）。 | 该包可能根本不向后兼容到 0.74 |
| **C. 引入 polyfill / 替代存储** | 用 `better-sqlite3` 注入 process 顶替 `node:sqlite`。 | 维护负担，且 e2e 仍可能因其他 22+ builtin 失败 |

**推荐**：选 **A（Electron 35+）**，顺带把 `engines.node` 收紧到 `>=22.5.0`，在 PR 标题里加 `[breaking] electron-35-bump`。

**v1.0.x 期间的临时方案**：

- e2e spec 暂不纳入 CI 必跑门禁
- `pnpm e2e` 命令保留但标记为"已知失败"
- 关键回归继续靠 `pnpm -r test`（vitest 130+ 测）+ 手动 smoke 验证
- 待 v1.1 bump Electron 后，spec 解锁，4 个核心 spec（launch / chat-happy-path / approval-flow / terminal）一次性补齐

**关联 commit**：（提交后填入本节 e2e-framework 的 commit hash）

---

## 11. 进度更新（2026-06-02）

### v1.0.1 — P0 hotfix（已发）
- 修了 T01-T04 全部：CI 放水、TS 编译错、Chat IPC 泄漏、git 命令注入
- master: `3cebfee` + `99dda33`

### v1.0.2 — P1 cycle 1（已发，tag 在 origin）
- 3 模块已收：security (zod IPC 校验) + observability (electron-log + ErrorBoundary) + perf (drive-by)
- 1 模块部分收：e2e 框架（d951db0），实际 spec 跑分受 Electron 34 + node:sqlite 阻塞，留给 v1.1
- 顺带：删 IM 桥（messaging/gateway T06 = 砍）、CI 恢复 lint gate
- master: `d1e0b7e`，tag `v1.0.2`

### v1.0.3 — 可用度 P1 cycle 1+2（已合 master，未发 tag / 未推 origin）
- **可用度-D**：首启引导（3 步 wizard + localStorage 兜底）+ 空状态/加载/错误状态统一（ProjectPanel/MySkills/TerminalPanel + ChatView "立即安装" CTA + 3 处 IPC 重试）。commit `9ecb11d`
- **可用度-A**：a11y 基线（IconBar/ChatView/MessageBubble/ChatInput/AttachmentChip/CommandPalette/Settings/ApprovalPanel/SkillsPanel/App.tsx 9 组件 + globals.css focus-visible + e2e a11y.spec.ts + JSDOM a11y-baseline 4/4 PASS）
- **可用度-C**：快捷键中心（registry.ts 中央注册表 8 entry + useShortcuts.ts + ShortcutsCheatsheet "?" 速查面板 + Tooltip + IconBar tooltip wiring）
- A+C 因为两个任务都改 App.tsx/IconBar/CommandPalette，shared worktree 撞车，合并到一次 commit
- commit `d3a3b84`
- 验证：typecheck ✓ lint ✓ 24 test files / 181 tests PASS (2 skipped, 4 个之前失败的全修)

### 经验记录（写入 agent memory）
- 并行 producer 任务共享文件（App.tsx/IconBar/CommandPalette）会在 main worktree 撞车，30min hard cap 触发后没法安全 retry。下次拆分时按文件边界分，每个 task 明确禁止改共享文件。
- a11y 类任务范围要小（5 组件 + axe-core spec），上次塞了 9 组件 + axe-core + focus-visible + 4 test files，30min 装不下。

## 12. v1.0.4 — i18n 基建（进行中）

**目标**：让 Pi Desktop 支持中英双语切换，铺好未来更多语言的基建。

**scope**：
1. 接入 i18next + react-i18next + i18next-browser-languagedetector
2. `I18nProvider` + locale 检测（`navigator.language` + localStorage 兜底）
3. 抽取所有硬编码中文字符串到 `en.json` + `zh-CN.json`（Onboarding 3 步 + a11y 标签 + Tooltip + ShortcutsCheatsheet 8 条 + empty states + error 提示 + ChatView "立即安装" CTA）
4. Settings 加语言切换器（zh-CN ↔ en-US）
5. 测试：I18nProvider、locale 切换、missing key fallback

**不做**：
- 不做 RTL / 阿拉伯文（暂无需求）
- 不做 ICU 复数（v1 字符串没复数）
- 不动主进程（locale 只在 renderer 层处理）

**预期**：
- 单 commit `feat(i18n-foundation): i18n infrastructure + zh-CN/en-US bilingual extraction`
- 验证：typecheck ✓ lint ✓ 新增 3-5 个测试文件 / 10-15 个测试
- 预计耗时：~60-90 分钟

## 13. v1.1+ — 跨平台 + Electron 35 bump（待 v1.0.4 后启动）
- Electron 35+：解 e2e node:sqlite 阻塞
- macOS 跨平台：DMG 配置 + 代码签名（Apple Developer ID $99/yr 待申请）
- 决策点：用户说"先不发布"，所以暂缓，等 v1.0.4 + 用户反馈后再排期


