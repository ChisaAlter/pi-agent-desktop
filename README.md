# Pi Desktop

> An open-source Windows desktop GUI for [Pi](https://github.com/earendil-works/pi-coding-agent) — the AI coding agent CLI.
> Built with Electron 34 + React 19 + TypeScript 5.

## What is this?

Pi Desktop wraps the [Pi CLI](https://github.com/earendil-works/pi-coding-agent) in a polished, Codex-style graphical interface. It preserves Pi's signature extensibility (Skills, Providers, Plugins via [SkillHub](https://skillhub.cn)) while giving it a first-class chat, file context, terminal, and approval flow.

## Features

- **Long-lived Pi sessions** per workspace (in-process `AgentSession`)
- **Tiered approval flow** — high-risk tools prompt, file edits get post-hoc diff with undo
- **@ file references** with fuzzy search popover
- **Image paste** with attachment chips
- **Ctrl+K Command Palette** — file search / history / commands
- **SkillHub integration** — browse, search, install, enable/disable community skills
- **Multi-tab terminal** with real PTY (node-pty + xterm.js) — resize, ANSI colors, TUI apps work
- **Auto-update** from GitHub Releases (electron-updater)
- **Tiered classifier** — 20+ risk patterns for bash / write / edit / read

## Tech Stack

- **Frontend**: React 19 + TypeScript 5 + Vite 6 + Tailwind CSS 4
- **State**: Zustand 5
- **Desktop**: Electron 34 + electron-vite
- **Terminal**: node-pty + xterm.js
- **Markdown**: react-markdown + rehype-highlight
- **Diff**: diff2html
- **Storage**: electron-store
- **Test**: vitest 2 + @testing-library/react
- **CI**: GitHub Actions
- **Auto-update**: electron-updater (GitHub Releases)
- **Package Manager**: pnpm 9 (monorepo)

## Prerequisites

- **Node.js** >= 22.19.0 (Electron 34 bundled)
- **pnpm** >= 9.0.0
- **Windows 10/11** (v1.0 Windows-only; macOS / Linux in v1.1+)
- **Pi CLI** installed and on PATH: <https://github.com/earendil-works/pi-coding-agent>
- **SkillHub CLI** (optional, for skill marketplace): see [SkillHub install](https://skillhub.cn/install/skillhub.md)

## Getting Started

```bash
# 1. Clone and install
git clone https://github.com/yourusername/pi-desktop.git
cd pi-desktop
pnpm install

# 2. Build all packages
pnpm -r run build

# 3. Start the app in dev mode
pnpm --filter @pi-desktop/desktop dev
```

The Electron window opens. Pick a workspace directory, type a message, hit Enter.

## Project Structure

```
pi-desktop/
├── apps/
│   └── desktop/                 # Electron main app
│       ├── src/
│       │   ├── main/             # Main process
│       │   │   ├── ipc/          # IPC route layer (chat, files, skills, terminal)
│       │   │   ├── services/     # Business logic
│       │   │   │   ├── pi-session/    # AgentSession wrapper
│       │   │   │   ├── approval/      # Classifier + interceptor
│       │   │   │   ├── search/        # File scanner
│       │   │   │   ├── skills/        # SkillHub adapter
│       │   │   │   └── shell/         # node-pty manager
│       │   │   └── index.ts      # App entry + setup
│       │   ├── preload/          # contextBridge API
│       │   └── renderer/         # React UI
│       │       ├── components/   # ChatView / SkillsPanel / TerminalPanel / etc.
│       │       ├── stores/       # Zustand stores
│       │       └── utils/        # Fuzzy match, mention parser, etc.
├── packages/
│   └── shared-types/             # Cross-process TypeScript types
├── docs/
│   ├── superpowers/
│   │   ├── specs/                # Design specs (M1, M2, M3, M4, M5)
│   │   └── plans/                # Implementation plans
│   └── spikes/                   # Spike notes (Pi protocol exploration)
└── .github/
    └── workflows/                # CI + release
```

## Development

```bash
# Run all tests (102+ tests)
pnpm -r test

# Typecheck
pnpm -r typecheck

# Lint
pnpm -r lint

# Build a specific package
pnpm --filter @pi-desktop/desktop build

# Package as Windows installer
pnpm --filter @pi-desktop/desktop package:publish
```

## Configuration

### Pi CLI

Pi Desktop reads Pi configuration from `~/.pi/agent/` automatically (no need to set API keys in the app). See [Pi's documentation](https://github.com/earendil-works/pi-coding-agent) for setup.

### SkillHub (optional)

For skill marketplace:

```bash
curl -fsSL https://skillhub.cn/install/install.sh | bash
```

The Skills panel will detect it on startup.

## Architecture

Three layers + one persistent process per workspace:

```
┌─────────────────────────────────────────────────────────┐
│ Renderer (React 19)                                       │
│  ├─ 3-column layout: LeftNav | Chat/Skills | RightPanel   │
│  ├─ Zustand stores                                         │
│  └─ contextBridge: window.piAPI / window.shellAPI          │
└────────────────┬─────────────────────────────────────────┘
                 │ typed IPC
┌────────────────┴─────────────────────────────────────────┐
│ Main Process (Electron)                                    │
│  ├─ WorkspaceRegistry (one AgentSession per workspace)    │
│  ├─ ApprovalInterceptor (tiered tool approval)           │
│  ├─ EventBridge (Pi events → renderer)                    │
│  ├─ SkillHub adapter (CLI wrapper)                        │
│  ├─ PtyManager (node-pty terminal)                       │
│  └─ AutoUpdater (GitHub Releases)                         │
└────────────────┬─────────────────────────────────────────┘
                 │ in-process
┌────────────────┴─────────────────────────────────────────┐
│ External: Pi CLI (AgentSession) + node-pty shells          │
└─────────────────────────────────────────────────────────┘
```

## Roadmap

- **v1.0** (current): Windows, tiered approval, @ mentions, Skills, terminal
- **v1.1**: macOS / Linux support, real Pi extension (pre-block tools), Monaco Skill editor
- **v2.0**: Code signing, multi-window, optional cloud sync

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and how to submit PRs.

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

- Built on top of [Pi](https://github.com/earendil-works/pi-coding-agent) by Mario Zechner
- Inspired by [OpenAI Codex Desktop](https://openai.com/index/openai-codex/) and the [Mavis Code](https://mavis.local) UI language
- Skills powered by [SkillHub](https://skillhub.cn)
