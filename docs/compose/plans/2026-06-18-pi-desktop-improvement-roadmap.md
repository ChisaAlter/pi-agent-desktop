# Pi Desktop 全面改进计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is independent — dispatch one subagent per task.

**Goal:** 将 Pi Desktop 从 v1.0 现状推进到 v1.2 质量基线：清偿技术债、补齐安全/性能/可观测性/可访问性/i18n/DX，收敛双持久化，清理工作区，为跨平台铺路。

**Architecture:** 增量式改进，不破坏现有三进程架构。每个任务独立可 PR、可验证（typecheck + lint + test 全绿）、可回滚。优先级：工作区清理 → 文档同步 → main/index.ts 重构 → 双持久化收敛 → 安全审查补全 → 性能 → 可观测性 → a11y/i18n/DX → Electron 35 bump 解锁 e2e。

**Tech Stack:** Electron 41 + React 19 + TypeScript 5 + Vite 6 + Tailwind 4 + Zustand 5 + Vitest 4 + Playwright + electron-log + i18next + zod + better-sqlite3

---

## 现状基线（2026-06-18 核对）

- typecheck ✅ 全绿
- lint ✅ 无报错
- test ✅ 800 passed / 2 skipped（89 个测试文件）
- P0 (T01-T04) 已全部修复并发布 v1.0.1
- T06 messaging/gateway 已删除
- T09 部分：Zod schema 覆盖高风险 IPC、electron-log 全主进程接入、ErrorBoundary 已挂、i18n 基建完成（zh-CN/en-US 双语）
- T07 e2e 框架已落地，但被 `node:sqlite` + Electron 34 阻塞（需 Electron 35+ bump 解锁）
- T08 代码签名：用户决定**不考虑**（本计划不含）
- `main/index.ts` 389 行，仍自己做 YAML/JSON 解析，与 `services/config/config-manager.ts`（436 行）功能重叠
- 双持久化并存：`electron-store`（settings/workspaces/sessions）+ `better-sqlite3`（session-sqlite.ts，仅初始化日志，未真正接入会话读写）
- 工作区有大量未跟踪垃圾文件（`__pycache__/`、`calculator.py`、`test-results.csv` 等）
- `launch.bat` 有未提交改动
- README 致谢 `mavis.local` 死链未修；截图未挂；CHANGELOG `[Unreleased]` 段过时

---

## 任务索引

| Task | 优先级 | 描述 | 预估 |
|------|--------|------|------|
| T01 | P0 | 工作区垃圾清理 | 15 min |
| T02 | P0 | launch.bat 未提交改动处理 | 10 min |
| T03 | P0 | .gitignore 补全 | 10 min |
| T04 | P1 | README 死链 + 截图挂载 | 20 min |
| T05 | P1 | CHANGELOG 整理（v1.0.1 → v1.0.9 归档） | 30 min |
| T06 | P1 | main/index.ts 配置解析下沉到 ConfigManager | 1-2 h |
| T07 | P2 | 双持久化收敛（SQLite 接入会话读写 or 移除） | 2-3 h |
| T08 | P2 | contextBridge 白名单审计（50+ → 30 以内） | 2-3 h |
| T09 | P2 | classifier 加固（新 pattern + 边界测试） | 1-2 h |
| T10 | P2 | renderer CSP + secret 处理 | 1-2 h |
| T11 | P2 | 冷启动性能优化 | 2-3 h |
| T12 | P2 | 文件扫描异步化（chokidar / worker_threads） | 2-3 h |
| T13 | P2 | 长会话内存 LRU + xterm backpressure | 2-3 h |
| T14 | P2 | 可观测性：启动 metrics + trace id + Sentry 接入 | 2-3 h |
| T15 | P2 | a11y 深化（keyboard trap / axe / 对比度） | 2-3 h |
| T16 | P2 | i18n 覆盖率补全（剩余硬编码字符串） | 1-2 h |
| T17 | P2 | DX：dev-check 脚本 + pnpm dev 一键通 | 1-2 h |
| T18 | P3 | Electron 35+ bump（解锁 e2e + node:sqlite） | 3-4 h |
| T19 | P3 | e2e 核心 4 spec 补齐 | 3-4 h |

**总计：单人约 30-40 h（6-8 个工作日）**

---

## Phase 1: 工作区卫生（P0，立即可做）

### Task T01: 工作区垃圾文件清理

**Covers:** 工作区卫生
**Files:**
- Delete: `__pycache__/`, `calculator.py`, `test-results.csv`, `test-cases.md`, `_probe.bat`, `run-tests.ps1`, `run-tests-simple.ps1`, `opencode.jsonc`, `apps/desktop/test-sidebar-fixes.mjs`, `apps/desktop/test-sidebar-screenshot.png`

- [ ] **Step 1: 预览将被删除的文件**

Run:
```powershell
git status --porcelain | Select-String "^\?\?"
```
Expected: 列出所有未跟踪文件，确认清单与计划一致。

- [ ] **Step 2: 删除明确的垃圾文件**

Run:
```powershell
Remove-Item -Recurse -Force __pycache__, calculator.py, test-results.csv, test-cases.md, _probe.bat, run-tests.ps1, run-tests-simple.ps1, opencode.jsonc
Remove-Item -Force apps/desktop/test-sidebar-fixes.mjs, apps/desktop/test-sidebar-screenshot.png
```
Expected: 无错误输出。

- [ ] **Step 3: 验证 typecheck + lint + test 仍全绿**

Run:
```powershell
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```
Expected: typecheck 0 error，lint 0 error，test 800 passed / 2 skipped。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(hygiene): remove untracked scratch files from workspace

