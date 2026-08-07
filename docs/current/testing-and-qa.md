# Testing and QA

> **Current verification contract.** This page separates the checks that run in CI from evidence that requires a built Electron app, a packaged installer, a real provider, or an isolated Windows machine.

## Repository gate

The current CI job runs on `windows-latest` and executes these workspace checks after a frozen install, in the required order:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm --filter @pi-desktop/desktop test:coverage
pnpm verify:docs
pnpm --filter @pi-desktop/desktop build
node scripts/smoke-main-runtime.cjs
```

Coverage currently enforces conservative global thresholds from the checked-in baseline: 75% statements, 65% branches, 75% functions, and 77% lines.

The root `verify:docs` command is a read-only, offline check for current documentation facts. Lefthook pre-commit runs typecheck and lint; pre-push runs the desktop unit test and coverage commands.

## Test layers

| Layer | What it proves | Typical command | Boundary |
| --- | --- | --- | --- |
| Typecheck | Type contracts compile | `pnpm -r typecheck` | Does not run the app |
| Lint | ESLint rules pass | `pnpm -r lint` | Does not prove runtime behavior |
| Unit/integration | Main services, IPC handlers, stores, renderer logic, persistence contracts | `pnpm -r test` | Uses mocks/fixtures; no real installer lifecycle |
| Main runtime smoke | Built main bundle has unique IPC setup and can be inspected without a full UI run | `node scripts/smoke-main-runtime.cjs` | Not a complete Electron acceptance |
| Electron E2E | Compiled Electron behavior and visible UI flows | `pnpm --filter @pi-desktop/desktop e2e:build` | Depends on Windows runtime, fixtures, and configured environment |
| Packaged artifact | NSIS/unpacked output and required update metadata | `pnpm --filter @pi-desktop/desktop package` | Build success is not install/upgrade proof |
| Isolated Windows lifecycle | Install, launch, upgrade, uninstall, data retention | `scripts/nsis-sandbox-smoke.ps1` in Windows Sandbox/disposable VM | Current maintained host is blocked for this work |

## Current CI versus release workflow

CI now runs the repository gate, coverage, documentation facts, desktop build, and main-runtime smoke. It does not run the full Electron E2E suite, NSIS packaging, or isolated install/upgrade/uninstall.

The tag-triggered release workflow adds desktop build, main runtime smoke, NSIS packaging, and artifact inventory. Updater-enabled builds require `PI_DESKTOP_ENABLE_AUTO_UPDATE=1`; the workflow also requires signing secrets and publishes the installer, blockmap, and `latest.yml` through GitHub Releases. Read [../RELEASE-AND-AUTO-UPDATE.md](../RELEASE-AND-AUTO-UPDATE.md) for the release procedure.

## Electron E2E expectations

Run E2E after a fresh desktop build when a change affects renderer surfaces, window lifecycle, IPC-visible behavior, chat streaming, permissions, settings, Compose, or packaging-adjacent runtime behavior. Playwright drives compiled Electron directly; it is not a browser-only test.

Chat chrome regressions to cover when touching layout/Git rail/session list:

- left collapse leaves no full-height seam/gutter; expand/collapse control remains reachable from the center workspace;
- right rail open shows **Git 工具** (not the old always-on progress empty state when no goal/plan exists);
- **变更** opens the in-chat changes overlay (`git-changes-overlay`) with file rows, not a forced navigation to the workbench Git panel;
- workspace group headers expand/collapse only and do not switch workspace or select a session; session jump requires clicking a session row;
- workspace group **+** creates a new conversation after switching workspace;
- unit coverage lives in `MiniMaxCodeLayout`, `RightRail`, `GitRailControls`, `GitChangesOverlay`, `SessionRow`, and `ProjectGroupedSessionList` tests; E2E hooks include `right-rail-git-workflow`, `main-token-stats`, smoke/visual-audit right-rail entry points.

Composer (chat input) regressions when touching `ChatInput` / global composer mount / message scroll:

- reference shell stays fixed height under long paste; textarea scrolls; controls stay below the text body with a small gap and no hard divider;
- shell background is opaque (dialogue must not show through);
- attachment chips render **above** the shell as a horizontal rail, not inside the fixed body;
- resize updates `--pi-global-composer-height` and keeps stick-to-bottom messages pushed up rather than under the shell;
- image send stages the user bubble immediately; vision-capable models direct-send `images` without describe; text-only models show describing status and inject caption text; failure restores draft/attachments and removes the staged bubble; history can reload thumbnails from `session-attachments`;
- unit coverage: `ChatInput.test.tsx`, `useInputText.test.tsx`; E2E: `e2e/composer-layout.spec.ts` (build first); optional CDP helper `scripts/electron-composer-qa.mjs`;
- product contract: [composer-layout.md](composer-layout.md).

Use isolated fixtures for providers and workspaces. A test that needs a real API key, a real network marketplace, or an existing user installation must declare that prerequisite and must not turn an unavailable environment into a product PASS.

For UI changes, preserve useful acceptance screenshots under `docs/compose/acceptance/` when the existing test convention calls for them. Screenshots are evidence, not a substitute for an executable test.

## NSIS isolation status

NSIS build output is currently verifiable, but install/upgrade/uninstall isolation is not currently green on the maintained developer host. The host is not elevated, Windows Sandbox is unavailable, Docker is unavailable, and a Pi Desktop installation is already present. The safety scripts intentionally refuse to mutate that host.

Until a disposable Windows Sandbox, administrator-controlled VM, or equivalent clean machine is available, K-004 (uninstall), K-014 (install), and K-015 (upgrade) remain `BLOCKED`/`NOT_RUN`. Do not promote them to PASS from `win-unpacked`, artifact inventory, or unit tests.

The safe sequence when isolation is available is:

1. run the capability probe;
2. mount or copy only the needed artifacts and scripts into the isolated environment;
3. run the NSIS smoke script with an evidence directory;
4. retain the machine/version/installer hashes and summary output;
5. record each matrix item as PASS, FAIL, BLOCKED, or NOT_RUN.

## QA reporting rules

A report must identify:

- source version and Electron version;
- platform and Node/pnpm versions;
- exact commands and whether they were built or packaged;
- counts for pass/fail/flaky/skipped where available;
- fixture/provider prerequisites;
- isolation status for install lifecycle tests;
- the remaining failures and whether they are product, test-contract, or environment issues.

Do not call a release “fully passed” when CI is green but E2E, updater install, or NSIS isolation evidence is missing. Use `Conditional`, `Not Ready`, `BLOCKED`, or `NOT_RUN` explicitly.

## Current source of truth

Version `1.0.14`, Electron `41.2.0`, the 24-file IPC count, active `node:sqlite` persistence, Compose limits, and the current CI/NSIS boundaries are maintained in [facts.md](facts.md). Older dated matrices, QA reports, roadmap pages, and runbooks remain useful evidence/history but do not override this page.
