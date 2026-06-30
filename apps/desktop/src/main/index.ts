// Electron Main Process Entry Point

import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { homedir } from 'os';
import log from 'electron-log/main';
import Store from 'electron-store';
import { PiDriver, type PiInstallProgress } from './pi-driver';
import { WorkspaceRegistry } from './services/pi-session/registry';
import { PendingEdits } from './services/approval/pending-edits';
import { setupChatIpc } from './ipc/chat.ipc';
import { setupFilesIpc } from './ipc/files.ipc';
import { setupSessionsIpc } from './ipc/sessions.ipc';
import { setupSkillsIpc } from './ipc/skills.ipc';
import { setupPackagesIpc } from './ipc/packages.ipc';
import { setupTerminalIpc } from './ipc/terminal.ipc';
import { setupAgentsIpc } from './ipc/agents.ipc';
import { setupConfigIpc } from './ipc/config.ipc';
import { setupCodexSessionsIpc } from './ipc/codex-sessions.ipc';
import { setupClaudeSessionsIpc } from './ipc/claude-sessions.ipc';
import { setupGitIpc } from './ipc/git.ipc';
import { setupPiDriverIpc } from './ipc/pi-driver.ipc';
import { setupSettingsIpc } from './ipc/settings.ipc';
import { setupSettingsWindowIpc } from './ipc/settings-window.ipc';
import { setupUpdaterIpc } from './ipc/updater.ipc';
import { setupWindowIpc, setupWindowEvents } from './ipc/window.ipc';
import { setupWorkspaceIpc } from './ipc/workspace.ipc';
import { setupProjectShellIpc } from './ipc/project-shell.ipc';
import { setupWorkbenchIpc } from './ipc/workbench.ipc';
import { registerLocalFileProtocol } from './services/local-file-protocol';
import { clearAllPendingApprovals } from './services/approval/approval-bridge';
import { clearPendingExtensionUiRequests } from './services/extensions/extension-ui-bridge';
import { setupAutoUpdater, type AppUpdaterService } from './services/updater';
import { ptyManager } from './services/shell/pty-manager';
import { DEFAULT_LONG_HORIZON_SETTINGS, type AppSettings, type Session } from '@shared';
import { AgentRuntimeRegistry } from './services/agent-runtime/registry';
import { ConfigManager } from './services/config/config-manager';
import { CodexSessionImporter } from './services/codex-session/importer';
import { ClaudeSessionImporter } from './services/claude-session/importer';
import { GoalService } from './services/long-horizon/goal-service';
import { MemoryService } from './services/long-horizon/memory-service';
import { CheckpointService } from './services/long-horizon/checkpoint-service';
import { TaskService } from './services/long-horizon/task-service';
import { getMostRecentlyActiveWorkspace } from './services/workspace-selection';
import type { PiAgentConfig } from './types';

let mainWindow: BrowserWindow | null = null;
let piAgentConfig: PiAgentConfig | null = null;
let piDriver: PiDriver | null = null;

type PiDesktopTestGlobals = typeof globalThis & {
  __PI_DESKTOP_TEST_AGENT_REGISTRY__?: AgentRuntimeRegistry;
};

// Pi session (long-lived AgentSession per workspace)
const piRegistry = new WorkspaceRegistry();
const piPendingEdits = new PendingEdits();

const PI_AGENT_DIR = process.env.PI_DESKTOP_CONFIG_DIR || join(homedir(), '.pi', 'agent');

// Startup banner for electron-log diagnostics
log.info(`[Main] Pi Desktop starting (electron ${process.versions.electron}, node ${process.versions.node})`);

interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastActiveAt?: number;
}

// Session type from @shared (includes messages field for persistence)
// Session type used by @shared (includes messages field)

interface StoreSchema {
  schemaVersion: number;
  workspaces: Workspace[];
  sessions: Session[];
  settings: AppSettings;
}

/** 当前持久化 schema 版本; 升级字段/重命名时递增并在 migrateStore 内补迁移步骤. */
const CURRENT_SCHEMA_VERSION = 1;

const store = new Store<StoreSchema>({
  defaults: {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    workspaces: [],
    sessions: [],
    settings: {
      theme: 'light',
      fontSize: 14,
      model: '',
      provider: '',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 4096,
      autoSave: true,
      showLineNumbers: true,
      wordWrap: true,
      permissionLevel: 'smart',
      runtimeChannel: 'stable',
      autoCompactionEnabled: false,
      workspaceToolDefaults: {},
      sidebarGroupMode: 'date',
      shortcutOverrides: [],
      longHorizon: DEFAULT_LONG_HORIZON_SETTINGS
    }
  }
});

/**
 * 启动时 schema 迁移: 按 schemaVersion 顺序补齐/重命名持久化字段.
 * 当前 v1: 确保每条 session 含新字段默认值 (toolPermissions/tags/favorite 等),
 * 避免旧持久化数据部分字段缺失时被 Object.assign 静默"补"成脏值.
 */