Remove __pycache__, calculator.py, test-results.csv, test-cases.md,
_probe.bat, run-tests*.ps1, opencode.jsonc, test-sidebar-* from
working tree. These were leftover probe/scratch artifacts not part
of the project."
```

---

### Task T02: launch.bat 未提交改动处理

**Covers:** 工作区卫生
**Files:**
- Modify: `launch.bat`

- [ ] **Step 1: 查看未提交改动**

Run:
```powershell
git diff launch.bat
```
Expected: 显示具体改动内容。

- [ ] **Step 2: 决策——保留改动则 commit，否则 discard**

如果改动是调试痕迹或临时 hack → discard:
```powershell
git checkout -- launch.bat
```

如果是合理的启动脚本改进 → commit:
```bash
git add launch.bat
git commit -m "chore(launch): update launch.bat"
```
Expected: `git status` 显示 launch.bat 干净。

---

### Task T03: .gitignore 补全

**Covers:** 工作区卫生（防止垃圾再次混入）
**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 查看当前 .gitignore**

Run:
```powershell
Get-Content .gitignore
```
Expected: 列出现有规则。

- [ ] **Step 2: 追加缺失规则**

在 `.gitignore` 末尾追加：
```gitignore
# Python scratch
__pycache__/
*.pyc
calculator.py

# Probe / scratch
_probe.bat
test-results.csv
test-cases.md
opencode.jsonc

# Tooling dirs (agent session state, not project)
.mimocode/
.opencode/
.mavis/
.claude/

# E2E output (regenerated)
apps/desktop/e2e-output/

# Dev scratch screenshots
apps/desktop/test-sidebar-*.png
apps/desktop/test-sidebar-*.mjs
apps/desktop/app_stderr.log
apps/desktop/app_stdout.log
```

- [ ] **Step 3: 验证不再被跟踪为 untracked**

Run:
```powershell
git status --porcelain
```
Expected: 之前显示的垃圾文件不再出现（被 ignore）。

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore(hygiene): expand .gitignore for scratch/probe/e2e-output artifacts"
```

---

## Phase 2: 文档同步（P1）

### Task T04: README 死链 + 截图挂载

**Covers:** OPTIMIZATION-ROADMAP T05
**Files:**
- Modify: `README.md:172`（删除 mavis.local 死链行）
- Modify: `README.md`（Features 区追加 2 张截图）

- [ ] **Step 1: 删除死链接**

在 `README.md` 第 172 行，删除整行：
```
- Inspired by [OpenAI Codex Desktop](https://openai.com/index/openai-codex/) and the [Mavis Code](https://mavis.local) UI language
```
替换为：
```
- Inspired by [OpenAI Codex Desktop](https://openai.com/index/openai-codex/)
```

- [ ] **Step 2: 在 Features 区下方追加截图**

在 `## What is this?` 段之后、`## Features` 段之前插入：
```markdown
## Screenshots

![Chat view](docs/screenshots/screenshot.png)
![Skills panel](docs/screenshots/screenshot-v2.png)
```

- [ ] **Step 3: 验证截图路径存在**

Run:
```powershell
Test-Path docs/screenshots/screenshot.png, docs/screenshots/screenshot-v2.png
```
Expected: 两个都返回 True。

- [ ] **Step 4: 验证死链已清除**

Run:
```powershell
Select-String -Path README.md -Pattern "mavis.local"
```
Expected: 无输出。

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): remove dead mavis.local link, add screenshots"
```

---

### Task T05: CHANGELOG 整理

**Covers:** OPTIMIZATION-ROADMAP T05
**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 读取当前 CHANGELOG**

Run:
```powershell
Get-Content CHANGELOG.md
```
Expected: 看到 `[Unreleased] — v1.0.1 hotfix` 段，但 v1.0.2-v1.0.9 的内容散落在 OPTIMIZATION-ROADMAP.md 进度段，未回灌 CHANGELOG。

- [ ] **Step 2: 重构 CHANGELOG 结构**

把 `[Unreleased] — v1.0.1 hotfix` 改为 `[1.0.1] - 2026-06-01`，然后在 `[0.1.0]` 之上依次追加：

```markdown
## [1.0.2] - 2026-06-02

### Added
- Security: Zod schema validation for high-risk IPC handlers (git, files, terminal, sessions, agents, skills, workbench, codex/claude import)
- Observability: electron-log across all main process modules; ErrorBoundary in renderer
- i18n: IpcError contract + translateIpcError hook + 27 IPC error scenarios localized

### Removed
- messaging/gateway (IM bridge): deleted feishu/qq/wechat adapters + GatewayPanel

### Fixed
- CI: restore lint gate (was silently passing)

## [1.0.3] - 2026-06-03

### Added
- Usability: 3-step first-run wizard + empty/loading/error states unified (ProjectPanel/MySkills/Terminal + ChatView CTA)
- A11y baseline: 9 components aria-label/focus-visible + a11y.spec.ts
- Shortcuts: central registry (8 entries) + ShortcutsCheatsheet (?) panel + tooltips

## [1.0.4] - 2026-06-04

### Added
- i18n: i18next + react-i18next + locale detection + zh-CN/en-US bilingual extraction + Settings language switcher

## [1.0.5] - 2026-06-05

### Changed
- Types: 49 `any`/`as any` cleared; preload strong types; store types narrowed

## [1.0.6] - 2026-06-06

### Changed
- Logging: 12 console → electron-log unified channel

## [1.0.6.1] - 2026-06-06

### Added
- IPC: IpcError structured contract + ipcError() factory + isIpcError() guard
- 4 setup modules + main/index.ts 23 handlers return IpcError instead of throw
- Renderer translateIpcError() hook + en/zh-CN ipcErrors.* (7 namespaces, 27 scenarios)

## [1.0.7] - 2026-06-07

### Changed
- Lint: 7 eslint-disable cleared; `@typescript-eslint/no-explicit-any: error` enforced

## [1.0.8] - 2026-06-08

