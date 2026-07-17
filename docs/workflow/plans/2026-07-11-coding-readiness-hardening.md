# Coding Readiness Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use workflow:subagent-driven-development (recommended) or workflow:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Pi Desktop suitable for supervised daily coding by enforcing desktop tool permissions in the main process, making Plan mode non-bypassable, persisting native Pi sessions, and proving the contracts with real Electron tests.

**Architecture:** Add a session-scoped runtime policy controller in the Electron main process. It filters Pi's active tool list with `AgentSession.setActiveToolsByName()` and wraps built-in tools created by the Pi SDK so file, shell, and Git decisions are checked immediately before execution. Native Pi JSONL paths are derived deterministically from the desktop session ID so reopening a desktop conversation restores the actual AgentSession, not only rendered messages.

**Tech Stack:** Electron 41, React 19, TypeScript 5, Zustand 5, Pi Coding Agent SDK 0.75.5, pi-permission-system 0.6.0, Vitest 4, Playwright Electron, pnpm 9

---

## Scope And Decisions

- Desktop `ToolPermissions` become enforced policy. Prompt text remains explanatory only.
- `pi-permission-system` remains the interactive `ask` provider and project/global policy layer. Pi Desktop does not patch or fork the package.
- Pi SDK `setActiveToolsByName()` is the coarse deny layer for all built-in, extension, and custom tools.
- SDK tool definitions created with `createReadToolDefinition`, `createWriteToolDefinition`, `createEditToolDefinition`, and `createBashToolDefinition` are wrapped for execution-time checks.
- Plan mode exposes read tools and dedicated plan tools, but removes generic `bash`, `write`, and `edit`. Plan files must be authored through `plan_write` or desktop plan IPC.
- The Workbench terminal remains user-controlled full local access. Its UI must not imply that agent tool permissions sandbox it.
- Native session files live under `<userData>/pi-sessions/<desktop-session-id>.jsonl` and are opened through `SessionManager.open()`.

## File Map

**Create:**

- `apps/desktop/src/main/services/permission/runtime-policy.ts` - converts desktop settings, session overrides, and agent mode into one effective policy.
- `apps/desktop/src/main/services/permission/tool-category.ts` - classifies Pi tool names and Bash commands into desktop permission categories.
- `apps/desktop/src/main/services/permission/guarded-tools.ts` - wraps Pi built-in tool definitions and denies calls before execution.
- `apps/desktop/src/main/services/permission/__tests__/runtime-policy.test.ts` - policy merge and tool filtering tests.
- `apps/desktop/src/main/services/permission/__tests__/guarded-tools.test.ts` - execution-time deny tests.
- `apps/desktop/src/main/services/pi-session/session-path.ts` - deterministic, sanitized JSONL path resolver.
- `apps/desktop/src/main/services/pi-session/__tests__/session-path.test.ts` - path and traversal tests.
- `apps/desktop/e2e/permission-enforcement.spec.ts` - real Electron permission and Plan mode contract tests.
- `apps/desktop/e2e/session-resume.spec.ts` - real Electron native session reopen test.

**Modify:**

- `packages/shared-types/src/index.ts` - add the typed permission-sync result returned to the renderer.
- `apps/desktop/src/main/services/pi-session/factory.ts` - accept guarded built-ins and always open a supplied native session path.
- `apps/desktop/src/main/services/agent-runtime/registry.ts` - resolve effective policy, apply active tools before every prompt, and expose sync.
- `apps/desktop/src/main/index.ts` - inject settings/session lookup and native session path resolver.
- `apps/desktop/src/main/ipc/agents.ipc.ts` - add `agents:sync-permissions`.
- `apps/desktop/src/main/ipc/schemas.ts` - validate permission-sync input.
- `apps/desktop/src/preload/index.ts` - expose typed permission sync.
- `apps/desktop/src/renderer/src/stores/agent-store.ts` - call permission sync for the current agent.
- `apps/desktop/src/renderer/src/components/ToolPermissions/ToolPermissionsPanel.tsx` - persist, sync runtime, and report the actual result.
- `apps/desktop/src/renderer/src/hooks/usePiStream.ts` - retain the explanatory permission block but remove any claim that it is enforcement.
- `apps/desktop/src/renderer/src/components/Terminal/TerminalPanel.tsx` - display concise full-local-access trust text.
- `apps/desktop/src/main/services/agent-modes/agent-info.ts` - align Plan policy documentation with the enforced tool set.
- `apps/desktop/src/main/services/agent-modes/__tests__/agent-info.test.ts` - remove the test that accepts unrestricted Plan Bash.
- `.github/workflows/ci.yml` - run the new permission and resume Electron specs in the existing E2E job.

