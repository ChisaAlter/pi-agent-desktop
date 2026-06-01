# Pi Desktop M1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 3 个根本 bug, 建立 Pi Desktop 的可工作骨架 (长连接 Pi + 分层审批 + cwd 正确)

**Architecture:** 每个 workspace 一个 Pi `AgentSession` 实例 (in-process, 不起子进程); 审批用 Pi 扩展机制 (`ctx.ui.confirm()`); 事件通过 typed IPC 推 renderer。

**Tech Stack:** Electron 34, TypeScript 5, `@earendil-works/pi-coding-agent@0.75.5`, vitest 2, Zustand 5, electron-store 8

**Reference Spec:** `docs/superpowers/specs/2026-06-01-pi-desktop-v1-design.md` §5-6, §10

**关键发现 (实施前必读):**
- Pi CLI v0.75.5 有完整 RPC 模式, 详见 `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
- 文档建议 Node.js 应用直接用 `AgentSession` 类, 不建议起子进程
- `AgentSession` API: `prompt()`, `subscribe()`, `abort()`, `dispose()`, 状态管理
- 审批走 `ExtensionUIContext.confirm()` / `select()` 等方法
- 需要 Node >= 22.19.0 (Electron 34 内置 Node 22 满足)

---

## 文件结构 (M1 涉及)

```
packages/shared-types/src/
├── events.ts                # NEW: Pi 事件类型 (从 d.ts 反推)
├── approval.ts              # NEW: ApprovalRequest, RiskLevel
└── ipc.ts                   # MODIFY: 加 chat/approval IPC 契约

apps/desktop/src/main/
├── services/pi-session/     # NEW: AgentSession 包装
│   ├── factory.ts           # 创建 AgentSession per workspace
│   ├── registry.ts          # workspaceId → AgentSession 映射
│   ├── event-bridge.ts      # AgentSession events → IPC
│   └── __tests__/
│       ├── factory.test.ts
│       └── event-bridge.test.ts
├── services/approval/       # NEW: 分层审批
│   ├── classifier.ts        # 工具风险分类
│   ├── pending-edits.ts     # write/edit 改动追踪
│   └── __tests__/
│       └── classifier.test.ts
├── extensions/pi-approval/  # NEW: Pi 扩展
│   └── index.ts             # 调 ctx.ui.confirm() 让用户批
├── ipc/
│   ├── chat.ipc.ts          # NEW: pi:send / pi:stop / pi:event
│   └── approval.ipc.ts      # NEW: approval:respond
└── index.ts                 # MODIFY: 用新 IPC 替换老的 pi:prompt

apps/desktop/src/preload/
└── index.ts                 # MODIFY: 暴露新 API

apps/desktop/src/renderer/src/
├── stores/
│   ├── chat-store.ts        # NEW: 替换 usePiStream 的状态管理
│   ├── approval-store.ts    # MODIFY: 分层队列
│   └── session-store.ts     # MODIFY: 适配新事件
├── hooks/
│   └── useChatStream.ts     # MODIFY: 用 chat-store
└── components/ApprovalPanel/
    ├── HighRiskModal.tsx    # NEW: 预审批弹窗
    └── EditReviewList.tsx   # MODIFY: 事后 diff 列表
```

---

## Task 0: 验证 Pi in-process 可行性 (Spike)

**Files:** 无文件改动, 只验证。

- [ ] **Step 1: 写最小验证脚本**

在 `apps/desktop/` 下建 `scripts/spike-pi-inprocess.mjs`:

```javascript
import { AgentSession, createAgentSession } from "@earendil-works/pi-coding-agent";

const services = await createAgentSessionServices({
    cwd: process.cwd(),
    modelRegistry: new ModelRegistry(),
});

const session = await createAgentSessionFromServices(services, {
    cwd: process.cwd(),
});

session.subscribe((event) => {
    console.log("[event]", event.type, JSON.stringify(event).slice(0, 200));
});

await session.prompt("Say 'hello' in one word");
await new Promise((r) => setTimeout(r, 5000));
session.dispose();
```

- [ ] **Step 2: 跑脚本验证**

Run: `cd apps/desktop && node scripts/spike-pi-inprocess.mjs`
Expected: 看到 `agent_start`, 多个 `message_update` (text_delta), `agent_end` 事件, 进程退出码 0

- [ ] **Step 3: 记录发现到 spike 笔记**

新建 `docs/spikes/2026-06-01-pi-inprocess.md`, 记录:
- AgentSession 创建需要的最小依赖 (cwd, modelRegistry, services)
- subscribe 事件的实际类型
- 跑通需要的 env vars (API key 等)

如果跑不通: 退到 `RpcClient` + 子进程方案, 在 spike 笔记里说明。

---

## Task 1: 配置 vitest 测试环境

**Files:**
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/src/test/setup.ts`
- Modify: `apps/desktop/package.json:15` (test script 已存在, 确认)

- [ ] **Step 1: 创建 vitest 配置**

`apps/desktop/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts"],
        setupFiles: ["./src/test/setup.ts"],
    },
    resolve: {
        alias: {
            "@": resolve(__dirname, "src/renderer/src"),
            "@shared": resolve(__dirname, "../../packages/shared-types/src"),
        },
    },
});
```

- [ ] **Step 2: 创建测试 setup**

`apps/desktop/src/test/setup.ts`:

```typescript
// 全局测试设置
process.env.NODE_ENV = "test";
```

- [ ] **Step 3: 跑一次空测试验证**

新建 `apps/desktop/src/test/sanity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("test env", () => {
    it("works", () => {
        expect(1 + 1).toBe(2);
    });
});
```

Run: `cd apps/desktop && pnpm test --run`
Expected: 1 passed

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/vitest.config.ts apps/desktop/src/test/
git commit -m "test: configure vitest for apps/desktop"
```

---

## Task 2: 暴露 Pi 事件类型 (shared-types)

**Files:**
- Create: `packages/shared-types/src/events.ts`
- Create: `packages/shared-types/src/approval.ts`
- Create: `packages/shared-types/src/__tests__/events.test.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: 写失败测试 (Pi 事件类型契约)**

`packages/shared-types/src/__tests__/events.test.ts`:

```typescript
import { describe, it, expect, expectTypeOf } from "vitest";
import type { PiEvent, PiTextDeltaEvent, PiToolStartEvent } from "../events";

describe("Pi events", () => {
    it("text_delta has delta string", () => {
        const e: PiTextDeltaEvent = {
            type: "message_update",
            subtype: "text_delta",
            delta: "hello",
        };
        expect(e.delta).toBe("hello");
    });

    it("tool_execution_start has toolCallId and toolName", () => {
        const e: PiToolStartEvent = {
            type: "tool_execution_start",
            toolCallId: "call_1",
            toolName: "write",
            args: { file_path: "/x", content: "y" },
        };
        expect(e.toolName).toBe("write");
    });

    it("PiEvent is a union", () => {
        expectTypeOf<PiEvent>().toMatchTypeOf<{ type: string }>();
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/shared-types && pnpm test --run`
Expected: FAIL (modules not found)

- [ ] **Step 3: 实现 events.ts**

`packages/shared-types/src/events.ts`:

```typescript
// Pi RPC 事件类型 (从 @earendil-works/pi-coding-agent 反推)
// 完整列表见 node_modules/@earendil-works/pi-coding-agent/docs/rpc.md §Events

export type PiEventType =
    | "agent_start"
    | "agent_end"
    | "turn_start"
    | "turn_end"
    | "message_start"
    | "message_update"
    | "message_end"
    | "tool_execution_start"
    | "tool_execution_update"
    | "tool_execution_end"
    | "queue_update"
    | "compaction_start"
    | "compaction_end"
    | "auto_retry_start"
    | "auto_retry_end"
    | "extension_error";

export interface PiMessageUpdateTextDelta {
    type: "message_update";
    subtype: "text_delta";
    delta: string;
}

export interface PiMessageUpdateThinkingDelta {
    type: "message_update";
    subtype: "thinking_delta";
    delta: string;
}

export interface PiMessageUpdateToolStart {
    type: "message_update";
    subtype: "toolcall_start";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}

export interface PiMessageUpdateToolEnd {
    type: "message_update";
    subtype: "toolcall_end";
    toolCallId: string;
    toolName: string;
    result?: unknown;
}

export type PiTextDeltaEvent = PiMessageUpdateTextDelta;
export type PiThinkingDeltaEvent = PiMessageUpdateThinkingDelta;
export type PiToolStartEvent = PiMessageUpdateToolStart;
export type PiToolEndEvent = PiMessageUpdateToolEnd;

export interface PiToolExecutionStart {
    type: "tool_execution_start";
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
}

export interface PiToolExecutionEnd {
    type: "tool_execution_end";
    toolCallId: string;
    toolName: string;
    result?: unknown;
    isError: boolean;
}

export interface PiTurnEnd {
    type: "turn_end";
}

export type PiEvent =
    | { type: "agent_start" }
    | { type: "agent_end" }
    | { type: "turn_start" }
    | PiTurnEnd
    | PiTextDeltaEvent
    | PiThinkingDeltaEvent
    | PiToolStartEvent
    | PiToolEndEvent
    | PiToolExecutionStart
    | PiToolExecutionEnd
    | { type: "message_start" }
    | { type: "message_end" }
    | { type: "queue_update"; steering: readonly string[]; followUp: readonly string[] };
```

- [ ] **Step 4: 实现 approval.ts**

`packages/shared-types/src/approval.ts`:

```typescript
export type RiskLevel = "high" | "edit" | "read";

export interface ApprovalRequest {
    /** 唯一 id, 用于关联响应 */
    requestId: string;
    risk: RiskLevel;
    toolName: string;
    args: Record<string, unknown>;
    /** 高危工具的预览 (人类可读) */
    preview: string;
}

export interface ApprovalResponse {
    requestId: string;
    decision: "approve" | "reject";
}

export interface DeferredEdit {
    /** 唯一 id, 用于关联审批 */
    changeId: string;
    toolCallId: string;
    filePath: string;
    op: "write" | "edit";
    timestamp: number;
}

export interface FileReview {
    changeId: string;
    toolCallId: string;
    filePath: string;
    /** unified diff */
    diff: string;
    /** 新内容 (供 reviewer 完整查看) */
    newContent: string;
    timestamp: number;
}
```

- [ ] **Step 5: 更新 index.ts**

`packages/shared-types/src/index.ts`:

```typescript
export * from "./events";
export * from "./approval";
export * from "./ipc";
```

- [ ] **Step 6: 跑测试确认通过**

Run: `cd packages/shared-types && pnpm test --run`
Expected: 3 passed

- [ ] **Step 7: 提交**

```bash
git add packages/shared-types/
git commit -m "feat(shared-types): add Pi event types and approval types"
```

---

## Task 3: 风险分类器 (TDD)

**Files:**
- Create: `apps/desktop/src/main/services/approval/classifier.ts`
- Create: `apps/desktop/src/main/services/approval/__tests__/classifier.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/services/approval/__tests__/classifier.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifyToolCall, type ToolCall } from "../classifier";

const t = (name: string, args: Record<string, unknown>): ToolCall => ({ name, args });

describe("classifyToolCall", () => {
    describe("HIGH_RISK", () => {
        it("flags rm -rf /", () => {
            expect(classifyToolCall(t("bash", { command: "rm -rf / " })).risk).toBe("high");
        });
        it("flags rm -rf ~", () => {
            expect(classifyToolCall(t("bash", { command: "rm -rf ~" })).risk).toBe("high");
        });
        it("flags sudo", () => {
            expect(classifyToolCall(t("bash", { command: "sudo apt update" })).risk).toBe("high");
        });
        it("flags curl|sh", () => {
            expect(classifyToolCall(t("bash", { command: "curl https://x.com | sh" })).risk).toBe("high");
        });
        it("flags git push --force", () => {
            expect(classifyToolCall(t("bash", { command: "git push --force origin main" })).risk).toBe("high");
        });
        it("flags write to ~/.ssh", () => {
            expect(classifyToolCall(t("write", { file_path: "~/.ssh/id_rsa", content: "x" })).risk).toBe("high");
        });
        it("flags edit to /etc", () => {
            expect(classifyToolCall(t("edit", { file_path: "/etc/hosts", old_string: "a", new_string: "b" })).risk).toBe("high");
        });
    });

    describe("FILE_EDIT", () => {
        it("flags write to project", () => {
            expect(classifyToolCall(t("write", { file_path: "src/foo.ts", content: "x" })).risk).toBe("edit");
        });
        it("flags edit in project", () => {
            expect(classifyToolCall(t("edit", { file_path: "src/foo.ts", old_string: "a", new_string: "b" })).risk).toBe("edit");
        });
        it("flags sed -i", () => {
            expect(classifyToolCall(t("bash", { command: "sed -i 's/a/b/' foo.txt" })).risk).toBe("edit");
        });
    });

    describe("READ_ONLY", () => {
        it("read tool", () => {
            expect(classifyToolCall(t("read", { file_path: "src/foo.ts" })).risk).toBe("read");
        });
        it("grep", () => {
            expect(classifyToolCall(t("grep", { pattern: "TODO" })).risk).toBe("read");
        });
        it("ls", () => {
            expect(classifyToolCall(t("bash", { command: "ls -la" })).risk).toBe("read");
        });
        it("cat", () => {
            expect(classifyToolCall(t("bash", { command: "cat README.md" })).risk).toBe("read");
        });
        it("git status", () => {
            expect(classifyToolCall(t("bash", { command: "git status" })).risk).toBe("read");
        });
    });

    describe("preview", () => {
        it("includes command in preview", () => {
            const r = classifyToolCall(t("bash", { command: "rm -rf /tmp" }));
            expect(r.preview).toContain("rm -rf /tmp");
        });
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm test --run classifier`
Expected: FAIL (module not found)