function migrateStore(): void {
  const version = store.get('schemaVersion') ?? 0;
  if (version < 1) {
    const sessions = store.get('sessions');
    const migrated = sessions.map((s) => ({
      ...s,
      favorite: s.favorite ?? false,
      tags: Array.isArray(s.tags) ? s.tags : [],
      readOnly: s.readOnly ?? false,
      messages: Array.isArray(s.messages) ? s.messages : [],
    }));
    store.set('sessions', migrated);
  }
  // 未来迁移: if (version < 2) { ... }
  store.set('schemaVersion', CURRENT_SCHEMA_VERSION);
}
migrateStore();

const sendToRenderer = (channel: string, payload: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
};

function shouldRefreshSessionsForSettingsChange(previous: AppSettings, next: AppSettings): boolean {
  const prevLongHorizon = previous.longHorizon ?? DEFAULT_LONG_HORIZON_SETTINGS;
  const nextLongHorizon = next.longHorizon ?? DEFAULT_LONG_HORIZON_SETTINGS;
  return previous.provider !== next.provider
    || previous.model !== next.model
    || JSON.stringify(prevLongHorizon) !== JSON.stringify(nextLongHorizon);
}

const getLongHorizonModeOptions = () => {
  const longHorizon = store.get('settings').longHorizon ?? DEFAULT_LONG_HORIZON_SETTINGS;
  return {
    longHorizonEnabled: longHorizon.enabled,
    planModeEnabled: longHorizon.planMode.enabled,
    composeModeEnabled: longHorizon.composeMode.enabled,
    workflowEnabled: longHorizon.workflow.enabled,
    composeWorkflowEnabled: longHorizon.composeWorkflow.enabled,
  };
};

const agentRegistry = new AgentRuntimeRegistry({
  getWorkspace: (workspaceId: string) => store.get('workspaces').find((workspace) => workspace.id === workspaceId),
  pendingEdits: piPendingEdits,
  send: sendToRenderer,
  agentDir: PI_AGENT_DIR,
  getSettings: () => store.get('settings'),
  getPiAgentConfig: () => piAgentConfig,
  getTaskService: () => taskService,
  getMemoryService: () => memoryService,
  getModeOptions: getLongHorizonModeOptions,
});
if (process.env.CI === "1" || process.env.NODE_ENV === "test") {
  (globalThis as PiDesktopTestGlobals).__PI_DESKTOP_TEST_AGENT_REGISTRY__ = agentRegistry;
}
const configManager = new ConfigManager(PI_AGENT_DIR);
const codexSessionImporter = new CodexSessionImporter();
const claudeSessionImporter = new ClaudeSessionImporter();
let goalService: GoalService | null = null;
let memoryService: MemoryService | null = null;
let checkpointService: CheckpointService | null = null;
let taskService: TaskService | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 689,
    height: 756,
    minWidth: 689,
    minHeight: 756,
    show: false,
    autoHideMenuBar: true,
    transparent: process.platform === "win32",
    backgroundColor: "#00000000",
    // Custom title bar (renderer-controlled)
    //  - darwin: hiddenInset preserves native traffic lights
    //  - 其他: frame:false 全部由 renderer 渲染 drag region + 按钮
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, frame: true }
      : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.webContents.setZoomFactor(1.5);

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Initialize Pi Driver — 检测本地 Pi CLI 并设置事件监听
function initializePiDriver(): void {
  piDriver = new PiDriver();

  // 监听安装/更新进度，转发给渲染进程
  piDriver.on('progress', (progress: PiInstallProgress) => {
    mainWindow?.webContents.send('pi:install-progress', progress);
  });

  // 启动时自动检测（异步，不阻塞）
  piDriver.detect().then(status => {
    log.info(`[PiDriver] Detection: installed=${status.installed}, version=${status.localVersion}, latest=${status.latestVersion}, update=${status.updateAvailable}`);
    // 通知渲染进程状态已更新
    mainWindow?.webContents.send('pi:status-changed', status);
  }).catch(err => {
    log.warn('[PiDriver] Detection failed:', err);
  });
}