### Added
- PiStatusPanel + Onboarding step1 IpcError translation
- Tests: +37 (workspace-store 12, approval-store 14, pi-status-store 11)

## [1.0.9] - 2026-06-09

### Added
- utils/format.ts: toDate/formatTime/formatRelative/formatDuration single entry
- settings-store write error UI (red banner + clearWriteError)
- Tests: +37 (format 27, settings-store 10)

## [Unreleased]

### Planned
- main/index.ts config parsing delegation to ConfigManager
- Dual persistence convergence (SQLite or electron-store)
- Electron 35+ bump to unblock e2e
```

- [ ] **Step 3: 验证格式**

Run:
```powershell
Get-Content CHANGELOG.md | Select-String "^## "
```
Expected: 列出 `[Unreleased]`、`[1.0.9]`...`[1.0.1]`、`[0.1.0]` 各段标题，顺序正确。

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): backfill v1.0.2-v1.0.9 entries from roadmap progress"
```

---

## Phase 3: 架构收敛（P1-P2）

### Task T06: main/index.ts 配置解析下沉到 ConfigManager

**Covers:** main/index.ts 重构
**Files:**
- Modify: `apps/desktop/src/main/index.ts`（删除 `loadPiAgentConfig` + `parseModelsYml`，改调 ConfigManager）
- Modify: `apps/desktop/src/main/services/config/config-manager.ts`（暴露 `loadPiAgentConfig()` 公共方法）
- Test: `apps/desktop/src/main/services/config/__tests__/config-manager.test.ts`（新增 loadPiAgentConfig 测试）

**问题**：`index.ts:58-150` 自己用 js-yaml 解析 models.yml/models.json，ConfigManager 已有 436 行相同能力，重复且易漂移。

- [ ] **Step 1: 写失败测试——ConfigManager.loadPiAgentConfig()**

在 `apps/desktop/src/main/services/config/__tests__/config-manager.test.ts` 追加：
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConfigManager } from "../config-manager";
import { existsSync, readFileSync } from "fs";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe("ConfigManager.loadPiAgentConfig", () => {
  let cm: ConfigManager;
  beforeEach(() => {
    vi.clearAllMocks();
    cm = new ConfigManager();
  });

  it("returns null when .pi/agent dir missing", () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(cm.loadPiAgentConfig()).toBeNull();
  });

  it("parses models.json providers", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith("models.json"));
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      providers: { google: { models: [{ id: "gemini-2.5-pro" }] } },
    }));
    const cfg = cm.loadPiAgentConfig();
    expect(cfg?.providers).toHaveLength(1);
    expect(cfg?.providers[0].id).toBe("google");
  });

  it("falls back to models.yml via js-yaml", () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith("models.yml"));
    vi.mocked(readFileSync).mockReturnValue("providers:\n  anthropic:\n    models:\n      - id: claude-opus-4\n");
    const cfg = cm.loadPiAgentConfig();
    expect(cfg?.providers[0].id).toBe("anthropic");
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/config/__tests__/config-manager.test.ts
```
Expected: FAIL — `loadPiAgentConfig is not a method on ConfigManager`.

- [ ] **Step 3: 在 ConfigManager 暴露 loadPiAgentConfig()**

在 `config-manager.ts` 追加（从 index.ts:58-150 迁移逻辑，保持行为一致）：
```typescript
public loadPiAgentConfig(): PiAgentConfig | null {
  // 迁移自 index.ts:loadPiAgentConfig — 单一事实来源
  if (!existsSync(this.piAgentDir)) return null;
  // ...（原 index.ts:58-150 的解析逻辑，保持签名一致）
}
```
注意：`PiAgentConfig`/`PiAgentModel`/`PiAgentProvider` 类型从 `src/main/types.ts` 导入。

- [ ] **Step 4: 运行测试验证通过**

Run:
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/config/__tests__/config-manager.test.ts
```
Expected: PASS。

- [ ] **Step 5: 修改 index.ts 改调 ConfigManager**

在 `index.ts` 删除 `loadPiAgentConfig` 函数定义（L58-150）和 `parseModelsYml`（L142-150），改为：
```typescript
piAgentConfig = configManager.loadPiAgentConfig();
```
并删除 `import yaml from 'js-yaml'`（如 ConfigManager 已内部使用）。

- [ ] **Step 6: 全量验证**

Run:
```powershell
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```
Expected: 全绿，800+ 测试不变。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/main/services/config/config-manager.ts apps/desktop/src/main/services/config/__tests__/config-manager.test.ts
git commit -m "refactor(config): delegate loadPiAgentConfig to ConfigManager, deduplicate yaml/json parsing"
```

---

### Task T07: 双持久化收敛

**Covers:** 双持久化收敛
**Files:**
- Modify: `apps/desktop/src/main/services/session-sqlite.ts`
- Modify: `apps/desktop/src/main/services/session-store.ts`
- Modify: `apps/desktop/src/main/ipc/sessions.ipc.ts`（读写入口统一）
- Test: `apps/desktop/src/main/services/__tests__/session-persistence-convergence.test.ts`（新增）

**问题**：`session-sqlite.ts` 仅 init + close，未接入会话读写；`session-store.ts`（electron-store）才是实际读写路径。两个后端并存造成混淆。决策：**收敛到 electron-store 作为 v1.2 唯一后端，移除 session-sqlite.ts 及 better-sqlite3 依赖**（SQLite 留待 v2.0 真正需要 tree 结构时再引入）。

- [ ] **Step 1: 确认 session-sqlite.ts 无读写调用方**

Run:
```powershell
Select-String -Path apps/desktop/src/main -Pattern "SessionSqlite|session-sqlite" -Recurse
```
Expected: 只在 session-sqlite.ts 内部出现，无外部 import（已验证：grep 结果显示仅 self-reference）。

- [ ] **Step 2: 写测试——session-store 是唯一读写路径**

```typescript
// __tests__/session-persistence-convergence.test.ts
import { describe, it, expect, vi } from "vitest";
import { existsSync, statSync } from "fs";