### Task 1: Define The Effective Runtime Policy

**Files:**
- Create: `apps/desktop/src/main/services/permission/runtime-policy.ts`
- Create: `apps/desktop/src/main/services/permission/tool-category.ts`
- Test: `apps/desktop/src/main/services/permission/__tests__/runtime-policy.test.ts`

- [ ] **Step 1: Write failing policy tests**

```ts
it("session permissions override workspace defaults", () => {
  const policy = resolveRuntimePolicy({
    mode: "build",
    workspacePermissions: allEnabled,
    sessionPermissions: { ...allEnabled, shell: false },
  });
  expect(policy.permissions.shell).toBe(false);
});

it("plan mode always removes generic mutation tools", () => {
  const policy = resolveRuntimePolicy({ mode: "plan", workspacePermissions: allEnabled });
  expect(filterActiveTools(["read", "bash", "write", "edit", "plan_write"], policy))
    .toEqual(["read", "plan_write"]);
});

it("git-disabled blocks git commands without disabling non-git shell", () => {
  const policy = resolveRuntimePolicy({
    mode: "build",
    workspacePermissions: { ...allEnabled, git: false },
  });
  expect(checkBashCommand("git status", policy).allowed).toBe(false);
  expect(checkBashCommand("pnpm test", policy).allowed).toBe(true);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/permission/__tests__/runtime-policy.test.ts
```

Expected: FAIL because `resolveRuntimePolicy`, `filterActiveTools`, and `checkBashCommand` do not exist.

- [ ] **Step 3: Implement the policy types and category mapping**

```ts
export interface RuntimeToolPolicy {
  mode: AgentMode;
  permissions: ToolPermissions;
  immutableDeniedTools: ReadonlySet<string>;
}

const PLAN_DENIED = new Set(["bash", "write", "edit", "apply_patch", "multiedit"]);
const NETWORK_TOOLS = new Set(["webfetch", "websearch", "fetch", "http"]);
const CORE_TOOLS = new Set(["read", "grep", "find", "ls", "write", "edit", "bash"]);

export function resolveRuntimePolicy(input: RuntimePolicyInput): RuntimeToolPolicy {
  return {
    mode: input.mode,
    permissions: input.sessionPermissions ?? input.workspacePermissions,
    immutableDeniedTools: input.mode === "plan" ? PLAN_DENIED : new Set(),
  };
}
```

`filterActiveTools()` must apply these rules:

- `fileRead=false`: remove `read`, `grep`, `find`, `ls`.
- `fileWrite=false`: remove `write`, `edit`, `apply_patch`, `multiedit`.
- `shell=false`: remove `bash` and `shell`.
- `network=false`: remove known network tools and names containing `web`, `http`, or `fetch`.
- `extensions=false`: remove non-core tools except mode-required tools such as `plan_write` in Plan mode.
- Plan immutable denies run last and cannot be relaxed by session settings.

- [ ] **Step 4: Run the tests and confirm GREEN**

