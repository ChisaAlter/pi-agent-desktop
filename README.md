# Pi Desktop

A Windows desktop application for Pi Agent, providing a graphical interface to interact with Pi CLI.

## Features

- **Chat Interface**: Similar to ChatGPT with Markdown rendering and code highlighting
- **Multi-Workspace Management**: Create, switch, and manage multiple project workspaces
- **Session History**: Persistent session storage with history restoration
- **Tool Call Visualization**: View AI tool calls (read/write/edit/bash) with code diff comparison
- **Model Switching**: Configure and switch between different AI models/providers
- **Git Integration**: Display current Git branch, changed files, and basic Git operations
- **Extensible**: Plugin system for extending functionality

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite 6
- **Desktop Framework**: Electron 34
- **Styling**: Tailwind CSS 4
- **State Management**: Zustand
- **Build Tool**: electron-vite
- **Package Manager**: pnpm (monorepo workspace)

## Prerequisites

- Node.js >= 18.0.0
- pnpm >= 9.0.0
- Pi CLI installed and available in PATH

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Build Packages

```bash
pnpm -r run build
```

### 3. Start Development

```bash
# Start the desktop app in development mode
cd apps/desktop
pnpm run dev
```

### 4. Build for Production

```bash
# Build the desktop app
cd apps/desktop
pnpm run build

# Package for Windows
pnpm run package
```

## Project Structure

```
pi-desktop/
├── apps/
│   └── desktop/          # Electron desktop application
│       ├── src/
│       │   ├── main/     # Electron main process
│       │   ├── preload/  # Preload scripts
│       │   └── renderer/ # React renderer process
│       └── ...
├── packages/
│   ├── pi-driver/        # Pi CLI driver package
│   └── shared-types/     # Shared TypeScript types
├── scripts/              # Development scripts
└── ...
```

## Development

### Running in Development Mode

```bash
# From the root directory
pnpm run dev
```

This will:
1. Install dependencies if needed
2. Build all packages
3. Start the desktop app with hot-reload

### Building Packages

```bash
# Build all packages
pnpm -r run build

# Build specific package
pnpm --filter @pi-desktop/pi-driver run build
```

### Type Checking

```bash
# Check types across all packages
pnpm -r run typecheck
```

## Configuration

### Pi CLI

The app communicates with Pi CLI using JSON-RPC over stdio. Make sure Pi CLI is installed and accessible:

```bash
pi --version
```

### Environment Variables

Create a `.env` file in the `apps/desktop` directory for local configuration:

```env
# Example
VITE_API_KEY=your_api_key_here
```

## Packaging

### Windows

```bash
cd apps/desktop
pnpm run package
```

This will create a Windows installer in the `release` directory.

### Configuration

Edit `electron-builder.yml` to customize packaging options.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.