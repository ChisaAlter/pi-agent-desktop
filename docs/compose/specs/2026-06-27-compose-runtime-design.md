# Pi Desktop Compose Runtime Alignment

> **Historical / Superseded design snapshot.** The Compose runtime described here has since been implemented with known limits. Use [`../../current/facts.md`](../../current/facts.md) and [`../../current/architecture.md`](../../current/architecture.md) for current behavior.

## [S1] Problem

Current `Pi Desktop` Compose mode is not a real workflow runtime.

- `apps/desktop/extensions/compose-mode/index.ts` only registers status/UI state, prompt injection, and slash commands.
- `apps/desktop/src/main/services/mimocode-runtime-port.ts` still reports `workflow` as `unsupported`.
- `apps/desktop/src/main/services/agent-runtime/registry.ts` switches Compose by sending `/compose on` or `/compose off`, but there is no executable workflow tool behind it.
- `packages/shared-types/src/index.ts` and settings UI already carry `workflow` and `composeWorkflow` fields, but the desktop runtime does not honor them.

The result is a mode that looks like Compose from the UI but behaves like a prompt wrapper. That is not enough for the requested “完整 Compose 模式/runtime”.

## [S2] Goal

Implement the closest practical desktop equivalent of MiMoCode Compose by using the existing Pi SDK extension system as the runtime host.

The target is:

1. A real `workflow` tool exists inside the desktop-loaded extension bundle.
2. The tool supports a built-in `compose` workflow, not just prompt wrapping.
3. Compose mode uses that workflow runtime when the corresponding long-horizon switches are enabled.
4. Phase progress, task progress, artifacts, verification, and merge/report outcomes become real runtime behavior.
5. Desktop settings and runtime capability reporting reflect the truth.

## [S3] Scope

### In Scope

- Real desktop `workflow` capability for the built-in `compose` workflow
- Compose orchestration phases:
  - `Brainstorm`
  - `Design`
  - `Implement`
  - `Verify`
  - `Review`
  - `Report`
  - `Merge`
- Worktree-backed isolation for independent implementation tasks when the workspace is a Git repo
- Artifact writing under `docs/compose/specs`, `docs/compose/plans`, and `docs/compose/reports`
- Runtime capability plumbing across main/preload/renderer/settings
- Unit tests plus real Electron acceptance coverage

### Explicitly Out of Scope for This Iteration

- Arbitrary user-supplied JS workflow scripts
- QuickJS sandbox parity with upstream MiMoCode `opencode`
- Full `dream` / `distill` / autonomous background agents
- Cross-process workflow persistence across full app restart

Those remain future work. The desktop app must report them honestly instead of pretending they exist.

## [S4] User-Visible Target Behavior

When these switches are enabled together:

- `longHorizon.enabled`
- `longHorizon.composeMode.enabled`
- `longHorizon.workflow.enabled`
- `longHorizon.composeWorkflow.enabled`

the user-visible behavior becomes:

1. Selecting `Compose` mode still works from the existing mode picker.
2. Non-trivial Compose turns are guided toward a real `workflow` tool call instead of prompt-only orchestration.
3. The run emits visible phase progress and task progress.
4. Compose artifacts are written into the workspace:
   - `docs/compose/specs/*.md`
   - `docs/compose/plans/*.md`
   - `docs/compose/reports/*.md`
5. Verification and review are part of the runtime, not left implicit.
6. If the workspace is a Git repo, independent implementation tasks can run in isolated worktrees and merge back.
7. If Git or worktrees are unavailable, Compose degrades to sequential execution and reports the degraded mode honestly.

When `workflow` or `composeWorkflow` is disabled, Compose falls back to the current prompt/state behavior and runtime capability reporting must show that the real workflow runtime is off.

## [S5] Architecture

## [S5.1] Runtime Host Choice

The desktop app already loads Pi SDK extensions into the real `AgentSession`. That extension system is strong enough to host the Compose runtime because it can:

- register real LLM-callable tools
- subscribe to agent lifecycle events
- send UI status/progress
- spawn child `pi` processes
- execute shell / Git operations from Node

Because of that, the Compose runtime should live inside the desktop extension bundle, not in renderer-only logic and not as a fake IPC-only shim.

