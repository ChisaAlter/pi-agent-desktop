# Agent Studio UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Pi Desktop layout to match Agent Studio design — top tab navigation, pure conversation sidebar, collapsible right rail, and independent settings window.

**Architecture:** Incremental refactor of existing MiniMaxCodeLayout. New TopTabBar component inserted between title bar and content. Sidebar nav items removed (moved to tabs). Right rail gets default-collapsed state. Settings opens as a separate BrowserWindow via new IPC channel.

**Tech Stack:** React 19, Zustand 5, Tailwind CSS 4, Electron 41, electron-vite 5

---

### Task 1: Add CSS variables and store state

**Covers:** [S8, S9]

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/globals.css:116-118`
- Modify: `apps/desktop/src/renderer/src/stores/settings-store.ts:52-60`

- [ ] **Step 1: Add tabbar height CSS variable**

In `apps/desktop/src/renderer/src/styles/globals.css`, after line 118 (`--mm-height-titlebar`), add:

```css
--mm-height-tabbar: 36px;
```

- [ ] **Step 2: Add new state to settings store**

In `apps/desktop/src/renderer/src/stores/settings-store.ts`, in the `defaultSettings` object (around line 52), no changes needed to `AppSettings` type since these are UI-only state. Instead, add to the `SettingsState` interface (around line 31):

```typescript
interface SettingsState {
  settings: AppSettings;
  isOpen: boolean;
  piModels: PiModelInfo[] | null;
  lastWriteError: IpcError | string | null;
  rightRailCollapsed: boolean;
  sidebarGroupMode: 'date' | 'workspace';
  // ... existing actions ...
}
```

And in the `create<SettingsState>(...)` call, add initial values after the existing state:

```typescript
rightRailCollapsed: true,
sidebarGroupMode: 'date',
```

And add actions:

```typescript
toggleRightRail: () => set((state) => ({ rightRailCollapsed: !state.rightRailCollapsed })),
setSidebarGroupMode: (mode: 'date' | 'workspace') => set({ sidebarGroupMode: mode }),
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm --filter @pi-desktop/desktop typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/styles/globals.css apps/desktop/src/renderer/src/stores/settings-store.ts
git commit -m "chore(ui): add tabbar CSS variable and layout state to settings store"
```

---

### Task 2: Create TopTabBar component

**Covers:** [S3, S7]

**Files:**
- Create: `apps/desktop/src/renderer/src/components/TopTabBar/TopTabBar.tsx`

- [ ] **Step 1: Create TopTabBar component**

```tsx
import React from "react";
import { useI18n } from "../../i18n";

export interface TopTabBarTab {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface TopTabBarProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
  rightSlot?: React.ReactNode;
}