Run the Task 1 test command. Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/main/services/permission/runtime-policy.ts apps/desktop/src/main/services/permission/tool-category.ts apps/desktop/src/main/services/permission/__tests__/runtime-policy.test.ts
git commit -m "feat(permission): define enforced runtime tool policy"
```

### Task 2: Guard Built-In Tools Before Execution

**Files:**
- Create: `apps/desktop/src/main/services/permission/guarded-tools.ts`
- Test: `apps/desktop/src/main/services/permission/__tests__/guarded-tools.test.ts`
- Modify: `apps/desktop/src/main/services/pi-session/factory.ts`

- [ ] **Step 1: Write failing wrapper tests**

```ts
it("does not call the original write tool when fileWrite is disabled", async () => {
  const execute = vi.fn();
  const guarded = guardToolDefinition(fakeTool("write", execute), () => policy({ fileWrite: false }));
  await expect(guarded.execute("call-1", { path: "src/a.ts", content: "x" }, signal, update, ctx))
    .rejects.toThrow("File writes are disabled");
  expect(execute).not.toHaveBeenCalled();
});

it("blocks git hidden inside PowerShell syntax", async () => {
  const guarded = guardToolDefinition(fakeTool("bash", execute), () => policy({ shell: true, git: false }));
  await expect(run(guarded, { command: "& git status" })).rejects.toThrow("Git commands are disabled");
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:
```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/permission/__tests__/guarded-tools.test.ts
```

- [ ] **Step 3: Implement wrappers around Pi SDK definitions**

Use the exported SDK factories:

```ts
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
```

`createGuardedBuiltins(cwd, getPolicy)` returns definitions with the same built-in names. Each wrapper checks the latest policy inside `execute`, then delegates to the original definition. File paths must also pass `getProtectedPathReason(target, cwd)`.

For Bash:

```ts
const decision = checkBashCommand(String(params.command ?? ""), getPolicy());
if (!decision.allowed) throw new Error(decision.reason);
return original.execute(toolCallId, params, signal, onUpdate, ctx);
```

- [ ] **Step 4: Pass guarded definitions as `customTools`**

In `factory.ts`, merge guarded built-ins before actor/custom tools. Definitions with built-in names intentionally override Pi defaults.

- [ ] **Step 5: Run targeted tests and typecheck**

```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/permission/__tests__/guarded-tools.test.ts
pnpm --filter @pi-desktop/desktop test src/main/services/pi-session/__tests__/factory.test.ts
pnpm --filter @pi-desktop/desktop typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/desktop/src/main/services/permission/guarded-tools.ts apps/desktop/src/main/services/permission/__tests__/guarded-tools.test.ts apps/desktop/src/main/services/pi-session/factory.ts apps/desktop/src/main/services/pi-session/__tests__/factory.test.ts
git commit -m "feat(permission): guard built-in tools before execution"
```

### Task 3: Apply Policy To Every Agent Turn

**Files:**
- Modify: `apps/desktop/src/main/services/agent-runtime/registry.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/ipc/agents.ipc.ts`
- Modify: `apps/desktop/src/main/ipc/schemas.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `packages/shared-types/src/index.ts`
- Test: `apps/desktop/src/main/services/agent-runtime/__tests__/registry.test.ts`
- Test: `apps/desktop/src/main/ipc/__tests__/agents.ipc.test.ts`

- [ ] **Step 1: Add failing registry tests**

```ts
it("filters active tools before prompting", async () => {
  deps.getEffectiveToolPermissions.mockReturnValue({ ...allEnabled, shell: false });
  await registry.prompt({ agentId, message: "inspect files", mode: "build" });
  expect(session.setActiveToolsByName).toHaveBeenCalledWith(expect.not.arrayContaining(["bash"]));
});

it("re-applies policy after switching to plan mode", async () => {
  await registry.prompt({ agentId, message: "make a plan", mode: "plan" });
  const tools = session.setActiveToolsByName.mock.calls.at(-1)?.[0];
  expect(tools).not.toContain("bash");
  expect(tools).not.toContain("write");
  expect(tools).toContain("plan_write");
});
```

- [ ] **Step 2: Implement policy lookup and application**

Add dependencies:

```ts
getEffectiveToolPermissions: (workspaceId: string, sessionId?: string) => ToolPermissions;
```

Before each prompt and after mode synchronization:

```ts
const allNames = runtime.session.session.getAllTools().map((tool) => tool.name);
const policy = this.resolvePolicy(runtime, targetMode);
runtime.policyController.set(policy);
runtime.session.session.setActiveToolsByName(filterActiveTools(allNames, policy));
```

The policy controller must be mutable so wrappers created with the session read the latest policy without recreating the AgentSession.

- [ ] **Step 3: Add `agents:sync-permissions`**

Contract:

```ts
agentsSyncPermissions(agentId: string): Promise<{ activeTools: string[]; deniedTools: string[] } | IpcError>;
```

The handler calls `registry.syncPermissions(agentId)` and returns the active/denied tool names for honest UI feedback.

- [ ] **Step 4: Run registry, IPC, preload, and type tests**

```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/agent-runtime/__tests__/registry.test.ts
pnpm --filter @pi-desktop/desktop test src/main/ipc/__tests__/agents.ipc.test.ts
pnpm --filter @pi-desktop/desktop test src/preload/__tests__/preload-surface.test.ts
pnpm -r typecheck
```

- [ ] **Step 5: Commit**

```powershell
git add packages/shared-types/src/index.ts apps/desktop/src/main/services/agent-runtime/registry.ts apps/desktop/src/main/index.ts apps/desktop/src/main/ipc/agents.ipc.ts apps/desktop/src/main/ipc/schemas.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/services/agent-runtime/__tests__/registry.test.ts apps/desktop/src/main/ipc/__tests__/agents.ipc.test.ts apps/desktop/src/preload/__tests__/preload-surface.test.ts
git commit -m "feat(permission): enforce policy on active agent sessions"
```

### Task 4: Make The Permission UI Report Runtime Truth

**Files:**
- Modify: `apps/desktop/src/renderer/src/stores/agent-store.ts`
- Modify: `apps/desktop/src/renderer/src/components/ToolPermissions/ToolPermissionsPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/hooks/usePiStream.ts`
- Test: `apps/desktop/src/renderer/src/components/ToolPermissions/ToolPermissionsPanel.test.tsx`

- [ ] **Step 1: Write a failing UI test**

```ts
it("syncs the current agent after persisting session permissions", async () => {
  await user.click(screen.getByLabelText("Bash / PowerShell"));
  expect(window.piAPI.agentsSyncPermissions).toHaveBeenCalledWith("agent-1");
  expect(await screen.findByRole("status")).toHaveTextContent("运行时已禁用 bash");
});
```

- [ ] **Step 2: Implement store and panel synchronization**

After persistence succeeds, resolve the current session agent and call `agentsSyncPermissions`. Do not show success until both persistence and runtime sync complete. If no live agent exists, report that the setting will apply when the next agent session starts.

- [ ] **Step 3: Keep prompt text as explanation only**

Change the permission block wording to:

```text
The host runtime enforces the disabled capabilities listed below. Do not request or attempt them.
```

- [ ] **Step 4: Run component tests**

```powershell
pnpm --filter @pi-desktop/desktop test src/renderer/src/components/ToolPermissions/ToolPermissionsPanel.test.tsx
pnpm --filter @pi-desktop/desktop test src/renderer/src/hooks/__tests__/usePiStream.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/src/renderer/src/stores/agent-store.ts apps/desktop/src/renderer/src/components/ToolPermissions/ToolPermissionsPanel.tsx apps/desktop/src/renderer/src/components/ToolPermissions/ToolPermissionsPanel.test.tsx apps/desktop/src/renderer/src/hooks/usePiStream.ts apps/desktop/src/renderer/src/hooks/__tests__/usePiStream.test.ts
git commit -m "fix(permission): synchronize UI settings with runtime policy"
```

### Task 5: Persist Native Pi Sessions By Desktop Session ID

**Files:**
- Create: `apps/desktop/src/main/services/pi-session/session-path.ts`
- Create: `apps/desktop/src/main/services/pi-session/__tests__/session-path.test.ts`
- Modify: `apps/desktop/src/main/services/agent-runtime/registry.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Test: `apps/desktop/src/renderer/src/App.test.tsx`

- [ ] **Step 1: Write failing path tests**

```ts
it("maps a desktop session id to one stable JSONL path", () => {
  expect(resolveNativeSessionPath("C:/user-data", "session-123"))
    .toBe("C:/user-data/pi-sessions/session-123.jsonl");
});

it("rejects traversal-shaped session ids", () => {
  expect(() => resolveNativeSessionPath("C:/user-data", "../auth"))
    .toThrow("Invalid desktop session id");
});
```

- [ ] **Step 2: Implement deterministic path resolution**

Only `[A-Za-z0-9._-]` is allowed in the filename. The main process creates the `pi-sessions` directory before `SessionManager.open(path)`.

- [ ] **Step 3: Inject the path when creating session-backed agents**

In `App.tsx`, keep imported Pi/Codex session paths when present. For ordinary desktop sessions, the main registry derives the path from `sessionId`; renderer code does not manufacture filesystem paths.

In `registry.ts`:

```ts
const nativePath = sessionPath ?? (input.sessionId ? deps.resolveNativeSessionPath(input.sessionId) : undefined);
const session = await this.createPrimarySession(workspace, id, nativePath);
```

- [ ] **Step 4: Verify restart hydration does not duplicate agents**

Add an App test that loads an existing desktop session, creates exactly one agent with its `sessionId`, and receives the deterministic path in the main registry test.

- [ ] **Step 5: Run targeted tests**

```powershell
pnpm --filter @pi-desktop/desktop test src/main/services/pi-session/__tests__/session-path.test.ts
pnpm --filter @pi-desktop/desktop test src/main/services/agent-runtime/__tests__/registry.test.ts
pnpm --filter @pi-desktop/desktop test src/renderer/src/App.test.tsx
```

- [ ] **Step 6: Commit**

```powershell
git add apps/desktop/src/main/services/pi-session/session-path.ts apps/desktop/src/main/services/pi-session/__tests__/session-path.test.ts apps/desktop/src/main/services/agent-runtime/registry.ts apps/desktop/src/main/index.ts apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx
git commit -m "feat(session): restore native pi context across restarts"
```

### Task 6: Clarify Terminal Trust Boundary

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/Terminal/TerminalPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/i18n/locales/zh-CN.json`
- Modify: `apps/desktop/src/renderer/src/i18n/locales/en.json`
- Test: `apps/desktop/src/renderer/src/components/Terminal/TerminalPanel.test.tsx`

- [ ] **Step 1: Add a failing trust-label test**

```ts
expect(screen.getByText("终端由你直接控制，拥有本机完整权限")).toBeVisible();
```

- [ ] **Step 2: Add the concise label beside the terminal tab controls**

The text must state that agent tool permissions do not sandbox this terminal. Do not add a modal or onboarding flow.

- [ ] **Step 3: Run the terminal test and commit**

```powershell
pnpm --filter @pi-desktop/desktop test src/renderer/src/components/Terminal/TerminalPanel.test.tsx
git add apps/desktop/src/renderer/src/components/Terminal/TerminalPanel.tsx apps/desktop/src/renderer/src/components/Terminal/TerminalPanel.test.tsx apps/desktop/src/renderer/src/i18n/locales/zh-CN.json apps/desktop/src/renderer/src/i18n/locales/en.json
git commit -m "docs(terminal): clarify full local access boundary"
```

### Task 7: Prove Enforcement In Real Electron

**Files:**
- Create: `apps/desktop/e2e/permission-enforcement.spec.ts`
- Create: `apps/desktop/e2e/session-resume.spec.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add permission enforcement E2E**

Use a deterministic test extension/tool fixture rather than a paid provider. The test must exercise the same policy controller and guarded tool wrapper used by production.

Required cases:

```ts
test("disabled write never reaches the underlying tool", async () => {
  const result = await invokeGuardedTool(page, "write", { path: "blocked.txt", content: "blocked" });
  expect(result.error).toContain("File writes are disabled");
  expect(await pathExists(workspacePath, "blocked.txt")).toBe(false);
});

test("git disabled blocks git status while allowing pnpm --version", async () => {
  expect((await invokeGuardedTool(page, "bash", { command: "git status" })).error)
    .toContain("Git commands are disabled");
  expect((await invokeGuardedTool(page, "bash", { command: "pnpm --version" })).error)
    .toBeUndefined();
});

test("plan mode removes bash/write/edit and keeps read/plan_write", async () => {
  const result = await syncPolicy(page, "plan");
  expect(result.activeTools).toEqual(expect.arrayContaining(["read", "plan_write"]));
  expect(result.activeTools).not.toEqual(expect.arrayContaining(["bash", "write", "edit"]));
});

test("always mode does not override an immutable Plan deny", async () => {
  await page.evaluate(() => window.piAPI.permissionSetMode("always"));
  const result = await invokeGuardedTool(page, "write", { path: "plan-bypass.txt", content: "blocked" });
  expect(result.error).toContain("Plan mode");
  expect(await pathExists(workspacePath, "plan-bypass.txt")).toBe(false);
});
```

- [ ] **Step 2: Add native session resume E2E**

1. Launch with a fresh userData directory.
2. Create a workspace and desktop session.
3. Append a marker through the native Pi `SessionManager` path.
4. Close and relaunch.
5. Open the same desktop session and assert the AgentSession reports the same `sessionFile` and hydrated marker.

- [ ] **Step 3: Run build and the two specs**

```powershell
pnpm --filter @pi-desktop/desktop build
pnpm --filter @pi-desktop/desktop e2e -- permission-enforcement.spec.ts session-resume.spec.ts
```

Expected: all tests PASS on Windows.

- [ ] **Step 4: Run the mandatory full gate**

```powershell
pnpm -r typecheck && pnpm -r lint && pnpm -r test
pnpm --filter @pi-desktop/desktop build
pnpm --filter @pi-desktop/desktop e2e
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/desktop/e2e/permission-enforcement.spec.ts apps/desktop/e2e/session-resume.spec.ts .github/workflows/ci.yml
git commit -m "test(security): enforce coding permission and resume contracts"
```

## Acceptance Criteria

- Disabling a permission changes the actual active tool list before the next turn.
- Built-in write/read/bash wrappers read the latest policy and deny before calling the original tool.
- `git=false` blocks Git commands even when `shell=true`.
- Plan mode cannot run generic Bash or generic file mutation tools, including in `always` permission mode.
- Session permissions override workspace defaults; Plan immutable denies override both.
- Reopening a desktop session opens the same Pi JSONL session file.
- UI success messages are based on main-process sync results, not optimistic persistence alone.
- Workbench terminal explicitly states that it is user-controlled full local access.
- Typecheck, lint, unit tests, build, and Electron E2E all pass in the repository-mandated order.

## Self-Review

- Spec coverage: P1 tool enforcement, P1 mode enforcement, P2 session restoration, P2 E2E coverage, and terminal trust wording each have a dedicated task.
- Type consistency: `RuntimeToolPolicy`, `resolveRuntimePolicy`, `filterActiveTools`, `checkBashCommand`, and `agentsSyncPermissions` use the same names throughout.
- Dependency fit: the plan uses APIs verified in installed Pi SDK 0.75.5: built-in tool definition factories, `getAllTools()`, and `setActiveToolsByName()`.
- Scope control: no pi-permission-system fork, no renderer sandbox claim, no unrelated large-file refactor.
