# Agent Studio UI Redesign

## [S1] Problem

The current Pi Desktop uses a three-column layout with navigation in the left sidebar. The target design (Agent Studio) uses a top tab bar for navigation, a pure conversation list in the left sidebar, and a collapsible right rail. Settings should open as an independent window.

## [S2] Scope

Full UI layout restructuring across 4 areas:
1. Top tab bar (new component)
2. Left sidebar simplification
3. Right rail collapsibility
4. Independent settings window

## [S3] Top Tab Bar

**Component**: `TopTabBar` — new file at `components/TopTabBar/TopTabBar.tsx`

**Layout**: Horizontal tab strip below the title bar (32px). Height 36px.

**Tab items** (left to right):
- 对话 (Chat) → `ChatView` (existing)
- 任务 (Tasks) → Plan/task execution view (existing `PlanCard` area or new wrapper)
- 记忆 (Memory) → `SearchHistory` (existing, currently modal — inline it)
- 工具 (Tools) → `SkillsPanel` (existing)
- 设置 (Settings) → Opens independent `BrowserWindow` via IPC

**Behavior**:
- Active tab has bottom accent bar (2px, `--mm-bg-active`) + bold text
- Hover: `--mm-bg-hover` background
- Click sets `activeSection` in `AppShell`
- Right side: workspace switcher dropdown (moved from sidebar)

**Integration**: Insert between `MiniMaxCodeTitleBar` and the content row in `AppShell`.

## [S4] Left Sidebar Simplification

**Component**: `MiniMaxCodeSidebar` — existing file, modify

**Remove**: Navigation items (New Task, Search, Plugins, Git) — these move to TopTabBar

**Keep**:
- Logo area (Pi icon + title)
- `ProjectGroupedSessionList` (session list)
- Settings button in footer

**Add**:
- Group mode toggle: dropdown/button to switch between "by date" and "by workspace"
- "New conversation" button at top (currently a nav item, becomes a button)

**Date grouping logic**:
- 今天 (Today): sessions from current day
- 昨天 (Yesterday): sessions from previous day
- 更早 (Earlier): older sessions
- Use `Intl.DateTimeFormat` for locale-aware date grouping

**Group mode state**: Persist in `settings-store` (user preference).

## [S5] Right Rail Collapsibility

**Component**: `RightRail` — existing file, modify

**Default state**: Collapsed (width 0, hidden)

**Expand/collapse trigger**: Small `«` / `»` button on the left edge of the right rail area

**Behavior**:
- Collapsed: button visible at the right edge of center content
- Expanded: 280px wide, all existing panels visible
- Transition: CSS `width` + `opacity` animation (reuse existing `animate-layout` pattern)
- State persisted in `settings-store`

**All existing panels preserved**: UsageStats, RunStatus, ToolPermissions, ThinkingControl, EnvironmentInfo, Progress, RecentTools, FileOutput.

## [S6] Independent Settings Window

**Approach**: New `BrowserWindow` via Electron IPC

**New files**:
- `src/main/ipc/settings-window.ipc.ts` — IPC handler to open/close settings window
- `src/renderer/src/components/Settings/SettingsWindow.tsx` — Standalone settings page (no modal wrapper)

**Window config**:
- Size: 800×600 (resizable)
- Title: "系统设置"
- Modal: false (independent window)
- WebPreferences: same as main window (contextIsolation, nodeIntegration false)

**Layout** (matching design):
- Left nav (200px): 常规 | 网络 | 存储 | 安全 | 通知 | 备份与恢复 | 关于
- Right content: tab-specific settings

**IPC channel**: `settings:open-window` / `settings:close-window`

**Integration**: TopTabBar "设置" tab calls `window.piAPI.openSettingsWindow()`.

## [S7] Component Change Summary

| Component | Action | Files |
|-----------|--------|-------|
| `TopTabBar` | **New** | `components/TopTabBar/TopTabBar.tsx` |
| `MiniMaxCodeSidebar` | **Modify** | Remove nav items, add group toggle |
| `RightRail` | **Modify** | Add collapse state + toggle button |
| `AppShell` (in App.tsx) | **Modify** | Insert TopTabBar, adjust layout |
| `MiniMaxCodeLayout` | **Modify** | Support collapsible right rail |
| Settings Window | **New** | `settings-window.ipc.ts`, `SettingsWindow.tsx` |
| `preload/index.ts` | **Modify** | Expose `openSettingsWindow` API |

## [S8] CSS Variables

Add to `globals.css`:
```css
--mm-height-tabbar: 36px;
--mm-width-sidebar-left: 240px;  /* unchanged */
--mm-width-sidebar-right: 280px;  /* unchanged, but default collapsed */
```

## [S9] State Changes

New Zustand state in `settings-store`:
- `rightRailCollapsed: boolean` (default: true)
- `sidebarGroupMode: 'date' | 'workspace'` (default: 'date')

## [S10] Testing

- Visual verification: all 5 tabs render correct content
- Left sidebar: date grouping works, workspace grouping works, toggle persists
- Right rail: collapse/expand animation smooth, state persists
- Settings window: opens independently, all tabs functional
- Regression: existing chat, skills, git panels unchanged