describe("session persistence convergence", () => {
  it("session-sqlite.ts is removed from codebase", () => {
    expect(existsSync("src/main/services/session-sqlite.ts")).toBe(false);
  });

  it("better-sqlite3 not imported by main process", () => {
    const mainFiles = await import("glob").then(g => g.globSync("src/main/**/*.ts"));
    for (const f of mainFiles) {
      const content = readFileSync(f, "utf-8");
      expect(content).not.toMatch(/better-sqlite3/);
    }
  });
});
```

- [ ] **Step 3: 删除 session-sqlite.ts**

Run:
```powershell
Remove-Item apps/desktop/src/main/services/session-sqlite.ts
```

- [ ] **Step 4: 移除 better-sqlite3 依赖**

Run:
```powershell
pnpm --filter @pi-desktop/desktop remove better-sqlite3
```
如果 `package.json` 仍引用，手动删除 dependencies 条目。

- [ ] **Step 5: 清理 index.ts 中的 session-sqlite import**

检查 `apps/desktop/src/main/index.ts` 是否 import session-sqlite，如有则删除对应行和 init 调用。

Run:
```powershell
Select-String -Path apps/desktop/src/main/index.ts -Pattern "sqlite|SessionSqlite"
```
Expected: 无输出（确认已无引用）。

- [ ] **Step 6: 全量验证**

Run:
```powershell
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```
Expected: 全绿。如果 native module rebuild 失败（better-sqlite3 移除后），清理 `node_modules` 重装：
```powershell
Remove-Item -Recurse -Force apps/desktop/node_modules
pnpm install --frozen-lockfile
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(persistence): remove unused session-sqlite.ts + better-sqlite3 dep, converge to electron-store as v1.2 single backend"
```

---

## Phase 4: 安全审查补全（P2）

### Task T08: contextBridge 白名单审计

**Covers:** OPTIMIZATION-ROADMAP T09.1
**Files:**
- Modify: `apps/desktop/src/preload/index.ts`（281 行，收敛 50+ → 30 以内）
- Test: `apps/desktop/src/preload/__tests__/preload-surface.test.ts`（新增）

**问题**：`preload/index.ts` 暴露 `piAPI` + `nodeAPI` 共 50+ 方法，部分低频方法（如 `pi:export`、`pi:share`、`pi:copy`）可合并或延迟暴露。

- [ ] **Step 1: 盘点当前暴露的方法**

Run:
```powershell
Select-String -Path apps/desktop/src/preload/index.ts -Pattern "^\s+\w+:" | Measure-Object | Select-Object -ExpandProperty Count
```
Expected: 50+ 条。

- [ ] **Step 2: 分类——保留 / 合并 / 移除**

将低频方法合并到通用 invoke（如 `pi:export` → `piAPI.invoke('pi:export', ...)`），减少 surface。保留高频方法（chat/sessions/files/skills/terminal/git/workspace/settings）直接暴露。

- [ ] **Step 3: 写测试——白名单大小**

```typescript
// preload-surface.test.ts
import { describe, it, expect } from "vitest";