function IconChat(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function IconTask(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

function IconMemory(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  );
}

function IconTools(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function IconSettings(): React.JSX.Element {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
    </svg>
  );
}

const TAB_DEFS: { id: string; labelKey: string; icon: React.ReactNode }[] = [
  { id: "chat", labelKey: "topbar.chat", icon: <IconChat /> },
  { id: "tasks", labelKey: "topbar.tasks", icon: <IconTask /> },
  { id: "memory", labelKey: "topbar.memory", icon: <IconMemory /> },
  { id: "skills", labelKey: "topbar.tools", icon: <IconTools /> },
  { id: "settings", labelKey: "topbar.settings", icon: <IconSettings /> },
];

export function TopTabBar({ activeTab, onTabChange, rightSlot }: TopTabBarProps): React.JSX.Element {
  const { t } = useI18n();

  return (
    <div
      className="flex h-[var(--mm-height-tabbar)] shrink-0 items-center border-b border-[var(--mm-border)] bg-[var(--mm-bg-sidebar)] px-2"
      data-mmcode-component="top-tabbar"
    >
      <nav className="flex h-full items-center gap-0.5" role="tablist" aria-label="主导航">
        {TAB_DEFS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className={`relative flex h-full items-center gap-1.5 px-3 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] ${
                isActive
                  ? "font-medium text-[var(--mm-text-primary)]"
                  : "text-[var(--mm-text-secondary)] hover:text-[var(--mm-text-primary)] hover:bg-[var(--mm-bg-hover)]"
              }`}
            >
              <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                {tab.icon}
              </span>
              <span>{t(tab.labelKey)}</span>
              {isActive && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--mm-bg-active)]" />
              )}
            </button>
          );
        })}
      </nav>
      {rightSlot && <div className="ml-auto flex items-center">{rightSlot}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Add i18n keys**

In the locale file (find the zh-CN.json locale file), add:

```json
"topbar": {
  "chat": "对话",
  "tasks": "任务",
  "memory": "记忆",
  "tools": "工具",
  "settings": "设置"
}
```

And in en-US.json:

```json
"topbar": {
  "chat": "Chat",
  "tasks": "Tasks",
  "memory": "Memory",
  "tools": "Tools",
  "settings": "Settings"
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm --filter @pi-desktop/desktop typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/components/TopTabBar/
git commit -m "feat(ui): add TopTabBar component with 5 navigation tabs"
```

---

### Task 3: Simplify left sidebar

**Covers:** [S4, S7]

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/MiniMaxCode/MiniMaxCodeSidebar.tsx`

- [ ] **Step 1: Remove nav items from sidebar, add group toggle**

The sidebar currently renders `SECTION_DEFS` (lines 153-158) as navigation items. These need to be removed since they move to TopTabBar. Keep: logo, session list, settings footer.

Replace the `<nav>` section (lines 276-308) with:

```tsx
<nav
  className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-4 pt-2"
  aria-label="会话列表"
>
  {/* New conversation button */}
  <button
    type="button"
    onClick={() => onSectionChange("new-task")}
    className="flex w-full items-center gap-2 rounded-lg border border-[var(--mm-border)] bg-[var(--mm-bg-main)] px-3 py-2 text-[13px] text-[var(--mm-text-secondary)] transition-colors hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
  >
    <IconPlus />
    <span>{t("sidebar.newConversation")}</span>
  </button>

  {/* Group mode toggle */}
  <div className="flex items-center gap-1 px-1">
    <button
      type="button"
      onClick={() => onGroupModeChange?.("date")}
      className={`flex-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
        groupMode === "date"
          ? "bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)]"
          : "text-[var(--mm-text-tertiary)] hover:bg-[var(--mm-bg-hover)]"
      }`}
    >
      {t("sidebar.groupByDate")}
    </button>
    <button
      type="button"
      onClick={() => onGroupModeChange?.("workspace")}
      className={`flex-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
        groupMode === "workspace"
          ? "bg-[var(--mm-bg-active)] text-[var(--mm-text-on-active)]"
          : "text-[var(--mm-text-tertiary)] hover:bg-[var(--mm-bg-hover)]"
      }`}
    >
      {t("sidebar.groupByWorkspace")}
    </button>
  </div>

  {/* Session list */}
  <div className="flex flex-col gap-1">
    {groupMode === "workspace" ? (
      <>
        <h3 className="px-3 pt-1 pb-2 text-[11px] font-medium uppercase tracking-[0.5px] text-[var(--mm-text-tertiary)]">
          {t("sidebar.project")}
        </h3>
        <ProjectGroupedSessionList
          currentWorkspaceId={currentWorkspaceId ?? null}
          currentSessionId={currentSessionId}
          onSelectSession={(id) => onSectionChange(`session:${id}`)}
          onArchiveSession={archiveSession}
          onDeleteSession={deleteSession}
          onSwitchWorkspace={(wid) => useWorkspaceStore.getState().setCurrentWorkspace(wid)}
        />
      </>
    ) : (
      <DateGroupedSessionList
        currentSessionId={currentSessionId}
        onSelectSession={(id) => onSectionChange(`session:${id}`)}
        onArchiveSession={archiveSession}
        onDeleteSession={deleteSession}
      />
    )}
  </div>
</nav>
```

- [ ] **Step 2: Create DateGroupedSessionList component**

Create `apps/desktop/src/renderer/src/components/MiniMaxCode/DateGroupedSessionList.tsx`:

```tsx
import React, { useMemo } from "react";
import { useSessionStore } from "../../stores/session-store";

interface DateGroupedSessionListProps {
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onArchiveSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
}

function formatDateGroup(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return "本周";
  if (diffDays < 30) return "本月";
  return "更早";
}

interface GroupedSessions {
  label: string;
  sessions: { id: string; title: string; updatedAt: Date }[];
}

export function DateGroupedSessionList({
  currentSessionId,
  onSelectSession,
  onArchiveSession,
  onDeleteSession,
}: DateGroupedSessionListProps): React.JSX.Element {
  const sessions = useSessionStore((state) =>
    state.sessions
      .filter((s) => !s.archived)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  );

  const groups = useMemo<GroupedSessions[]>(() => {
    const map = new Map<string, { id: string; title: string; updatedAt: Date }[]>();
    for (const session of sessions) {
      const group = formatDateGroup(session.updatedAt);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push({
        id: session.id,
        title: session.title || "新对话",
        updatedAt: session.updatedAt,
      });
    }
    const order = ["今天", "昨天", "本周", "本月", "更早"];
    return order
      .filter((label) => map.has(label))
      .map((label) => ({ label, sessions: map.get(label)! }));
  }, [sessions]);

  if (groups.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-[11px] text-[var(--mm-text-tertiary)]">
        暂无对话
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.label}>
          <h4 className="mb-1 px-3 text-[11px] font-medium uppercase tracking-[0.5px] text-[var(--mm-text-tertiary)]">
            {group.label}
          </h4>
          <ul className="m-0 list-none space-y-0.5 p-0">
            {group.sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  onClick={() => onSelectSession(session.id)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-[13px] transition-colors ${
                    currentSessionId === session.id
                      ? "bg-[var(--mm-bg-selected)] font-medium text-[var(--mm-text-primary)]"
                      : "text-[var(--mm-text-secondary)] hover:bg-[var(--mm-bg-hover)] hover:text-[var(--mm-text-primary)]"
                  }`}
                >
                  <span className="truncate">{session.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Update MiniMaxCodeSidebar props**

Add `groupMode` and `onGroupModeChange` props to `MiniMaxCodeSidebarProps`:

```typescript
export interface MiniMaxCodeSidebarProps {
  currentSection: string;
  currentWorkspaceId?: string | null;
  piAgentStatus?: "online" | "offline" | "checking";
  onSectionChange: (section: string) => void;
  groupMode?: 'date' | 'workspace';
  onGroupModeChange?: (mode: 'date' | 'workspace') => void;
}
```

- [ ] **Step 4: Add i18n keys**

Add to zh-CN.json:

```json
"sidebar": {
  "newConversation": "新对话",
  "groupByDate": "按日期",
  "groupByWorkspace": "按工作区",
  "project": "工作区",
  "today": "今天",
  "yesterday": "昨天"
}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm --filter @pi-desktop/desktop typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/components/MiniMaxCode/MiniMaxCodeSidebar.tsx apps/desktop/src/renderer/src/components/MiniMaxCode/DateGroupedSessionList.tsx
git commit -m "feat(ui): simplify sidebar to pure conversation list with date/workspace grouping"
```

---

### Task 4: Integrate TopTabBar into AppShell

**Covers:** [S3, S4, S7]

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx:90-150,450-500`

- [ ] **Step 1: Import TopTabBar and update panelForSection**

In `App.tsx`, add import:

```typescript
import { TopTabBar } from "./components/TopTabBar/TopTabBar";
```

Update `panelForSection` to include new sections:

```typescript
function panelForSection(section: string): MainPanel {
  if (section === "skills") return "skills";
  if (section === "git") return "git";
  return "chat";
}
```

The `TopTabBar` tabs ("tasks", "memory") will route through `routeSection` which already handles these. "tasks" and "memory" don't map to a `MainPanel` — they either open existing views or could be future panels. For now, "tasks" and "memory" tab clicks will route to their respective actions via `routeSection`.

- [ ] **Step 2: Add TopTabBar to layout**

In the `MiniMaxCodeLayout` usage (around line 456), the TopTabBar needs to go between the title bar and the content. Modify `MiniMaxCodeLayout` to accept a `topBarSlot` prop.

First, update `MiniMaxCodeLayout.tsx` to add the prop:

```typescript
export interface MiniMaxCodeLayoutProps {
  // ... existing props ...
  topBarSlot?: React.ReactNode;
}
```

And in the render, insert after `<MiniMaxCodeTitleBar>`:

```tsx
{topBarSlot}
```

Then in `App.tsx`, pass the TopTabBar:

```tsx
<MiniMaxCodeLayout
  title="Pi Agent"
  topBarSlot={
    <TopTabBar
      activeTab={activeSection === "new-task" ? "chat" : activeSection}
      onTabChange={routeSection}
    />
  }
  leftCollapsed={leftCollapsed}
  rightCollapsed={rightCollapsed}
  onCollapseLeft={() => setLeftCollapsed((v) => !v)}
  onCollapseRight={activePanel === "chat" ? () => setRightCollapsed((v) => !v) : undefined}
  leftSlot={
    <MiniMaxCodeSidebar
      currentSection={activeSection}
      currentWorkspaceId={currentWorkspace?.id}
      piAgentStatus={piAgentStatus}
      onSectionChange={routeSection}
      groupMode={sidebarGroupMode}
      onGroupModeChange={setSidebarGroupMode}
    />
  }
  // ... rest unchanged
/>
```

- [ ] **Step 3: Wire up settings store state**

In `AppShell`, destructure the new store values:

```typescript
const { settings, rightRailCollapsed, sidebarGroupMode } = useSettingsStore();
const { toggleRightRail, setSidebarGroupMode } = useSettingsStore();
```

Replace the local `rightCollapsed` state with the store value. Remove the local `useState` for `rightCollapsed` and use `rightRailCollapsed` from the store instead. Update all references.

- [ ] **Step 4: Handle tab routing for tasks/memory/settings**

In `routeSection`, add cases:

```typescript
if (section === "tasks") {
  // Tasks tab - could open a tasks view or stay on chat with task focus
  setActiveSection("chat");
  return;
}
if (section === "memory") {
  // Memory tab - open search history
  setPaletteOpen(true);
  return;
}
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm --filter @pi-desktop/desktop typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/components/MiniMaxCode/MiniMaxCodeLayout.tsx
git commit -m "feat(ui): integrate TopTabBar into main layout, wire sidebar grouping"
```

---

### Task 5: Right rail default-collapsed

**Covers:** [S5]

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx:171-179`

- [ ] **Step 1: Update right rail auto-show logic**

The existing `useEffect` at line 171-179 auto-shows the right rail when messages exist. Change it to use the store's `rightRailCollapsed` and `toggleRightRail`:

Replace the existing effect:

```typescript
useEffect(() => {
  const hasMessages = (currentSession?.messages?.length ?? 0) > 0;
  if (hasMessages && rightRailCollapsed) {
    toggleRightRail();
  }
}, [currentSession?.messages?.length, rightRailCollapsed, toggleRightRail]);
```

This only auto-EXPANDS when messages arrive (if currently collapsed). It does NOT auto-collapse when messages are empty — that's now a user choice.

- [ ] **Step 2: Update MiniMaxCodeLayout rightCollapsed prop**

Pass `rightRailCollapsed` from store instead of local state:

```tsx
rightCollapsed={rightRailCollapsed}
onCollapseRight={activePanel === "chat" ? toggleRightRail : undefined}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm --filter @pi-desktop/desktop typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(ui): right rail defaults to collapsed, user-controlled toggle"
```

---

### Task 6: Settings independent window — IPC

**Covers:** [S6]

**Files:**
- Create: `apps/desktop/src/main/ipc/settings-window.ipc.ts`
- Modify: `apps/desktop/src/main/index.ts:26-30`
- Modify: `apps/desktop/src/preload/index.ts:56-313`

- [ ] **Step 1: Create settings window IPC handler**

Create `apps/desktop/src/main/ipc/settings-window.ipc.ts`:

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import log from 'electron-log/main';

let settingsWindow: BrowserWindow | null = null;

export function setupSettingsWindowIpc(): void {
  ipcMain.handle('settings:open-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }

    settingsWindow = new BrowserWindow({
      width: 800,
      height: 600,
      minWidth: 600,
      minHeight: 400,
      title: '系统设置',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
      show: false,
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`);
    } else {
      settingsWindow.loadFile(join(__dirname, '../renderer/settings.html'));
    }

    settingsWindow.once('ready-to-show', () => {
      settingsWindow?.show();
    });

    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });
  });

  ipcMain.handle('settings:close-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
  });
}
```

- [ ] **Step 2: Register IPC in main process**

In `apps/desktop/src/main/index.ts`, import and call:

```typescript
import { setupSettingsWindowIpc } from './ipc/settings-window.ipc';
```

After the existing `setupSettingsIpc(...)` call, add:

```typescript
setupSettingsWindowIpc();
```

- [ ] **Step 3: Expose in preload**

In `apps/desktop/src/preload/index.ts`, add to the `piAPI` object:

```typescript
openSettingsWindow: () => ipcRenderer.invoke('settings:open-window'),
closeSettingsWindow: () => ipcRenderer.invoke('settings:close-window'),
```

- [ ] **Step 4: Update shared types**

In `packages/shared-types/src/index.ts`, add to the `PiAPI` interface:

```typescript
openSettingsWindow: () => Promise<void>;
closeSettingsWindow: () => Promise<void>;
```

- [ ] **Step 5: Wire TopTabBar settings tab**

In `App.tsx`, update `routeSection` for settings:

```typescript
if (section === "settings") {
  window.piAPI?.openSettingsWindow();
  return;
}
```

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm -r typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/ipc/settings-window.ipc.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts packages/shared-types/src/index.ts
git commit -m "feat(settings): add independent settings window via BrowserWindow IPC"
```