- [ ] **Step 3: 实现 classifier**

`apps/desktop/src/main/services/approval/classifier.ts`:

```typescript
export interface ToolCall {
    name: string;
    args: Record<string, unknown>;
}

// RiskLevel 从 shared-types 引入, 保持单一来源
export type { RiskLevel } from "@shared/approval";
import type { RiskLevel } from "@shared/approval";

export interface Classification {
    risk: RiskLevel;
    preview: string;
}

// 高危 bash 子命令模式
const HIGH_RISK_BASH_PATTERNS = [
    /\brm\s+-rf?\s+(\/|~|\$HOME)/,
    /\bsudo\b/,
    /\bmkfs\b/,
    /\bdd\s+if=/,
    /\bchmod\s+777\s+\//,
    /curl\s+.*\|\s*sh\b/,
    /\bgit\s+push\s+.*--force\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bnpm\s+uninstall\s+-g\b/,
    /\breg\s+delete\b/i,
];

// 高危写路径
const HIGH_RISK_PATH_PATTERNS = [
    /^\/?\.ssh\//,
    /^\/?\.aws\//,
    /^\/?\.config\//,
    /^\/?\.bashrc$/,
    /^\/?\.zshrc$/,
    /^\/?\.profile$/,
    /^\/?etc\//i,
    /^C:\\Windows\\System32/i,
    /\.git[\\\/]hooks/,
    /\.git[\\\/]config$/,
    /\.pi[\\\/]agent[\\\/]settings\.json$/,
];

// 文件编辑类 bash
const EDIT_BASH_PATTERNS = [
    /^>\s*\S/, // > file
    /\bsed\s+-i\b/,
    /\bawk\s+.*\s+>\s+/,
];

// 读类 bash
const READ_BASH_COMMANDS = new Set([
    "ls", "cat", "head", "tail", "echo", "pwd", "whoami", "date",
    "git", "npm", "pnpm", "yarn", "node", "which", "where", "type",
    "env", "printenv",
]);

function expandHome(p: string): string {
    return p.replace(/^~/, "/home/user").replace(/^%USERPROFILE%/i, "C:/Users/user");
}

export function classifyToolCall(call: ToolCall): Classification {
    const name = call.name.toLowerCase();
    const args = call.args;

    // read 类工具直接放行
    if (name === "read" || name === "grep" || name === "glob" || name === "find" || name === "ls") {
        return { risk: "read", preview: `${name} ${JSON.stringify(args)}` };
    }

    // bash 工具按子命令分类
    if (name === "bash") {
        const cmd = String(args.command ?? args.cmd ?? "").trim();
        if (!cmd) return { risk: "read", preview: "(empty)" };

        for (const pat of HIGH_RISK_BASH_PATTERNS) {
            if (pat.test(cmd)) return { risk: "high", preview: cmd };
        }
        for (const pat of EDIT_BASH_PATTERNS) {
            if (pat.test(cmd)) return { risk: "edit", preview: cmd };
        }
        // 第一个 token 是不是读类命令
        const firstToken = cmd.split(/\s+/)[0];
        if (READ_BASH_COMMANDS.has(firstToken)) return { risk: "read", preview: cmd };
        return { risk: "edit", preview: cmd };
    }

    // write/edit 工具按路径分类
    if (name === "write" || name === "edit") {
        const rawPath = String(args.file_path ?? args.path ?? args.filePath ?? "");
        const expanded = expandHome(rawPath);
        for (const pat of HIGH_RISK_PATH_PATTERNS) {
            if (pat.test(expanded) || pat.test(rawPath)) {
                return { risk: "high", preview: `${name} ${rawPath}` };
            }
        }
        return { risk: "edit", preview: `${name} ${rawPath}` };
    }

    // 未知工具, 默认 edit (安全侧)
    return { risk: "edit", preview: `${name} ${JSON.stringify(args)}` };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/desktop && pnpm test --run classifier`
Expected: ~20 passed

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main/services/approval/
git commit -m "feat(approval): risk classifier with tiered output"
```

---

## Task 4: 写 PendingEdits 跟踪 (TDD)

**Files:**
- Create: `apps/desktop/src/main/services/approval/pending-edits.ts`
- Create: `apps/desktop/src/main/services/approval/__tests__/pending-edits.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/services/approval/__tests__/pending-edits.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { PendingEdits } from "../pending-edits";

