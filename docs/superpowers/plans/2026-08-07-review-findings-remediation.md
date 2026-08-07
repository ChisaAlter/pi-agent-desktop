# Review Findings Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and implement each task with a red-green cycle.

**Goal:** Close the confirmed security, IPC-contract, and renderer race findings from the full-project review without changing unrelated composer work.

**Architecture:** Renderer calls that carry filesystem authority will be resolved against the main-process workspace store instead of trusting a caller-selected root. User-facing async flows will reject structured IPC failures and use request/state-aware updates. IPC schemas will enforce limits before expensive work and all slow child processes will be asynchronous.

**Tech Stack:** Electron 41, React 19, TypeScript 5, Zustand 5, Zod, Vitest 4.

## Global Constraints

- Preserve the existing dirty changes in `ChatInput.tsx`, `globals.css`, `composer-prototype-output/`, and `e2e/vision-*.tmp.spec.ts`.
- Follow `docs/security/PERMISSION-MATRIX.md`: the main process is authoritative for workspace ownership.
- Return `ipcError()` for request-response validation failures.
- Add a failing regression test before every production behavior change.
- Run `pnpm -r typecheck && pnpm -r lint && pnpm -r test` in that order after targeted tests pass.

---

### Task 1: Bind privileged filesystem and shell actions to registered workspaces

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/ipc/files.ipc.ts`
- Modify: `apps/desktop/src/main/ipc/project-shell.ipc.ts`
- Modify: `apps/desktop/src/main/ipc/git.ipc.ts`
- Modify only if the bridge contract requires it: `apps/desktop/src/preload/index.ts`
- Modify only if the bridge contract requires it: `packages/shared-types/src/index.ts`
- Test: corresponding files under `apps/desktop/src/main/ipc/__tests__/`
- Test: `apps/desktop/src/renderer/src/utils/__tests__/generated-ui.test.ts`

**Interfaces:**
- Consume the main-process workspace list as the source of truth.
- Produce a reusable resolver that accepts a renderer path and returns the canonical registered workspace path or an `IpcError`.
- Keep existing renderer call signatures where possible; compatibility must not reintroduce caller-selected authority.

- [ ] Add negative tests showing an unregistered root cannot list/write files or run Git/project operations.
- [ ] Run the tests and confirm they fail because ownership is not checked.
- [ ] Inject a registered-workspace resolver into file, project-shell, and Git IPC setup; canonicalize and compare paths before operation-specific guards.
- [ ] Add a generated-UI/shell regression test that rejects executable and workspace-external model targets while preserving normal workspace file opening and HTTP(S) URL opening.
- [ ] Run the focused IPC and generated-UI tests until green.

### Task 2: Make renderer async state transitions race-safe

**Files:**
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/usePiStream.ts`
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/components/SessionCenter/SessionCenter.tsx`
- Modify: `apps/desktop/src/renderer/src/stores/workspace-store.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/useMentions.ts`
- Test: `apps/desktop/src/renderer/src/hooks/usePiStream.test.tsx`
- Test: renderer store/navigation/mention tests adjacent to the production files

**Interfaces:**
- `agentsPrompt` returns `Promise<void | IpcError>`.
- Cross-workspace navigation switches workspace before selecting the target session.
- Workspace delete rollback merges the removed record into current state instead of restoring a full snapshot.
- Mention results commit only when their request generation is still current.

- [ ] Add a test where `agentsPrompt` resolves `IpcError`; assert streaming ends and the send rejects/surfaces the failure.
- [ ] Add cross-workspace session navigation tests that assert the requested session remains selected.
- [ ] Add a deferred-delete test that mutates workspace state before a failed delete and asserts the newer mutation survives.
- [ ] Add out-of-order mention search tests for query and workspace changes.
- [ ] Run the new tests and confirm the expected failures.
- [ ] Implement the four minimal state/contract fixes and rerun the focused renderer tests.

### Task 3: Harden skill import, image limits, and remaining IPC validation

**Files:**
- Modify: `apps/desktop/src/main/ipc/skills.ipc.ts`
- Modify: `apps/desktop/src/main/ipc/sessions.ipc.ts`
- Modify: `apps/desktop/src/main/ipc/config.ipc.ts`
- Modify: `apps/desktop/src/main/ipc/git.ipc.ts`
- Modify: `apps/desktop/src/main/ipc/helpers.ts`
- Test: corresponding files under `apps/desktop/src/main/ipc/__tests__/`

**Interfaces:**
- Git clone is asynchronous, has a 60-second timeout, and cleans staging/hooks directories on every outcome.
- Skill URL validation either supports the advertised SSH form without applying an HTTP-only guard or removes that advertised form consistently.
- Base64/data-URL schemas reject payloads above the 5 MiB decoded-size envelope before `Buffer.from` or model dispatch.
- `git:log` and `git:branches` use their checked-in schemas.
- Session importer validation returns structured errors.

- [ ] Add tests proving clone does not use a synchronous process API and HTTPS/SSH validation is internally consistent.
- [ ] Add oversized attachment and describe-image tests that assert rejection before service invocation.
- [ ] Add invalid Git log/count and importer argument tests that expect `IpcError`.
- [ ] Run the tests and confirm they fail for the reviewed behavior.
- [ ] Implement asynchronous clone, bounded schemas, connected Git schemas, and structured importer errors.
- [ ] Run all focused main-process tests until green.

### Task 4: Integration verification

**Files:**
- Modify only files required by failures caused by Tasks 1-3.

- [x] Review the combined diff for overlapping IPC types and setup signatures.
- [x] Run targeted tests for every modified module.
- [x] Run `pnpm -r typecheck`.
- [x] Run `pnpm -r lint`.
- [x] Run `pnpm -r test`.
- [x] Run `pnpm verify:docs` because the implementation changes documented IPC/security facts.
- [x] Record any environment-only test runner failure separately from assertion failures.
