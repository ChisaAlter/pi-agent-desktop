# Permission Matrix

> **Current security contract.** This matrix describes the enforced controls in the main process and Pi extension runtime. Approval UI is a review layer; it is not a replacement for immutable mode restrictions or path guards.

## Decision layers

1. **Tool availability:** runtime policy removes disabled categories from the active Pi tool list.
2. **Execution guard:** guarded built-ins re-check policy immediately before file or shell execution.
3. **Path guard:** canonical and lexical paths are checked against the workspace and protected-path rules.
4. **Risk classifier / approval:** read, edit, and high-risk calls receive their corresponding review behavior.
5. **Hard mode restrictions:** Plan mode restrictions are immutable and cannot be relaxed by a session or UI approval.

A rule that reaches the renderer is not permission to execute. The main process is authoritative.

## Tool-category matrix

| Category | Examples | Runtime setting | Build mode | Plan mode | Compose mode |
| --- | --- | --- | --- | --- | --- |
| File read | `read`, `grep`, `find`, `ls`, `glob` | `fileRead` | Allowed when enabled | Allowed when enabled | Allowed when enabled |
| File write/edit | `write`, `edit`, `apply_patch`, `multiedit` | `fileWrite` | Allowed when enabled, then path/risk checked | Generic write/edit tools immutably denied; plan-file exceptions only | Allowed when enabled, then path/risk checked; worktree hard rule may apply |
| Shell | `bash`, `shell` | `shell` | Allowed when enabled; command risk checked | Immutably denied | Allowed when enabled; command risk checked |
| Git | Git commands through shell and Git IPC | `git` plus shell for agent calls | Disabled when either relevant setting is false; Git IPC also validates workspace inputs | Agent shell is immutably denied | Same as Build, with clean-repo/worktree guards for workflow merge |
| Network | web/fetch-style tools | `network` | Filtered when disabled | Filtered when disabled | Filtered when disabled |
| Extensions | non-core Pi/desktop tools | `extensions` | Filtered when disabled | Only mode-required extension capabilities remain | Filtered when disabled; workflow capability must be enabled |
| Workbench terminal | user-entered PTY commands | not an agent tool permission | User-controlled local execution | User-controlled local execution | User-controlled local execution |

`workspaceToolDefaults` supplies workspace defaults; a session-specific permission override takes precedence when present. If neither exists, the development defaults are used. The policy is recalculated for the active agent mode.

## Mode-specific controls

### Build

Build is the normal primary implementation mode. It allows the configured tool categories, but every guarded file/shell call still passes runtime policy and path checks. The approval interceptor classifies ordinary edits for review/undo and high-risk calls for pre-execution approval.

### Plan

Plan mode is read-oriented. The immutable deny set includes `bash`, `shell`, `write`, `edit`, `apply_patch`, and `multiedit`. The hard permission layer also denies the edit family except for plan files:

- project-local `.pi/plans/*.md`;
- the user-data plans directory;
- the corresponding permitted relative form when applicable.

User/session settings and ordinary approval responses cannot make a denied generic edit or shell call executable. `plan_write` and the desktop plan IPC are the intended plan-authoring paths.

### Compose

Compose is an orchestrator. When a temporary Compose worktree is supplied, its hard permission allows external writes only inside that worktree and asks for other external paths. The workflow itself can fall back to the primary workspace and sequential execution when Git/worktrees are unavailable; that degradation is reported and does not imply isolation.

## Approval behavior

| Risk | Examples | Behavior |
| --- | --- | --- |
| Read | explicit read tools; allowlisted read-only shell subcommands | Execute without an approval card, subject to tool/path policy |
| Edit | ordinary write/edit tools; shell redirection or mutation syntax | Execute through the edit tracking path and expose a deferred diff/undo review |
| High | destructive shell patterns, elevation/persistence, credential/system paths | Intercept before execution and require the desktop approval flow; protected paths remain denied/guarded |

Unknown tools and unknown shell commands are treated conservatively as edit risk rather than read-only. Multi-purpose commands such as Git, npm, pnpm, yarn, and node are read-only only for their explicit read subcommands.

## Protected paths and navigation

The protected-path guard covers workspace escape, the user Home root, credential directories such as `.ssh`, `.aws`, `.azure`, `.kube`, `.docker`, and `.gcloud`, and sensitive files including `.env`, auth/config files, private keys/certificates, keystores, and local database files. Canonical target resolution closes symlink/path-alias gaps before the final decision.

Web security handlers allow only same-document packaged navigation, same-origin development navigation, and external `http:`/`https:` URLs opened by the system shell. Renderer-created windows are denied.

## IPC controls

High-impact IPC inputs are validated with Zod schemas before handler logic. This includes settings, workspace paths, Git operations, terminal dimensions/input, session message persistence, file/project operations, and package sources. Handlers must additionally enforce workspace ownership, path canonicalization, and operation-specific limits.

When adding an IPC method:

- define a narrow shared type;
- add a strict schema for renderer-controlled arguments;
- avoid shell string interpolation and bind command arguments;
- return structured IPC errors rather than raw internal details;
- add a negative test for malformed input and an authorization/path boundary.

## Non-goals and honest limits

- Permission settings do not sandbox the user-controlled terminal.
- The current permission package integration is static rules plus abort/enforcement; it is not a general runtime ask/reply service for every tool.
- An approval card cannot override Plan hard denies or path guards.
- Compose worktree isolation is conditional on Git support and repository state.
- “CI green” is not a security or installer-isolation PASS; see [../current/testing-and-qa.md](../current/testing-and-qa.md).