describe("PendingEdits", () => {
    let edits: PendingEdits;

    beforeEach(() => {
        edits = new PendingEdits();
    });

    it("tracks a write and returns changeId", () => {
        const id = edits.track("tc_1", "write", "src/foo.ts", { content: "hello" });
        expect(id).toMatch(/^change_/);
    });

    it("retrieves tracked edit by id", () => {
        const id = edits.track("tc_1", "write", "src/foo.ts", { content: "hello" });
        const change = edits.get(id);
        expect(change?.filePath).toBe("src/foo.ts");
        expect(change?.newContent).toBe("hello");
    });

    it("marks as reviewed with diff", () => {
        const id = edits.track("tc_1", "write", "src/foo.ts", { content: "hello" });
        edits.review(id, "--- a\n+++ b\n@@\n-old\n+new\n", "hello");
        const change = edits.get(id);
        expect(change?.diff).toContain("+new");
    });

    it("removes a change by id", () => {
        const id = edits.track("tc_1", "write", "src/foo.ts", { content: "x" });
        edits.remove(id);
        expect(edits.get(id)).toBeUndefined();
    });

    it("lists all tracked edits", () => {
        edits.track("tc_1", "write", "a.ts", { content: "1" });
        edits.track("tc_2", "edit", "b.ts", { old_string: "a", new_string: "b" });
        expect(edits.list().length).toBe(2);
    });

    it("approves and removes", () => {
        const id = edits.track("tc_1", "write", "a.ts", { content: "1" });
        edits.approve(id);
        expect(edits.get(id)).toBeUndefined();
    });

    it("rejects and removes", () => {
        const id = edits.track("tc_1", "write", "a.ts", { content: "1" });
        edits.reject(id);
        expect(edits.get(id)).toBeUndefined();
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm test --run pending-edits`
Expected: FAIL

- [ ] **Step 3: 实现 pending-edits.ts**

`apps/desktop/src/main/services/approval/pending-edits.ts`:

```typescript
export interface TrackedEdit {
    id: string;
    toolCallId: string;
    toolName: "write" | "edit";
    filePath: string;
    newContent?: string;
    oldString?: string;
    newString?: string;
    diff?: string;
    timestamp: number;
}

export class PendingEdits {
    private map = new Map<string, TrackedEdit>();

    track(
        toolCallId: string,
        toolName: "write" | "edit",
        filePath: string,
        args: { content?: string; old_string?: string; new_string?: string }
    ): string {
        const id = `change_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        this.map.set(id, {
            id,
            toolCallId,
            toolName,
            filePath,
            newContent: args.content,
            oldString: args.old_string,
            newString: args.new_string,
            timestamp: Date.now(),
        });
        return id;
    }

    review(id: string, diff: string, finalContent: string): void {
        const change = this.map.get(id);
        if (change) {
            change.diff = diff;
            change.newContent = finalContent;
        }
    }

    approve(id: string): void {
        this.map.delete(id);
    }

    reject(id: string): void {
        this.map.delete(id);
    }

    remove(id: string): void {
        this.map.delete(id);
    }

    get(id: string): TrackedEdit | undefined {
        return this.map.get(id);
    }

    list(): TrackedEdit[] {
        return [...this.map.values()].sort((a, b) => b.timestamp - a.timestamp);
    }

    clear(): void {
        this.map.clear();
    }
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd apps/desktop && pnpm test --run pending-edits`
Expected: 7 passed

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main/services/approval/pending-edits.ts apps/desktop/src/main/services/approval/__tests__/pending-edits.test.ts
git commit -m "feat(approval): PendingEdits tracker for write/edit diffs"
```

---

## Task 5: AgentSession Factory (Spike 后)

**Files:**
- Create: `apps/desktop/src/main/services/pi-session/factory.ts`
- Create: `apps/desktop/src/main/services/pi-session/__tests__/factory.test.ts`

- [ ] **Step 1: 写失败测试 (工厂能创建 session)**

`apps/desktop/src/main/services/pi-session/__tests__/factory.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createWorkspaceSession } from "../factory";

vi.mock("@earendil-works/pi-coding-agent", () => ({
    createAgentSessionServices: vi.fn().mockResolvedValue({}),
    createAgentSessionFromServices: vi.fn().mockResolvedValue({
        prompt: vi.fn(),
        subscribe: vi.fn(),
        dispose: vi.fn(),
    }),
    ModelRegistry: vi.fn(),
}));

describe("createWorkspaceSession", () => {
    it("creates a session for a workspace path", async () => {
        const session = await createWorkspaceSession({
            workspaceId: "ws_1",
            workspacePath: "/tmp/test",
            modelId: "claude-sonnet-4-20250514",
        });
        expect(session).toBeDefined();
        expect(session.workspaceId).toBe("ws_1");
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm test --run factory`
Expected: FAIL

- [ ] **Step 3: 实现 factory.ts**

`apps/desktop/src/main/services/pi-session/factory.ts`:

```typescript
import { createAgentSessionServices, createAgentSessionFromServices, ModelRegistry, type AgentSession } from "@earendil-works/pi-coding-agent";
import { loadApprovalExtension } from "../../extensions/pi-approval";
import { join } from "path";
import { mkdirSync } from "fs";

export interface WorkspaceSession {
    workspaceId: string;
    session: AgentSession;
    dispose: () => void;
}

export interface CreateSessionOpts {
    workspaceId: string;
    workspacePath: string;
    modelId?: string;
    provider?: string;
}

export async function createWorkspaceSession(opts: CreateSessionOpts): Promise<WorkspaceSession> {
    // 每个 workspace 独立 session 目录
    const sessionDir = join(opts.workspacePath, ".pi-desktop", "sessions");
    mkdirSync(sessionDir, { recursive: true });

    const services = await createAgentSessionServices({
        cwd: opts.workspacePath,
        modelRegistry: new ModelRegistry(),
    });

    // 加载审批扩展 (Task 7)
    const approvalExt = await loadApprovalExtension();

    const session = await createAgentSessionFromServices(services, {
        cwd: opts.workspacePath,
        sessionDir,
        customExtensions: [approvalExt],
    });

    return {
        workspaceId: opts.workspaceId,
        session,
        dispose: () => session.dispose(),
    };
}
```

- [ ] **Step 4: 跑测试通过 (mock 模式下)**

Run: `cd apps/desktop && pnpm test --run factory`
Expected: 1 passed (因为 mock 了实际 SDK)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main/services/pi-session/factory.ts apps/desktop/src/main/services/pi-session/__tests__/factory.test.ts
git commit -m "feat(pi-session): AgentSession factory per workspace"
```

---

## Task 6: WorkspaceRegistry (多 workspace 编排)

**Files:**
- Create: `apps/desktop/src/main/services/pi-session/registry.ts`
- Create: `apps/desktop/src/main/services/pi-session/__tests__/registry.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/services/pi-session/__tests__/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { WorkspaceRegistry } from "../registry";

vi.mock("../factory", () => ({
    createWorkspaceSession: vi.fn(async (opts) => ({
        workspaceId: opts.workspaceId,
        session: { dispose: vi.fn() },
        dispose: vi.fn(),
    })),
}));

describe("WorkspaceRegistry", () => {
    let reg: WorkspaceRegistry;

    beforeEach(() => {
        reg = new WorkspaceRegistry();
    });

    it("creates a session on first get", async () => {
        const ws = await reg.get("ws_1", "/tmp/a");
        expect(ws.workspaceId).toBe("ws_1");
    });

    it("reuses existing session on second get", async () => {
        const a = await reg.get("ws_1", "/tmp/a");
        const b = await reg.get("ws_1", "/tmp/a");
        expect(a).toBe(b);
    });

    it("dispose removes session", async () => {
        await reg.get("ws_1", "/tmp/a");
        reg.dispose("ws_1");
        expect(reg.has("ws_1")).toBe(false);
    });

    it("dispose all on shutdown", async () => {
        await reg.get("ws_1", "/tmp/a");
        await reg.get("ws_2", "/tmp/b");
        reg.disposeAll();
        expect(reg.size()).toBe(0);
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm test --run registry`
Expected: FAIL

- [ ] **Step 3: 实现 registry.ts**

`apps/desktop/src/main/services/pi-session/registry.ts`:

```typescript
import { createWorkspaceSession, type WorkspaceSession } from "./factory";

export class WorkspaceRegistry {
    private sessions = new Map<string, WorkspaceSession>();

    async get(workspaceId: string, workspacePath: string, modelId?: string): Promise<WorkspaceSession> {
        const existing = this.sessions.get(workspaceId);
        if (existing) return existing;
        const ws = await createWorkspaceSession({ workspaceId, workspacePath, modelId });
        this.sessions.set(workspaceId, ws);
        return ws;
    }

    has(workspaceId: string): boolean {
        return this.sessions.has(workspaceId);
    }

    dispose(workspaceId: string): void {
        const ws = this.sessions.get(workspaceId);
        if (ws) {
            ws.dispose();
            this.sessions.delete(workspaceId);
        }
    }

    disposeAll(): void {
        for (const ws of this.sessions.values()) {
            ws.dispose();
        }
        this.sessions.clear();
    }

    size(): number {
        return this.sessions.size;
    }
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd apps/desktop && pnpm test --run registry`
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main/services/pi-session/registry.ts apps/desktop/src/main/services/pi-session/__tests__/registry.test.ts
git commit -m "feat(pi-session): WorkspaceRegistry for multi-workspace session orchestration"
```

---

## Task 7: Pi 审批扩展 (调用 ctx.ui.confirm)

**Files:**
- Create: `apps/desktop/src/main/extensions/pi-approval/index.ts`

- [ ] **Step 1: 写扩展代码**

`apps/desktop/src/main/extensions/pi-approval/index.ts`:

```typescript
/**
 * Pi 扩展: 在工具调用前请求用户审批
 *
 * 通过 ctx.ui.confirm() 弹窗, Pi 会把请求转发到 RPC 协议的
 * extension_ui_request, 我们的桌面端收到后转给 renderer 弹模态,
 * 用户决策后回 extension_ui_response。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifyToolCall } from "../../services/approval/classifier";
import { app } from "electron";

export async function loadApprovalExtension() {
    const { extensionUIRequest } = await import("./rpc-bridge");
    const ext: {
        name: string;
        setup: (api: ExtensionAPI) => void;
    } = {
        name: "pi-desktop-approval",
        setup(api) {
            api.on("tool_call", async (event, ctx) => {
                const { toolName, args } = event;
                const classification = classifyToolCall({ name: toolName, args });

                // read 类直接放行
                if (classification.risk === "read") return;

                // 高危: 弹模态审批
                if (classification.risk === "high") {
                    const approved = await extensionUIRequest({
                        method: "confirm",
                        title: `允许执行高危工具: ${toolName}?`,
                        message: classification.preview,
                    });
                    if (!approved) {
                        return { block: true, reason: "用户拒绝" };
                    }
                    return;
                }

                // file_edit: 记录到 pending-edits, 不阻断
                if (classification.risk === "edit") {
                    const filePath = String((args as any).file_path ?? (args as any).path ?? "");
                    if (filePath) {
                        // 通知 main process 记一笔, 等工具执行完看 diff
                        app.emit("approval:deferred", {
                            toolName,
                            filePath,
                            args,
                        });
                    }
                    return;
                }
            });

            // 工具执行完, 读最新文件 → 推 diff 给 renderer
            api.on("tool_result", async (event) => {
                if (event.toolName !== "write" && event.toolName !== "edit") return;
                app.emit("approval:review", {
                    toolName: event.toolName,
                    filePath: (event.args as any).file_path,
                    result: event.result,
                });
            });
        },
    };
    return ext;
}
```

- [ ] **Step 2: 创建空的 rpc-bridge 占位 (Task 8 填)**

`apps/desktop/src/main/extensions/pi-approval/rpc-bridge.ts`:

```typescript
/**
 * Stub — Task 8 replaces with real implementation
 */
export async function extensionUIRequest(_req: any): Promise<boolean> {
    // TODO: 实现真实的 extension_ui_request 桥接
    return true;
}
```

- [ ] **Step 3: TypeScript 编译验证**

Run: `cd apps/desktop && pnpm typecheck`
Expected: 通过 (会有 unused 警告但不应 error)

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/main/extensions/pi-approval/
git commit -m "feat(extension): pi-desktop-approval extension using ctx.ui.confirm"
```

---

## Task 8: Extension UI Bridge (Task 7 占位的实现)

**Files:**
- Modify: `apps/desktop/src/main/extensions/pi-approval/rpc-bridge.ts`

- [ ] **Step 1: 改成真的事件发射**

`apps/desktop/src/main/extensions/pi-approval/rpc-bridge.ts`:

```typescript
import { app, BrowserWindow } from "electron";
import { randomUUID } from "crypto";

interface PendingRequest {
    resolve: (value: boolean) => void;
    timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingRequest>();

export async function extensionUIRequest(req: {
    method: "confirm" | "select";
    title: string;
    message?: string;
}): Promise<boolean> {
    const requestId = randomUUID();
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return false;

    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
            pending.delete(requestId);
            resolve(false); // 超时默认拒绝
        }, 60_000);

        pending.set(requestId, { resolve, timer });

        win.webContents.send("approval:request", {
            requestId,
            method: req.method,
            title: req.title,
            message: req.message,
        });
    });
}

export function resolveApprovalRequest(requestId: string, approved: boolean): void {
    const p = pending.get(requestId);
    if (p) {
        clearTimeout(p.timer);
        pending.delete(requestId);
        p.resolve(approved);
    }
}
```

- [ ] **Step 2: TypeScript 编译**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/main/extensions/pi-approval/rpc-bridge.ts
git commit -m "feat(extension): real approval:request bridge to renderer"
```

---

## Task 9: EventBridge (AgentSession events → IPC)

**Files:**
- Create: `apps/desktop/src/main/services/pi-session/event-bridge.ts`
- Create: `apps/desktop/src/main/services/pi-session/__tests__/event-bridge.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/desktop/src/main/services/pi-session/__tests__/event-bridge.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createEventBridge } from "../event-bridge";

describe("EventBridge", () => {
    it("forwards text_delta as pi:event", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({
            type: "message_update",
            subtype: "text_delta",
            delta: "hello",
        });
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", {
            type: "text_delta",
            text: "hello",
        });
    });

    it("forwards tool_execution_start as pi:event", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({
            type: "tool_execution_start",
            toolCallId: "tc_1",
            toolName: "bash",
            args: { command: "ls" },
        });
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", {
            type: "toolcall_start",
            tool: "bash",
            input: { command: "ls" },
            id: "tc_1",
        });
    });

    it("forwards turn_end", () => {
        const send = vi.fn();
        const bridge = createEventBridge("ws_1", send);
        bridge.handleEvent({ type: "turn_end" });
        expect(send).toHaveBeenCalledWith("pi:event", "ws_1", { type: "turn_end" });
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/desktop && pnpm test --run event-bridge`
Expected: FAIL

- [ ] **Step 3: 实现 event-bridge.ts**

`apps/desktop/src/main/services/pi-session/event-bridge.ts`:

```typescript
import type { PiEvent } from "@shared/events";

export type IpcSender = (channel: string, workspaceId: string, payload: unknown) => void;

export function createEventBridge(workspaceId: string, send: IpcSender) {
    return {
        handleEvent(event: PiEvent) {
            // 转换 Pi 原生事件 → renderer 友好的简化事件
            switch (event.type) {
                case "message_update":
                    if (event.subtype === "text_delta") {
                        send("pi:event", workspaceId, { type: "text_delta", text: event.delta });
                    } else if (event.subtype === "thinking_delta") {
                        send("pi:event", workspaceId, { type: "thinking_delta", text: event.delta });
                    } else if (event.subtype === "toolcall_start") {
                        send("pi:event", workspaceId, {
                            type: "toolcall_start",
                            id: event.toolCallId,
                            tool: event.toolName,
                            input: event.args,
                        });
                    } else if (event.subtype === "toolcall_end") {
                        send("pi:event", workspaceId, {
                            type: "toolcall_end",
                            id: event.toolCallId,
                            tool: event.toolName,
                            result: event.result,
                        });
                    }
                    break;
                case "tool_execution_start":
                    send("pi:event", workspaceId, {
                        type: "toolcall_start",
                        id: event.toolCallId,
                        tool: event.toolName,
                        input: event.args,
                    });
                    break;
                case "tool_execution_end":
                    send("pi:event", workspaceId, {
                        type: "toolcall_end",
                        id: event.toolCallId,
                        tool: event.toolName,
                        result: event.result,
                    });
                    break;
                case "turn_end":
                    send("pi:event", workspaceId, { type: "turn_end" });
                    break;
                case "agent_end":
                    send("pi:event", workspaceId, { type: "agent_end" });
                    break;
                default:
                    // 未知事件忽略
                    break;
            }
        },
    };
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd apps/desktop && pnpm test --run event-bridge`
Expected: 3 passed

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main/services/pi-session/event-bridge.ts apps/desktop/src/main/services/pi-session/__tests__/event-bridge.test.ts
git commit -m "feat(pi-session): event-bridge converting Pi events to IPC"
```

---

## Task 10: Chat IPC Handler (替换老 pi:prompt)

**Files:**
- Create: `apps/desktop/src/main/ipc/chat.ipc.ts`
- Modify: `apps/desktop/src/main/index.ts:347-480` (删除老的 pi:prompt handler)

- [ ] **Step 1: 写新的 chat IPC**

`apps/desktop/src/main/ipc/chat.ipc.ts`:

```typescript
import { ipcMain, BrowserWindow } from "electron";
import { WorkspaceRegistry } from "../services/pi-session/registry";
import { createEventBridge } from "../services/pi-session/event-bridge";
import { resolveApprovalRequest } from "../extensions/pi-approval/rpc-bridge";
import { useWorkspaceStore } from "../utils/workspace-store-resolver";

export function setupChatIpc(registry: WorkspaceRegistry): void {
    const send = (channel: string, workspaceId: string, payload: unknown) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
            win.webContents.send(channel, { workspaceId, payload });
        }
    };

    ipcMain.handle("pi:send", async (_event, workspaceId: string, text: string) => {
        const ws = useWorkspaceStore().getById(workspaceId);
        if (!ws) throw new Error(`Workspace not found: ${workspaceId}`);
        const session = await registry.get(workspaceId, ws.path);
        const bridge = createEventBridge(workspaceId, send);
        // 订阅事件 (一次性, 后续 turn 复用同一订阅)
        session.session.subscribe(bridge.handleEvent as any);
        await session.session.prompt(text);
    });

    ipcMain.handle("pi:stop", async (_event, workspaceId: string) => {
        const ws = useWorkspaceStore().getById(workspaceId);
        if (!ws) return;
        const session = await registry.get(workspaceId, ws.path);
        session.session.abort();
    });

    // 接收 renderer 对审批的响应
    ipcMain.on("approval:respond", (_event, requestId: string, approved: boolean) => {
        resolveApprovalRequest(requestId, approved);
    });
}
```

- [ ] **Step 2: 创建 workspace store 解析器占位**

`apps/desktop/src/main/utils/workspace-store-resolver.ts`:

```typescript
import Store from "electron-store";

interface Workspace {
    id: string;
    name: string;
    path: string;
    createdAt: number;
}

const store = new Store<{ workspaces: Workspace[] }>({
    defaults: { workspaces: [] },
});

export function useWorkspaceStore() {
    return {
        getById(id: string): Workspace | undefined {
            return store.get("workspaces").find((w) => w.id === id);
        },
    };
}
```

- [ ] **Step 3: 在 index.ts 里替换老的 pi:prompt**

`apps/desktop/src/main/index.ts`:
- 删除 350-480 行 (老 `ipcMain.handle('pi:prompt', ...)`)
- 删除 514-536 行 (老 `ipcMain.handle('pi:stop', ...)`)
- 在 `setupIPC()` 调用前, 创建 `WorkspaceRegistry` 实例
- 调用 `setupChatIpc(registry)` 替代老 handler
- 在 `window-all-closed` 里调 `registry.disposeAll()`

新代码骨架:

```typescript
import { WorkspaceRegistry } from "./services/pi-session/registry";
import { setupChatIpc } from "./ipc/chat.ipc";

let registry: WorkspaceRegistry | null = null;

// ... in app.whenReady().then:
registry = new WorkspaceRegistry();
setupChatIpc(registry);

// ... in app.on('window-all-closed'):
registry?.disposeAll();
```

- [ ] **Step 3.5: 在 chat.ipc.ts 接 Pi 扩展的 deferred/review 事件**

Task 7 的 Pi 扩展用 `app.emit("approval:deferred", ...)` 和 `app.emit("approval:review", ...)` 通知 main。需要在 `setupChatIpc` 里订阅, 写进 PendingEdits 并推到 renderer:

`apps/desktop/src/main/ipc/chat.ipc.ts` 顶部加 import + 实例化:

```typescript
import { PendingEdits } from "../services/approval/pending-edits";
import { readFile } from "fs/promises";
import { join } from "path";
import { diffWordsWithSpace } from "diff"; // 或简单行 diff

const pendingEdits = new PendingEdits();

// 订阅扩展发的事件
app.on("approval:deferred", (payload: { toolName: string; filePath: string; args: any; toolCallId: string }) => {
    const changeId = pendingEdits.track(payload.toolCallId, payload.toolName as "write" | "edit", payload.filePath, payload.args);
    send("approval:deferred", workspaceId, { changeId, toolCallId: payload.toolCallId, filePath: payload.filePath, op: payload.toolName, timestamp: Date.now() });
});

app.on("approval:review", async (payload: { toolName: string; filePath: string; toolCallId: string }) => {
    const change = pendingEdits.list().find((c) => c.toolCallId === payload.toolCallId);
    if (!change) return;
    let newContent = "";
    try {
        newContent = await readFile(join(ws.path, payload.filePath), "utf-8");
    } catch {}
    const diff = generateUnifiedDiff(change.oldString ?? "", newContent, payload.filePath);
    pendingEdits.review(change.id, diff, newContent);
    send("approval:review", workspaceId, { changeId: change.id, toolCallId: change.toolCallId, filePath: payload.filePath, diff, newContent, timestamp: Date.now() });
});
```

`generateUnifiedDiff` 是简单 helper (用 `diff` 库或手写)。实现可以放 `apps/desktop/src/main/utils/diff.ts` (M1 允许简单实现)。

- [ ] **Step 4: TypeScript 编译**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS (可能有警告)

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main/ipc/ apps/desktop/src/main/utils/ apps/desktop/src/main/index.ts
git commit -m "refactor(chat): replace one-shot pi:prompt with AgentSession-based chat IPC"
```

---

## Task 11: 更新 Preload API

**Files:**
- Modify: `apps/desktop/src/preload/index.ts:11-13`

- [ ] **Step 1: 替换 sendPrompt 签名**

`apps/desktop/src/preload/index.ts` 中:

```typescript
// 旧:
sendPrompt: (message: string, sessionId?: string) => {
    return ipcRenderer.invoke('pi:prompt', message, sessionId);
},

// 新:
sendPrompt: (workspaceId: string, message: string) => {
    return ipcRenderer.invoke('pi:send', workspaceId, message);
},
```

并加一个新方法:

```typescript
respondApproval: (requestId: string, approved: boolean) => {
    ipcRenderer.send('approval:respond', requestId, approved);
},
```

- [ ] **Step 2: TypeScript 编译**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/preload/index.ts
git commit -m "refactor(preload): sendPrompt takes workspaceId, add respondApproval"
```

---

## Task 12: 修 Cwd bug (renderer 端发 workspaceId)

**Files:**
- Modify: `apps/desktop/src/renderer/src/hooks/usePiStream.ts:432` (startStreaming 里的 sendPrompt 调用)
- Modify: `apps/desktop/src/renderer/src/hooks/usePiStream.ts:450` (stopStreaming)

- [ ] **Step 1: 改 startStreaming**

`apps/desktop/src/renderer/src/hooks/usePiStream.ts`:

```typescript
// 旧:
window.piAPI.sendPrompt(content).catch(...)

// 新:
const ws = useWorkspaceStore.getState().getCurrentWorkspace();
if (!ws) {
    setError("未选择 workspace");
    return;
}
window.piAPI.sendPrompt(ws.id, content).catch(...)
```

- [ ] **Step 2: TypeScript 编译**

Run: `cd apps/desktop && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/hooks/usePiStream.ts
git commit -m "fix(chat): usePiStream sends workspaceId so Pi runs in workspace cwd"
```

**Note**: 这是关键 bug 修复 — Pi 现在跑在用户选的 workspace 目录, 不再跑在 Electron 进程 cwd。

---

## Task 13: HighRiskModal 组件

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ApprovalPanel/HighRiskModal.tsx`
- Modify: `apps/desktop/src/renderer/src/stores/approval-store.ts:43` (加 pendingHighRiskRequests)

- [ ] **Step 1: 改 approval-store 加 high-risk 队列**

`apps/desktop/src/renderer/src/stores/approval-store.ts`:

加新字段:
```typescript
interface ApprovalState {
    // ... 现有字段
    pendingHighRisk: Map<string, { toolName: string; preview: string; method: string; title: string; message?: string }>;
    addHighRiskRequest: (id: string, req: { toolName: string; preview: string; method: string; title: string; message?: string }) => void;
    removeHighRiskRequest: (id: string) => void;
}
```

加 action:
```typescript
addHighRiskRequest: (id, req) => {
    set((s) => {
        const newMap = new Map(s.pendingHighRisk);
        newMap.set(id, req);
        return { pendingHighRisk: newMap };
    });
},
removeHighRiskRequest: (id) => {
    set((s) => {
        const newMap = new Map(s.pendingHighRisk);
        newMap.delete(id);
        return { pendingHighRisk: newMap };
    });
},
```

- [ ] **Step 2: 写 HighRiskModal**

`apps/desktop/src/renderer/src/components/ApprovalPanel/HighRiskModal.tsx`:

```tsx
import { useEffect } from "react";
import { useApprovalStore } from "../../stores/approval-store";

export function HighRiskModal(): JSX.Element | null {
    const pending = useApprovalStore((s) => Array.from(s.pendingHighRisk.entries()));
    const remove = useApprovalStore((s) => s.removeHighRiskRequest);

    useEffect(() => {
        const handler = (_event: any, data: { workspaceId: string; payload: { requestId: string; method: string; title: string; message?: string } }) => {
            useApprovalStore.getState().addHighRiskRequest(data.payload.requestId, {
                toolName: data.payload.title,
                preview: data.payload.message ?? "",
                method: data.payload.method,
                title: data.payload.title,
                message: data.payload.message,
            });
        };
        window.piAPI?.onPiJsonEvent?.(handler as any);
        // 实际应该用专门的 onApprovalRequest API
        return () => {};
    }, []);

    if (pending.length === 0) return null;
    const [requestId, req] = pending[0];

    const respond = (approved: boolean) => {
        window.piAPI.respondApproval(requestId, approved);
        remove(requestId);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
                <h2 className="text-lg font-semibold mb-2">⚠️ {req.title}</h2>
                <pre className="bg-gray-50 rounded p-3 text-sm overflow-auto max-h-48 mb-4">
                    {req.preview}
                </pre>
                <div className="flex justify-end gap-2">
                    <button
                        onClick={() => respond(false)}
                        className="px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
                    >
                        拒绝
                    </button>
                    <button
                        onClick={() => respond(true)}
                        className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
                    >
                        允许 (按 Y)
                    </button>
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: 挂到 App.tsx**

`apps/desktop/src/renderer/src/App.tsx` 加 import + 渲染:

```tsx
import { HighRiskModal } from "./components/ApprovalPanel/HighRiskModal";

// 在 return 里加:
<HighRiskModal />
```

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/src/components/ApprovalPanel/HighRiskModal.tsx apps/desktop/src/renderer/src/stores/approval-store.ts apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(approval): HighRiskModal blocking dialog for high-risk tool calls"
```

---

## Task 14: EditReviewList (事后 diff 审批)

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ApprovalPanel/EditReviewList.tsx` (已有, 完善)

- [ ] **Step 1: 检查现有 ChangeApprovalCard 组件**

Read: `apps/desktop/src/renderer/src/components/ApprovalPanel/ChangeApprovalCard.tsx`

If 渲染逻辑已经够用 (显示 diff, approve/reject 按钮), skip this task.
Else: 加 onUndo 调用 `git checkout -- <file>` (需要新 IPC handler)。

- [ ] **Step 2: 在 chat.ipc.ts 加 git:undo IPC**

`apps/desktop/src/main/ipc/chat.ipc.ts` 末尾加:

```typescript
ipcMain.handle("git:undo", async (_event, workspacePath: string, filePath: string) => {
    const { execSync } = await import("child_process");
    try {
        execSync(`git checkout -- "${filePath}"`, { cwd: workspacePath });
    } catch {
        // 文件可能是新建的 (untracked), 改用 rm
        try {
            execSync(`rm "${filePath}"`, { cwd: workspacePath });
        } catch {}
    }
});
```

- [ ] **Step 3: 在 preload 暴露**

`apps/desktop/src/preload/index.ts`:

```typescript
gitUndo: (workspacePath: string, filePath: string) => ipcRenderer.invoke("git:undo", workspacePath, filePath),
```

- [ ] **Step 4: ChangeApprovalCard 调 undo**

`apps/desktop/src/renderer/src/components/ApprovalPanel/ChangeApprovalCard.tsx`:

```tsx
const handleUndo = async () => {
    if (!workspacePath) return;
    await window.piAPI.gitUndo(workspacePath, change.filePath);
    onApprove(change.id); // 移除卡片
};
```

加按钮:
```tsx
<button onClick={handleUndo} className="...">撤销</button>
```

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/ApprovalPanel/ apps/desktop/src/preload/index.ts apps/desktop/src/main/ipc/chat.ipc.ts
git commit -m "feat(approval): EditReviewList with undo via git checkout"
```

---

## Task 15: E2E 冒烟测试

**Files:**
- Create: `apps/desktop/src/test/e2e/chat.test.ts` (用 vitest + 模拟)

- [ ] **Step 1: 写 e2e 测试**

```typescript
import { describe, it, expect, vi, beforeAll } from "vitest";

// 真实跑 AgentSession, 不 mock
describe("M1 e2e: chat + approval", () => {
    it("sends a prompt and receives text", async () => {
        // 用 fixture workspace 跑
        // 这测试需要 API key, 跳过 if not set
        if (!process.env.PI_TEST_API_KEY) {
            console.warn("PI_TEST_API_KEY not set, skipping");
            return;
        }
        // ... 实际跑
    }, 30000);
});
```

- [ ] **Step 2: 跑测试 (skip by default)**

Run: `cd apps/desktop && pnpm test --run e2e`
Expected: 跳过, 打印警告

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/test/e2e/
git commit -m "test: e2e smoke test for chat (skipped without API key)"
```

---

## Task 16: 整体验证 (manual smoke)

**Files:** 无 (人工验证)

- [ ] **Step 1: 启动 dev mode**

Run: `cd apps/desktop && pnpm dev`
Expected: Electron 窗口打开, 状态栏显示"已连接"

- [ ] **Step 2: 发简单消息**

Input: "Say 'hello' in one word"
Expected: 看到流式响应, 渲染 "hello"

- [ ] **Step 3: 测高危工具拦截**

Input: "Delete the file /tmp/test.txt"
Expected: 弹 HighRiskModal 模态, 拒绝后 Pi 收到 block 响应

- [ ] **Step 4: 测 file_edit 事后审批**

Input: "Write 'test' to src/test.txt"
Expected: Pi 执行完, EditReviewList 出现该文件的 diff 卡片, 点撤销后文件消失

- [ ] **Step 5: 切 workspace**

切换到另一个 workspace, 发消息.
Expected: 新 session 启动, cwd 是新 workspace 路径 (验证 M1 关键 bug 已修)

---

## 完成标准 (M1)

- [ ] 3 个 critical bug 全修: cwd 正确 / Pi 长连接 / 审批真拦
- [ ] 所有 vitest 单测通过 (classifier, pending-edits, factory, registry, event-bridge)
- [ ] 手动冒烟 (Task 16) 5 步全过
- [ ] `pnpm typecheck` 通过
- [ ] 16 个 commit, 每个任务一个

## 后续 (M2-M5)

- M2 计划: `@` 引用, 图片粘贴, Ctrl+K CommandPalette
- M3 计划: Skills 面板 + SkillHub 适配器
- M4 计划: node-pty + xterm 终端
- M5 计划: 测试覆盖 / CI / auto-update / 仓库清理