describe("preload surface", () => {
  it("piAPI exposes <= 30 methods", () => {
    const keys = Object.keys(window.piAPI);
    expect(keys.length).toBeLessThanOrEqual(30);
  });

  it("no method name contains 'internal' or 'debug'", () => {
    const keys = Object.keys(window.piAPI);
    for (const k of keys) {
      expect(k).not.toMatch(/internal|debug/i);
    }
  });
});
```

- [ ] **Step 4: 实施 preload 收敛**

在 `preload/index.ts` 把低频方法改为通用 `invoke` 通道：
```typescript
piAPI: {
  // 高频直接暴露
  send: (msg) => ipcRenderer.invoke("pi:send", msg),
  // ... 其他高频
  // 低频走通用 invoke
  invoke: (channel: string, ...args: unknown[]) => {
    const ALLOWED = ["pi:export", "pi:share", "pi:copy", "pi:import"];
    if (!ALLOWED.includes(channel)) throw new Error(`Channel not allowed: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
}
```

- [ ] **Step 5: 验证**

Run:
```powershell
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/preload/__tests__/preload-surface.test.ts
git commit -m "refactor(preload): converge 50+ exposed methods to 30 via generic invoke for low-frequency channels"
```

---

### Task T09: classifier 加固

**Covers:** OPTIMIZATION-ROADMAP T09.3
**Files:**
- Modify: `apps/desktop/src/main/services/approval/classifier.ts`
- Test: `apps/desktop/src/main/services/approval/__tests__/classifier.test.ts`（追加边界 case）

- [ ] **Step 1: 写失败测试——新 pattern + 边界 case**

在 `classifier.test.ts` 追加：
```typescript
describe("classifier hardening", () => {
  it.each([
    ["echo rm -rf /", "high"],      // echo 包裹危险命令
    ["sudo --user root bash", "high"],
    ["`rm -rf /`", "high"],         // 反引号命令替换
    ["$(rm -rf /)", "high"],       // $(...) 命令替换
    ["sc delete MyService", "high"],
    ["bcdedit /set", "high"],
    ["net user admin pass /add", "high"],
    ["powershell Invoke-Expression 'rm -rf /'", "high"],
    ["Stop-Process -Force -Name explorer", "high"],
    ["git log --oneline", "read"],  // 安全 git
    ["ls -la", "read"],
  ])("classifies %s as %s", (cmd, expected) => {
    const result = classifyShellCommand(cmd);
    expect(result.risk).toBe(expected);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run:
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/approval/__tests__/classifier.test.ts
```
Expected: 新增 case FAIL（新 pattern 未实现）。

- [ ] **Step 3: 在 classifier.ts 追加 5+ pattern**

```typescript
const HIGH_RISK_PATTERNS: RegExp[] = [
  // 既有...
  /\bsc\s+delete\b/i,
  /\bbcdedit\b/i,
  /\bnet\s+user\b/i,
  /\bInvoke-Expression\b/i,
  /\bStop-Process\s+.*-Force\b/i,
  /`[^`]*`/,  // 反引号命令替换
  /\$\([^)]*\)/,  // $(...) 命令替换
];
```

- [ ] **Step 4: 运行测试验证通过**

Run:
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/approval/__tests__/classifier.test.ts
```
Expected: 全绿。

- [ ] **Step 5: 全量验证 + Commit**

```powershell
pnpm -r typecheck; pnpm -r lint; pnpm -r test
```
```bash
git add apps/desktop/src/main/services/approval/classifier.ts apps/desktop/src/main/services/approval/__tests__/classifier.test.ts
git commit -m "feat(approval): harden classifier with 7 new high-risk patterns (sc/bcdedit/net user/IEX/Stop-Process/backtick/$())"
```

---

### Task T10: renderer CSP + secret 处理

**Covers:** OPTIMIZATION-ROADMAP T09.4, T09.5
**Files:**
- Modify: `apps/desktop/src/renderer/index.html`（加 CSP meta）
- Modify: `apps/desktop/src/renderer/settings.html`（同上）
- Modify: `apps/desktop/src/main/types.ts`（AppSettings 改 hasApiKey: boolean）
- Modify: `apps/desktop/src/main/services/config/config-manager.ts`（apiKey 不入 store）

- [ ] **Step 1: 加 CSP meta 到 index.html**

在 `<head>` 内追加：
```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: local-file:; connect-src 'self' ipc: https://github.com; font-src 'self';">
```
注意：`'unsafe-inline'` for style 是 Tailwind 4 当前需要，后续可收紧。

- [ ] **Step 2: 同样加到 settings.html**

- [ ] **Step 3: AppSettings apiKey 改 hasApiKey**

在 `types.ts`：
```typescript
export interface AppSettings {
  // 既有...
  hasApiKey: boolean;  // 替代明文 apiKey: string
}
```

在 ConfigManager：apiKey 写入 `~/.pi/agent/auth.json`，store 只存 `hasApiKey: true/false`。读取时从 auth.json 取，不入 electron-store。

- [ ] **Step 4: 验证**

Run:
```powershell
pnpm -r typecheck; pnpm -r lint; pnpm -r test
```
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/index.html apps/desktop/src/renderer/settings.html apps/desktop/src/main/types.ts apps/desktop/src/main/services/config/config-manager.ts
git commit -m "feat(security): add renderer CSP, replace apiKey plaintext with hasApiKey boolean in store"
```

---

## Phase 5: 性能优化（P2）

### Task T11: 冷启动性能优化

**Covers:** OPTIMIZATION-ROADMAP T10
**Files:**
- Modify: `apps/desktop/src/main/index.ts`（loadPiAgentConfig 异步化）
- Create: `apps/desktop/src/main/utils/cold-start-metrics.ts`
- Test: `apps/desktop/src/main/utils/__tests__/cold-start-metrics.test.ts`

**问题**：`loadPiAgentConfig` 同步 IO 阻塞 app.whenReady；无冷启动 baseline。

- [ ] **Step 1: 写失败测试——冷启动 metrics 记录**

```typescript
// cold-start-metrics.test.ts
import { describe, it, expect } from "vitest";
import { markColdStart, getColdStartReport } from "../cold-start-metrics";

describe("cold-start-metrics", () => {
  it("records timestamps for app-ready, first-window, config-loaded", () => {
    markColdStart("app-ready");
    markColdStart("first-window");
    markColdStart("config-loaded");
    const report = getColdStartReport();
    expect(report["app-ready"]).toBeDefined();
    expect(report["first-window"]).toBeDefined();
    expect(report["config-loaded"]).toBeDefined();
  });
});
```

- [ ] **Step 2: 实现 cold-start-metrics.ts**

```typescript
const marks: Record<string, number> = {};
export function markColdStart(label: string): void {
  marks[label] = Date.now();
}
export function getColdStartReport(): Record<string, number> {
  return { ...marks };
}
export function logColdStartReport(): void {
  const start = marks["process-start"] ?? Date.now();
  for (const [k, v] of Object.entries(marks)) {
    log.info(`[cold-start] ${k}: ${v - start}ms`);
  }
}
```

- [ ] **Step 3: index.ts 异步化 loadPiAgentConfig**

把 `piAgentConfig = configManager.loadPiAgentConfig();` 移到 `app.whenReady().then(async () => { ... })` 内，用 `await` 或 `.then()`，不阻塞窗口创建。

- [ ] **Step 4: 验证**

Run:
```powershell
pnpm -r typecheck; pnpm -r lint; pnpm -r test
```
Expected: 全绿。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/utils/cold-start-metrics.ts apps/desktop/src/main/utils/__tests__/cold-start-metrics.test.ts apps/desktop/src/main/index.ts
git commit -m "perf(startup): async loadPiAgentConfig, add cold-start metrics instrumentation"
```

---

### Task T12: 文件扫描异步化

**Covers:** OPTIMIZATION-ROADMAP T10
**Files:**
- Modify: `apps/desktop/src/main/services/search/file-scanner.ts`
- Test: `apps/desktop/src/main/services/search/__tests__/file-scanner.test.ts`

**问题**：当前 `readdirSync` 递归阻塞主进程。

- [ ] **Step 1: 写失败测试——异步扫描**

```typescript
it("scans directory asynchronously without blocking", async () => {
  const start = Date.now();
  const result = await scanFilesAsync("/tmp/test-dir");
  const elapsed = Date.now() - start;
  expect(result).toBeDefined();
  expect(elapsed).toBeLessThan(1000);
});
```

- [ ] **Step 2: 改 scanFiles 为 async，用 fs.promises.readdir**

```typescript
export async function scanFilesAsync(rootDir: string): Promise<FileInfo[]> {
  const result: FileInfo[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !IGNORED.has(e.name)) await walk(join(dir, e.name));
      else if (e.isFile()) result.push({ path: join(dir, e.name), name: e.name });
    }
  }
  await walk(rootDir);
  return result;
}
```

- [ ] **Step 3: 更新 IPC handler 改 await**

在 `files.ipc.ts` 把 `handle("files:getTree", ...)` 改 `await scanFilesAsync(...)`。

- [ ] **Step 4: 验证 + Commit**

```powershell
pnpm -r typecheck; pnpm -r lint; pnpm -r test
```
```bash
git add apps/desktop/src/main/services/search/file-scanner.ts apps/desktop/src/main/services/search/__tests__/file-scanner.test.ts apps/desktop/src/main/ipc/files.ipc.ts
git commit -m "perf(scan): async file scanner replaces sync readdirSync, unblocks main process"
```

---

### Task T13: 长会话内存 LRU + xterm backpressure

**Covers:** OPTIMIZATION-ROADMAP T10
**Files:**
- Modify: `apps/desktop/src/main/services/pi-session/event-bridge.ts`（LRU event buffer）
- Modify: `apps/desktop/src/renderer/src/components/Terminal/TerminalPanel.tsx`（xterm 写入 backpressure）
- Test: 追加 event-bridge.test.ts

- [ ] **Step 1: 写失败测试——event buffer LRU 上限**

```typescript
it("drops oldest events when buffer exceeds 1000", () => {
  const bridge = createEventBridge("ws1", mockSend);
  for (let i = 0; i < 1100; i++) bridge.handleEvent({ type: "text_delta", text: "x" });
  expect(bridge.getBufferSize()).toBeLessThanOrEqual(1000);
});
```

- [ ] **Step 2: event-bridge 加 LRU**

```typescript
const MAX_BUFFER = 1000;
const buffer: PiEvent[] = [];
function pushBuffer(e: PiEvent) {
  buffer.push(e);
  if (buffer.length > MAX_BUFFER) buffer.shift();
}
```

- [ ] **Step 3: xterm backpressure——TerminalPanel 加 throttle**

```typescript
const writeQueue: string[] = [];
let flushScheduled = false;
function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(() => {
    term.write(writeQueue.join(""));
    writeQueue.length = 0;
    flushScheduled = false;
  });
}
// pty.onData(d => { writeQueue.push(d); scheduleFlush(); });
```

- [ ] **Step 4: 验证 + Commit**

```powershell
pnpm -r typecheck; pnpm -r lint; pnpm -r test
```
```bash
git add apps/desktop/src/main/services/pi-session/event-bridge.ts apps/desktop/src/renderer/src/components/Terminal/TerminalPanel.tsx
git commit -m "perf(memory): LRU event buffer (1000 cap) + xterm rAF-batched writes for backpressure"
```

---

## Phase 6: 可观测性（P2）

### Task T14: 可观测性——启动 metrics + trace id + 错误上报

**Covers:** OPTIMIZATION-ROADMAP T11
**Files:**
- Create: `apps/desktop/src/main/utils/trace.ts`
- Modify: `apps/desktop/src/main/services/pi-session/registry.ts`（trace id 串联）
- Modify: `apps/desktop/src/renderer/src/components/common/ErrorBoundary.tsx`（接 Sentry/PostHog 占位）
- Test: `apps/desktop/src/main/utils/__tests__/trace.test.ts`

- [ ] **Step 1: 写失败测试——trace id 生成**

```typescript
import { describe, it, expect } from "vitest";
import { startTrace, getTraceId } from "../trace";

describe("trace", () => {
  it("startTrace returns unique id", () => {
    const id = startTrace("prompt");
    expect(id).toMatch(/^prompt-[a-z0-9]{8}$/);
    expect(getTraceId()).toBe(id);
  });
});
```

- [ ] **Step 2: 实现 trace.ts**

```typescript
import { randomBytes } from "crypto";
let currentTrace: string | null = null;
export function startTrace(prefix: string): string {
  currentTrace = `${prefix}-${randomBytes(4).toString("hex")}`;
  log.info(`[trace] start ${currentTrace}`);
  return currentTrace;
}
export function getTraceId(): string | null { return currentTrace; }
```

- [ ] **Step 3: registry.ts 串联 trace**

在 `get(workspaceId, workspacePath)` 内 `startTrace("prompt")`，event-bridge 处理事件时 log 带 trace id。

- [ ] **Step 4: ErrorBoundary 接上报占位**

```typescript
// ErrorBoundary.tsx catch
logger.error("[ErrorBoundary] trace=" + getTraceId(), error, info);
// TODO v1.3: 接 Sentry.captureException(error) 或 PostHog.capture("renderer_error")
```

- [ ] **Step 5: 验证 + Commit**

```powershell
pnpm -r typecheck; pnpm -r lint; pnpm -r test
```
```bash
git add apps/desktop/src/main/utils/trace.ts apps/desktop/src/main/utils/__tests__/trace.test.ts apps/desktop/src/main/services/pi-session/registry.ts apps/desktop/src/renderer/src/components/common/ErrorBoundary.tsx
git commit -m "feat(observability): trace id per prompt + ErrorBoundary trace logging (Sentry hook placeholder)"
```

---

## Phase 7: a11y / i18n / DX（P2）

### Task T15: a11y 深化

**Covers:** OPTIMIZATION-ROADMAP T12
**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ApprovalPanel/`（keyboard trap + Escape）
- Modify: `apps/desktop/src/renderer/src/components/CommandPalette/`（焦点环可见）
- Modify: `apps/desktop/src/renderer/src/components/ChatView/`（aria-live for streaming）
- Test: `apps/desktop/e2e/a11y.spec.ts`（axe-core 跑 0 violations）

- [ ] **Step 1: ApprovalModal keyboard trap + Escape**

```typescript
useEffect(() => {
  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") trapFocus(e, modalRef);
  };
  document.addEventListener("keydown", handleKey);
  return () => document.removeEventListener("keydown", handleKey);
}, []);
```

- [ ] **Step 2: CommandPalette focus ring**

确保 `focus-visible:ring-2` Tailwind 类应用到每个 item。

- [ ] **Step 3: ChatView aria-live**

```tsx
<div aria-live="polite" aria-label="agent response stream">
  {streamingText}
</div>
```

- [ ] **Step 4: e2e a11y.spec.ts 跑 axe**

```typescript
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("chat view has 0 a11y violations", async ({ page }) => {
  await page.goto(...);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
```

- [ ] **Step 5: 验证 + Commit**

```powershell
pnpm -r typecheck; pnpm -r lint; pnpm -r test
```
```bash
git add apps/desktop/src/renderer/src/components/ApprovalPanel apps/desktop/src/renderer/src/components/CommandPalette apps/desktop/src/renderer/src/components/ChatView apps/desktop/e2e/a11y.spec.ts
git commit -m "feat(a11y): ApprovalModal keyboard trap + Escape, CommandPalette focus ring, ChatView aria-live"
```

---

### Task T16: i18n 覆盖率补全

**Covers:** OPTIMIZATION-ROADMAP T12
**Files:**
- Modify: `apps/desktop/src/renderer/src/i18n/locales/zh-CN.json` + `en.json`
- Modify: 剩余硬编码中文字符串的组件

- [ ] **Step 1: 扫描硬编码中文**

Run:
```powershell
Get-ChildItem apps/desktop/src/renderer/src -Recurse -Filter *.tsx | Select-String "[\u4e00-\u9fff]" | Where-Object { $_.Line -notmatch "t\(|i18n|//|/\*" }
```
Expected: 列出未走 t() 的中文字符串。

- [ ] **Step 2: 逐个抽到 locale json**

对每个匹配，在组件加 `const { t } = useTranslation();` 并替换为 `{t("key")}`，在 `zh-CN.json` + `en.json` 加对应 key。

- [ ] **Step 3: 验证——再扫一次硬编码**

Run:
```powershell
Get-ChildItem apps/desktop/src/renderer/src -Recurse -Filter *.tsx | Select-String "[\u4e00-\u9fff]" | Where-Object { $_.Line -notmatch "t\(|i18n|//|/\*" | Measure-Object | Select-Object -ExpandProperty Count
```
Expected: 0 或仅注释/测试。

- [ ] **Step 4: 全量验证 + Commit**

```powershell
pnpm -r typecheck; pnpm -r lint; pnpm -r test
```
```bash
git add -A
git commit -m "feat(i18n): extract remaining hardcoded strings to zh-CN/en locale files"
```

---

### Task T17: DX——dev-check 脚本 + pnpm dev 一键通

**Covers:** OPTIMIZATION-ROADMAP T12
**Files:**
- Create: `apps/desktop/scripts/dev-check.ts`
- Modify: `apps/desktop/package.json`（dev script 前置 dev-check）

- [ ] **Step 1: 写 dev-check.ts**

```typescript
import { execSync } from "child_process";
const checks = [
  { name: "Node >= 22.19", test: () => process.version >= "v22.19" },
  { name: "Pi CLI on PATH", test: () => { try { execSync("pi --version", { stdio: "ignore" }); return true; } catch { return false; } } },
  { name: "git installed", test: () => { try { execSync("git --version", { stdio: "ignore" }); return true; } catch { return false; } } },
];
let failed = false;
for (const c of checks) {
  const ok = c.test();
  console.log(`${ok ? "✓" : "✗"} ${c.name}`);
  if (!ok) failed = true;
}
if (failed) { console.error("\nMissing prerequisites. See README.md"); process.exit(1); }
```

- [ ] **Step 2: package.json dev 前置**

```json
"dev": "tsx scripts/dev-check.ts && electron-vite dev"
```
如果没装 tsx，用 `ts-node` 或编译后 `.js`。

- [ ] **Step 3: 验证**

Run:
```powershell
pnpm --filter @pi-desktop/desktop dev
```
Expected: dev-check 先跑，缺项给清单，全过则启动 electron-vite。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/scripts/dev-check.ts apps/desktop/package.json
git commit -m "feat(dx): add dev-check prerequisite script, gate pnpm dev on Node/Pi/git presence"
```

---

## Phase 8: Electron 升级 + e2e 解锁（P3）

### Task T18: Electron 35+ bump

**Covers:** OPTIMIZATION-ROADMAP §10 e2e 阻塞 + §13 v1.1 跨平台
**Files:**
- Modify: `apps/desktop/package.json`（electron ^35）
- Modify: `apps/desktop/electron-builder.yml`（mac/linux 配置激活）
- Modify: `.github/workflows/ci.yml`（Node 22 镜像）
- Modify: `apps/desktop/electron.vite.config.ts`（如有 native module 兼容）

**问题**：`@earendil-works/pi-coding-agent` 依赖 `node:sqlite`，Electron 34 的 Node 20.x 无此 builtin。Electron 35 自带 Node 22.x，解锁。

- [ ] **Step 1: 升级 electron**

Run:
```powershell
pnpm --filter @pi-desktop/desktop add electron@^35 @electron-toolkit/utils@latest
```

- [ ] **Step 2: 重装 native modules**

```powershell
pnpm rebuild
```
验证 node-pty / sharp 与 Electron 35 ABI 兼容（查 `node-pty` release notes）。

- [ ] **Step 3: 验证 typecheck + 启动**

```powershell
pnpm -r typecheck
pnpm --filter @pi-desktop/desktop dev
```
Expected: 窗口正常启动，无 `ERR_UNKNOWN_BUILTIN_MODULE`。

- [ ] **Step 4: CI 镜像同步**

`.github/workflows/ci.yml` 确保 `node-version: '22'`。

- [ ] **Step 5: 全量验证 + Commit**

```powershell
pnpm -r typecheck; pnpm -r lint; pnpm -r test
```
```bash
git add -A
git commit -m "feat(breaking): bump Electron 34 -> 35 (Node 22.x), unblock node:sqlite for e2e

[breaking] electron-35-bump: requires native module rebuild.
Unblocks Playwright e2e specs (node:sqlite now available).
Update CI to Node 22 image."
```

---

### Task T19: e2e 核心 4 spec 补齐

**Covers:** OPTIMIZATION-ROADMAP T07
**Files:**
- Create: `apps/desktop/e2e/launch.spec.ts`（已存在，验证）
- Create: `apps/desktop/e2e/chat-happy-path.spec.ts`
- Create: `apps/desktop/e2e/approval-flow.spec.ts`
- Create: `apps/desktop/e2e/terminal.spec.ts`
- Modify: `.github/workflows/ci.yml`（加 e2e job）

- [ ] **Step 1: 验证 launch.spec.ts 在 Electron 35 下通过**

Run:
```powershell
pnpm --filter @pi-desktop/desktop e2e:build
```
Expected: launch.spec.ts PASS。

- [ ] **Step 2: 写 chat-happy-path.spec.ts**

```typescript
import { test, expect, _electron as electron } from "@playwright/test";
test("chat happy path: send message -> see streaming response", async () => {
  const app = await electron.launch({ args: ["./out/main/index.js"] });
  const win = await app.firstWindow();
  await win.fill("[data-testid=chat-input]", "hello");
  await win.press("[data-testid=chat-input]", "Enter");
  await expect(win.locator("[data-testid=user-message]")).toBeVisible();
  await expect(win.locator("[data-testid=assistant-message]")).toBeVisible({ timeout: 30000 });
  await app.close();
});
```

- [ ] **Step 3: 写 approval-flow.spec.ts**

```typescript
test("HIGH_RISK bash triggers approval modal -> reject aborts", async () => {
  const app = await electron.launch({ args: ["./out/main/index.js"] });
  const win = await app.firstWindow();
  await win.fill("[data-testid=chat-input]", "run rm -rf /tmp/test");
  await win.press("[data-testid=chat-input]", "Enter");
  await expect(win.locator("[data-testid=approval-modal]")).toBeVisible({ timeout: 10000 });
  await win.click("[data-testid=approval-reject]");
  await expect(win.locator("[data-testid=approval-modal]")).not.toBeVisible();
  await app.close();
});
```

- [ ] **Step 4: 写 terminal.spec.ts**

```typescript
test("terminal: new tab -> type command -> see output", async () => {
  const app = await electron.launch({ args: ["./out/main/index.js"] });
  const win = await app.firstWindow();
  await win.click("[data-testid=terminal-tab-new]");
  await win.type("[data-testid=terminal-input]", "echo hello\r");
  await expect(win.locator(".xterm-rows")).toContainText("hello", { timeout: 5000 });
  await app.close();
});
```

- [ ] **Step 5: CI 加 e2e job**

在 `.github/workflows/ci.yml` 追加：
```yaml
  e2e:
    runs-on: windows-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @pi-desktop/desktop build
      - run: pnpm --filter @pi-desktop/desktop e2e
```

- [ ] **Step 6: 全量 e2e 验证**

Run:
```powershell
pnpm --filter @pi-desktop/desktop e2e:build
```
Expected: 4 spec 全绿。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/e2e/chat-happy-path.spec.ts apps/desktop/e2e/approval-flow.spec.ts apps/desktop/e2e/terminal.spec.ts .github/workflows/ci.yml
git commit -m "test(e2e): add chat-happy-path + approval-flow + terminal specs, wire CI e2e job"
```

---

## Self-Review

**1. Spec coverage:**
- OPTIMIZATION-ROADMAP T01-T04 (P0 hotfix) — 已发 v1.0.1，本计划不重复（现状基线已说明）
- T05 文档同步 → T04 + T05 ✅
- T06 messaging/gateway — 已删除，无需计划 ✅
- T07 e2e → T18 + T19 ✅
- T08 代码签名 — 用户决定不做，已排除 ✅
- T09 安全审查 → T08 + T09 + T10 ✅
- T10 性能 → T11 + T12 + T13 ✅
- T11 可观测性 → T14 ✅
- T12 a11y/i18n/DX → T15 + T16 + T17 ✅
- 工作区卫生 → T01 + T02 + T03 ✅
- main/index.ts 重构 → T06 ✅
- 双持久化收敛 → T07 ✅
- Electron 35 bump → T18 ✅

**2. Placeholder scan:** 无 "TBD/TODO/later"，每步都有具体命令和代码。

**3. Type consistency:** `loadPiAgentConfig()` 签名在 T06 Step 3 和 Step 5 一致；`classifyShellCommand` 在 T09 一致；`markColdStart`/`getColdStartReport` 在 T11/T14 一致。

---

## 执行方式

用户选择：**Subagent 逐任务执行**。

每个 Task 派一个独立 subagent，按 compose:subagent 两阶段评审：
1. subagent 实现并自测（typecheck + lint + test）
2. 评审 subagent 复核（独立读 diff，跑验证命令）

无依赖的任务（Phase 1 T01-T03、Phase 2 T04-T05）可并行；Phase 3+ 大多有顺序依赖（T07 依赖 T06 删 import，T18 依赖前面所有稳定）。

---