## [S5.2] Extension Layout

`apps/desktop/extensions/compose-mode` remains the bundle root, but it is split by responsibility:

- Existing mode layer:
  - `index.ts`
  - `commands.ts`
  - `events.ts`
  - `prompts.ts`
  - `state.ts`
- New workflow runtime layer:
  - `workflow-tool.ts`
  - `workflow-run-store.ts`
  - `compose-workflow.ts`
  - `child-agent.ts`
  - `git-worktree.ts`
  - `artifact-paths.ts`
  - `types.ts`

The current prompt/state layer remains useful as:

- Compose mode toggle state
- Phase directive shortcuts such as `compose:plan` and `compose:debug`
- UI fallback when workflow runtime is disabled

## [S5.3] Main-Process Plumbing

Main-process changes are limited to capability truth and extension loading.

### Extension loading

`apps/desktop/src/main/services/pi-session/factory.ts`

- Extend bundled desktop extension resolution so the Compose bundle loads when any of these require it:
  - `composeModeEnabled`
  - `workflowEnabled`
  - `composeWorkflowEnabled`

### Runtime capability reporting

`apps/desktop/src/main/services/mimocode-runtime-port.ts`

- `workflow` becomes `supported: true` when the Compose runtime bundle is available
- `workflow.enabled` follows actual settings and runtime availability
- `dream` and `distill` remain `unsupported`

### Settings/runtime bridge

- `chat.ipc.ts` keeps exposing runtime capability state, but now reports real workflow support
- renderer runtime feature store and settings UI must show `workflow` and `composeWorkflow` truthfully

## [S5.4] Workflow Tool Contract

The first desktop runtime supports the built-in `compose` workflow only.

Tool name:

- `workflow`

Operations:

- `run`
- `status`
- `wait`
- `cancel`

Run input shape:

```json
{
  "operation": "run",
  "name": "compose",
  "args": {
    "task": "user request",
    "type": "feature | bugfix | refactor | feedback",
    "maxConcurrent": 4,
    "skipReport": false,
    "isolateWorktrees": true
  }
}
```

Important constraints:

- `script` input is not supported in this iteration
- `name` must currently be `compose`
- `status/wait/cancel` operate on run ids stored in an in-memory run registry

## [S5.5] Compose Workflow Execution Model

The built-in desktop Compose workflow follows the same high-level sequence as MiMoCode, but is implemented with Pi SDK child-agent execution instead of upstream QuickJS runtime.

### Brainstorm

- Gather repo context from real files
- Read relevant docs / AGENTS / recent commits
- Produce a structured summary of project type, conventions, relevant files, and assumptions

### Design

- Produce or amend:
  - spec in `docs/compose/specs`
  - plan in `docs/compose/plans`
- Extract actionable tasks with dependencies

### Implement

- Execute tasks in topological order
- If multiple independent tasks exist and Git worktree support is available:
  - create one worktree per task
  - run isolated child implementation agents there
  - merge back after success
- Otherwise run sequentially in the current workspace

### Verify

- Run repo verification commands grounded in `AGENTS.md`
- Record actual pass/fail evidence

### Review

- Run a post-implementation review pass
- Separate must-fix findings from minor notes

### Report

- Write or update a report in `docs/compose/reports`

### Merge

- If configured to commit, create a local commit after review/verification pass
- If merge/commit is skipped or blocked, return the reason explicitly

## [S5.6] Child-Agent Execution

The runtime uses child `pi` executions for major phases instead of trying to run all phase reasoning inside one tool body.

Each child run must capture:

- phase label
- cwd / worktree path
- stdout/stderr or structured response
- success/failure status
- output summary

This keeps Compose execution auditable and closer to MiMoCode’s “workflow orchestrates multiple workers” model.

## [S5.7] Progress and State Integration

The runtime must sync visible progress into existing desktop surfaces.

### Required integrations

- footer/status text via extension UI
- `plan-todos` widget or equivalent phase/task list
- `TaskService` updates through the existing extension UI bridge path
- assistant-visible custom messages for workflow phase transitions and final summary

### Run registry

Each active run stores:

- `runId`
- `workflowName`
- `status`
- `currentPhase`
- `workspacePath`
- `task summaries`
- `artifacts`
- `startTime`
- `endTime`

