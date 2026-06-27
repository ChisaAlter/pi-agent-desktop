# Contributing to Pi Desktop

Thanks for your interest in contributing! Pi Desktop is an open-source Electron app wrapping [Pi](https://github.com/earendil-works/pi-coding-agent).

## Quick Start

```bash
# 1. Fork & clone
git clone https://github.com/ChisaAlter/pi-agent-desktop.git
cd pi-desktop
pnpm install

# 2. Build packages
pnpm -r run build

# 3. Run in dev mode
pnpm --filter @pi-desktop/desktop dev
```

## Project Layout

```
apps/desktop/        # Electron app (main + preload + renderer)
packages/            # Workspace packages (shared-types)
docs/                # Specs, plans, spike notes
.github/workflows/   # CI + release
```

## Branches

- `master` — stable, always green
- `feature/mN-*` — per-milestone work (M1, M2, M3, M4, M5)
- Fix branches: `fix/<issue>` or `chore/<topic>`

## Workflow

1. Pick an issue or open one describing what you want to change
2. Create a branch: `git checkout -b feature/m6-xxx`
3. Implement + write tests (TDD preferred)
4. Verify: `pnpm -r typecheck && pnpm -r lint && pnpm -r test`
5. Commit with clear messages: `feat(approval): add X` / `fix(terminal): Y`
6. Open a PR against `master`

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/) prefix style:

- `feat(scope):` new feature
- `fix(scope):` bug fix
- `chore(scope):` tooling / cleanup
- `refactor(scope):` no behavior change
- `test(scope):` tests only
- `docs(scope):` docs only

Examples:
- `feat(M2): @ mention parser + popover`
- `fix(M1): usePiStream sends workspaceId so Pi runs in workspace cwd`
- `chore(M5): delete dead pi-driver package`

## Testing

We use **vitest** + **@testing-library/react**. Tests live next to the code:

- Main-process logic: `apps/desktop/src/main/**/__tests__/*.test.ts`
- Renderer components: `apps/desktop/src/renderer/src/**/__tests__/*.test.tsx`
- E2E: `apps/desktop/e2e/*.spec.ts`

Run:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```

For release or updater work, also read the release guide in `docs/RELEASE-AND-AUTO-UPDATE.md`.

## Style

- TypeScript strict mode
- ESM imports (`.js` extensions not needed in source)
- Tailwind for styling (utility-first, no CSS modules)
- Zustand for state
- Follow the existing patterns in `src/main/services/` for new services

## Areas Needing Help

- **macOS / Linux** testing & packaging (M5.1)
- **Skill editor** (Monaco integration) — see `m3 plan` for design
- **Real Pi extension** to replace M1's interceptor (cleaner approval)
- **Translations** — zh-CN and en are present, but coverage still needs cleanup
- **Documentation** — clearer examples, GIFs, troubleshooting

## Issues

Use GitHub issues. Please include:
- Steps to reproduce
- Expected vs actual behavior
- Pi / OS / Node version

## Code of Conduct

Be kind, assume good faith, focus on technical merit. This is a small OSS project — keep feedback constructive.

## Questions?

Open a GitHub Discussion or check existing issues. Pi-specific questions go to [earendil-works/pi-coding-agent](https://github.com/earendil-works/pi-coding-agent/issues).