// IPC Handlers
function setupIPC(updaterService: AppUpdaterService): void {
  // Pi session (long-lived AgentSession)
  const longHorizonRoot = join(app.getPath('userData'), 'long-horizon');
  memoryService ??= new MemoryService({ rootDir: longHorizonRoot });
  taskService ??= new TaskService(memoryService.getDatabase());
  goalService ??= new GoalService({
    database: memoryService.getDatabase(),
    legacyStateFile: join(longHorizonRoot, 'goals.json'),
    send: (channel, _workspaceId, payload) => sendToRenderer(channel, payload),
    taskService,
  });
  checkpointService ??= new CheckpointService(memoryService);
  setupChatIpc({
    registry: piRegistry,
    agentRegistry,
    pendingEdits: piPendingEdits,
    goalService,
    memoryService,
    checkpointService,
    taskService,
    getSettings: () => store.get('settings'),
    getWorkspace: (id: string) => store.get('workspaces').find((w) => w.id === id),
    getDefaultWorkspace: () => {
      return getMostRecentlyActiveWorkspace(store.get('workspaces'));
    },
  });

  setupAgentsIpc(agentRegistry);
  setupConfigIpc(configManager, {
    onManagedModelsChanged: () => {
      piAgentConfig = configManager.loadPiAgentConfig();
      if (piAgentConfig) {
        const currentSettings = store.get('settings');
        store.set('settings', {
          ...currentSettings,
          provider: piAgentConfig.defaultProvider,
          model: piAgentConfig.defaultModel,
        });
      }
    },
  });
  setupCodexSessionsIpc(codexSessionImporter);
  setupClaudeSessionsIpc(claudeSessionImporter);

  // File search (for @ references and CommandPalette)
  setupFilesIpc({ getMainWindow: () => mainWindow });

  // Skills panel (SkillHub integration)
  setupSkillsIpc({
    getWorkspacePath: () => {
      return getMostRecentlyActiveWorkspace(store.get('workspaces'))?.path;
    },
    getStateFile: () => join(app.getPath('userData'), 'skills-state.json'),
  });

  // Pi Driver management
  setupPiDriverIpc(() => piDriver);

  setupWorkspaceIpc({
    store,
    getMainWindow: () => mainWindow,
    disposeWorkspaceSession: (workspaceId) => {
      piRegistry.dispose(workspaceId);
      agentRegistry.disposeWorkspace(workspaceId);
    },
  });

  // Session management (delegated to sessions.ipc.ts)
  setupSessionsIpc({
    store: {
      get: (key) => store.get(key) as Session[],
      set: (key, value) => store.set(key, value as never),
    },
  });

  setupPackagesIpc();
  setupProjectShellIpc();

  setupGitIpc();

  setupSettingsIpc({
    store,
    getPiAgentConfig: () => piAgentConfig,
    piAgentDir: PI_AGENT_DIR,
    onSettingsChanged: (next, previous) => {
      if (!shouldRefreshSessionsForSettingsChange(previous, next)) return;
      const workspaceIds = [...new Set(agentRegistry.list().map((agent) => agent.workspaceId))];
      for (const workspaceId of workspaceIds) {
        void agentRegistry.refreshWorkspace(workspaceId).catch((error) => {
          log.warn("[Main] failed to refresh workspace runtime after settings change:", workspaceId, error);
        });
      }
      for (const workspace of store.get('workspaces')) {
        piRegistry.dispose(workspace.id);
      }
    },
  });

  setupSettingsWindowIpc(() => mainWindow);
  setupUpdaterIpc(updaterService);

  // Terminal (node-pty)
  setupTerminalIpc();

  // Custom title bar (renderer-controlled)
  setupWindowIpc(() => mainWindow);
  setupWindowEvents(() => mainWindow);

  // Workbench context (renderer tells main which file user is viewing)
  setupWorkbenchIpc();

}

// App lifecycle
app.whenReady().then(() => {
  registerLocalFileProtocol();

  // 先加载 Pi 配置，再初始化
  piAgentConfig = configManager.loadPiAgentConfig();
  if (piAgentConfig) {
    log.info(`Pi config loaded: provider=${piAgentConfig.defaultProvider}, model=${piAgentConfig.defaultModel}, ${piAgentConfig.providers.length} providers`);
    // 更新 electron-store 默认设置与 Pi 配置同步
    const currentSettings = store.get('settings');
    if (!currentSettings.provider && !currentSettings.model) {
      // 仅在用户从未自定义设置的情况下同步 Pi 配置
      store.set('settings', {
        ...currentSettings,
        provider: piAgentConfig.defaultProvider,
        model: piAgentConfig.defaultModel
      });
    }
  } else {
    log.info('No Pi Agent config found, using defaults');
  }

  createWindow();
  const updaterService = setupAutoUpdater();
  setupIPC(updaterService);
  initializePiDriver();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  log.info('[Main] All windows closed, cleaning up resources');

  // 清理 Pi Driver
  if (piDriver) {
    piDriver.destroy();
    piDriver = null;
  }

  // Clean up all Pi sessions
  clearAllPendingApprovals();
  clearPendingExtensionUiRequests();
  piPendingEdits.clear();
  piRegistry.disposeAll();
  agentRegistry.disposeAll();
  delete (globalThis as PiDesktopTestGlobals).__PI_DESKTOP_TEST_AGENT_REGISTRY__;

  // 清理所有终端进程 (M4: 走 ptyManager)
  ptyManager.closeAll();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