Initial implementation may keep this registry in memory only.

## [S6] Compose Mode Integration

Compose mode should stop being “prompt-only unless the model happens to improvise”.

New behavior:

- `before_agent_start` prompt injection continues to annotate Compose mode
- when workflow runtime is enabled, the injected Compose instructions explicitly tell the model to call the `workflow` tool for non-trivial Compose tasks
- phase directive commands keep working:
  - `compose:debug` biases the next workflow run toward bugfix/debug behavior
  - `compose:plan` biases toward plan/spec-first behavior
  - `compose:report` biases toward report-only or report-focused behavior

Fallback behavior:

- if real workflow runtime is disabled, current prompt-based Compose remains active
- the mode must not falsely imply that a real workflow run occurred

## [S7] Settings and Capability Truth

Renderer settings currently expose only part of the long-horizon matrix.

Required changes:

- `LongHorizonTab.tsx` must expose:
  - `workflow`
  - `composeWorkflow`
- capability reporting must distinguish:
  - bundle unavailable
  - setting disabled
  - supported and enabled

The desktop must no longer advertise `workflow` as a live capability while keeping it permanently `unsupported`.

## [S8] Files to Modify or Create

### Modify

- `apps/desktop/extensions/compose-mode/index.ts`
- `apps/desktop/extensions/compose-mode/events.ts`
- `apps/desktop/extensions/compose-mode/prompts.ts`
- `apps/desktop/src/main/services/pi-session/factory.ts`
- `apps/desktop/src/main/services/agent-runtime/registry.ts`
- `apps/desktop/src/main/services/mimocode-runtime-port.ts`
- `apps/desktop/src/main/ipc/chat.ipc.ts`
- `apps/desktop/src/renderer/src/components/Settings/tabs/LongHorizonTab.tsx`
- `apps/desktop/src/renderer/src/stores/runtime-feature-store.ts`
- related tests and E2E specs

### Create

- `apps/desktop/extensions/compose-mode/types.ts`
- `apps/desktop/extensions/compose-mode/workflow-tool.ts`
- `apps/desktop/extensions/compose-mode/workflow-run-store.ts`
- `apps/desktop/extensions/compose-mode/compose-workflow.ts`
- `apps/desktop/extensions/compose-mode/child-agent.ts`
- `apps/desktop/extensions/compose-mode/git-worktree.ts`
- `apps/desktop/extensions/compose-mode/artifact-paths.ts`
- extension/runtime tests
- Electron Compose runtime acceptance spec

## [S9] Verification Strategy

### Unit / integration

- runtime feature state tests
- workflow tool input validation tests
- worktree fallback tests
- artifact path tests
- compose-mode integration tests for prompt/tool routing

### Electron acceptance

At minimum, add or update real Electron coverage for:

1. workflow/runtime toggles changing available behavior
2. Compose mode producing a real workflow-driven phase sequence
3. Compose artifacts appearing in the workspace
4. fallback behavior when workflow is disabled

### Real live acceptance

If a usable provider key exists in the local environment:

- run a real Compose-mode end-to-end acceptance on Windows Electron
- capture screenshots
- inspect resulting artifacts

## [S10] Risks and Mitigations

### Risk: worktree conflicts on dirty repos

Mitigation:

- detect Git/worktree support up front
- fall back to sequential execution when unsafe

### Risk: over-claiming parity with MiMoCode

Mitigation:

- keep arbitrary scripts, `dream`, and `distill` explicitly unsupported
- scope first release to built-in Compose only

### Risk: hidden prompt-only fallback

Mitigation:

- runtime feature state and Compose status messaging must tell the truth
- tests must distinguish workflow-backed Compose from prompt-only Compose

## [S11] Success Criteria

This design is considered implemented only when all of the following are true:

1. Desktop runtime feature state reports `workflow` as supported and enabled when configured.
2. Compose mode can trigger a real `workflow` tool run for non-trivial tasks.
3. The run emits visible phase/task progress and writes Compose artifacts.
4. Worktree isolation is real when Git allows it, and fallback is honest when it does not.
5. Unit tests pass.
6. Real Electron acceptance passes with screenshots.
7. Final code review confirms Compose is no longer just a prompt wrapper.