---

### Task 7: Settings window renderer page

**Covers:** [S6]

**Files:**
- Create: `apps/desktop/src/renderer/src/settings.html`
- Create: `apps/desktop/src/renderer/src/SettingsWindow.tsx`
- Modify: `apps/desktop/electron.vite.config.ts` (add settings entry)

- [ ] **Step 1: Create settings HTML entry**

Create `apps/desktop/src/renderer/src/settings.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>系统设置</title>
</head>
<body>
  <div id="settings-root"></div>
  <script type="module" src="./SettingsWindow.tsx"></script>
</body>
</html>
```

- [ ] **Step 2: Create SettingsWindow entry point**

Create `apps/desktop/src/renderer/src/SettingsWindow.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "./i18n";
import { SettingsContent } from "./components/Settings/SettingsContent";

function SettingsWindow(): React.JSX.Element {
  return (
    <I18nProvider>
      <div className="flex h-screen w-screen bg-[var(--mm-bg-main)] text-[var(--mm-text-primary)]">
        <SettingsContent />
      </div>
    </I18nProvider>
  );
}

const root = createRoot(document.getElementById("settings-root")!);
root.render(<SettingsWindow />);
```

- [ ] **Step 3: Extract SettingsContent from SettingsPanel**

The existing `SettingsPanel.tsx` has a two-panel layout (nav + content). Extract the inner content into a reusable `SettingsContent` component that can be used in both the modal and the independent window.

