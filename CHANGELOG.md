# Changelog

All notable changes to Pi Desktop will be documented here. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased] — v1.0.1 hotfix

### Fixed
- **CI**: Add `eslint.config.js` (ESLint 9 flat config) so lint actually runs; project had no config and CI was silently passing.
- **CI**: Remove `continue-on-error: true` from lint and build steps (was hiding real failures).
- **CI**: Bump Node version 20 → 22 to match documented requirement.
- **Security**: Parameterize all `git` shell invocations in main process (`execSync` → `execFileSync`) — closes command injection in `git:add`, `git:commit`, `git:diff`, `git:log`, `git:undo`.
- **Memory leak**: Chat IPC no longer re-subscribes to Pi session events on every `pi:send` — bridge and interceptor are now created once per workspace session.

### Removed
- **messaging/gateway (IM bridge)**: Deleted `src/main/messaging/` (feishu/qq/wechat adapters + gateway) and `src/renderer/src/components/GatewayPanel/`. v0.1.0 product decision: focus on AI coding agent GUI, defer IM bridge to v2.0+.
- `CODEBUDDY.md` (was stale and contradicted README).

### Changed
- `package.json` `engines.node`: `>=18.0.0` → `>=22.19.0` (matches README prerequisite).
- `WorkspaceData` interface: now includes optional `lastActiveAt` field (was previously `as any` cast).

### Tests
- 107 passed, 2 skipped, 0 failed (17 test files) — unchanged.

---

## [0.1.0] - 2026-06-01

首个公开版本。Windows 10/11 x64.

### Added
- M1 基础: 修 cwd bug + Pi in-process 长连接 + 分层审批 (high-risk 预拦 / file_edit 事后 diff / read 放行)
- M2 上下文: @ 文件引用 (fuzzy 排序) + 图片粘贴 + Ctrl+K CommandPalette (文件/历史/命令 3 模式)
- M3 技能: SkillHub CLI 集成, 市场 tab + 我的 tab + 3 选项创建 (用 Pi 构建/编写/从 GitHub)
- M4 终端: node-pty 真 PTY, 多 tab, xterm.js 6 集成
- M5 工程: electron-updater + GitHub Actions (CI + Release) + ErrorBoundary + 重写 README/CONTRIBUTING
- M6 发布: 写最小 App.tsx + 归档旧 UI 组件 + 真实 NSIS 打包 (101 MB installer)

### Tests
- 107 通过, 2 跳过, 0 失败 (17 test files)

### Known Limitations
- macOS / Linux 不支持 (v1.1)
- 没代码签名 (SmartScreen 警告, v1.1)
- 旧 UI 组件归档, 等 v1.1 重写 ChatView
- 技能格式 adapter (OpenClaw → Pi) v1.1

### Housekeeping
- `.codebuddy/`, `app-output.log`, `package-lock.json` removed
- Mockup HTMLs and old design docs archived to `docs/design-archive/`
- Dead `packages/pi-driver` removed
- `.gitignore` refreshed (IDE state, stale artifacts, mockup HTMLs)

## [0.0.0] — initial commit

- Initial scaffold: Electron + React + TypeScript monorepo
- Basic IPC scaffolding
- Old `--print` based chat (replaced by M1)