Create `apps/desktop/src/renderer/src/components/Settings/SettingsContent.tsx` by extracting the content from `SettingsPanel.tsx` (the nav tabs + content area, without the modal wrapper).

- [ ] **Step 4: Add settings entry to electron-vite config**

In `apps/desktop/electron.vite.config.ts`, add a settings entry to the renderer config:

```typescript
// In the renderer section of the config
build: {
  rollupOptions: {
    input: {
      main: resolve(__dirname, 'src/renderer/src/index.html'),
      settings: resolve(__dirname, 'src/renderer/src/settings.html'),
    },
  },
},
```

- [ ] **Step 5: Verify build passes**

Run: `pnpm --filter @pi-desktop/desktop build`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/settings.html apps/desktop/src/renderer/src/SettingsWindow.tsx apps/desktop/src/renderer/src/components/Settings/SettingsContent.tsx
git commit -m "feat(settings): add settings window renderer page with extracted content"
```

---

### Task 8: Verification and cleanup

**Covers:** [S10]

**Files:**
- Verify: all modified files

- [ ] **Step 1: Run full typecheck**

Run: `pnpm -r typecheck`
Expected: PASS

- [ ] **Step 2: Run lint**

Run: `pnpm -r lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 3: Run tests**

Run: `pnpm -r test`
Expected: PASS

- [ ] **Step 4: Visual verification**

Run: `pnpm --filter @pi-desktop/desktop dev`

Verify:
1. TopTabBar renders with 5 tabs below title bar
2. Clicking tabs switches center content
3. Left sidebar shows pure conversation list (no nav items)
4. Group toggle switches between date and workspace grouping
5. Right rail is collapsed by default, expandable via toggle button
6. Settings tab opens independent window
7. Settings window has left nav + content layout
8. All existing functionality still works (chat, skills, git)

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore(ui): Agent Studio UI redesign — verification cleanup"
```
