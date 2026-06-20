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
import { setupWindowIpc, setupWindowEvents } from './ipc/window.ipc';
import { setupWorkspaceIpc } from './ipc/workspace.ipc';
import { setupProjectShellIpc } from './ipc/project-shell.ipc';
import { setupWorkbenchIpc } from './ipc/workbench.ipc';
import { registerLocalFileProtocol } from './services/local-file-protocol';
import { clearAllPendingApprovals } from './services/approval/approval-bridge';
import { clearPendingExtensionUiRequests } from './services/extensions/extension-ui-bridge';
import { setupAutoUpdater } from './services/updater';
import { ptyManager } from './services/shell/pty-manager';
import type { AppSettings, Session } from '@shared';
import { AgentRuntimeRegistry } from './services/agent-runtime/registry';
import { ConfigManager } from './services/config/config-manager';
import { CodexSessionImporter } from './services/codex-session/importer';
import { ClaudeSessionImporter } from './services/claude-session/importer';
import type { PiAgentConfig } from './types';

let mainWindow: BrowserWindow | null = null;
let piAgentConfig: PiAgentConfig | null = null;
let piDriver: PiDriver | null = null;

// Pi session (long-lived AgentSession per workspace)
const piRegistry = new WorkspaceRegistry();
const piPendingEdits = new PendingEdits();

const PI_AGENT_DIR = join(homedir(), '.pi', 'agent');

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
  workspaces: Workspace[];
  sessions: Session[];
  settings: AppSettings;
}

const store = new Store<StoreSchema>({
  defaults: {
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
      workspaceToolDefaults: {}
    }
  }
});

const sendToRenderer = (channel: string, payload: unknown) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
};

const agentRegistry = new AgentRuntimeRegistry({
  getWorkspace: (workspaceId: string) => store.get('workspaces').find((workspace) => workspace.id === workspaceId),
  pendingEdits: piPendingEdits,
  send: sendToRenderer,
});
const configManager = new ConfigManager(PI_AGENT_DIR);
const codexSessionImporter = new CodexSessionImporter();
const claudeSessionImporter = new ClaudeSessionImporter();

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
function setupIPC(): void {
  // Pi session (long-lived AgentSession)
  setupChatIpc({
    registry: piRegistry,
    agentRegistry,
    pendingEdits: piPendingEdits,
    getWorkspace: (id: string) => store.get('workspaces').find((w) => w.id === id),
    getDefaultWorkspace: () => {
      const ws = store.get('workspaces');
      return ws.length > 0 ? ws[0] : undefined;
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
  setupFilesIpc();

  // Skills panel (SkillHub integration)
  setupSkillsIpc({
    getWorkspacePath: () => {
      const ws = store.get('workspaces');
      return ws.length > 0 ? ws[0].path : undefined;
    },
    getStateFile: () => join(app.getPath('userData'), 'skills-state.json'),
  });

  // Pi Driver management
  setupPiDriverIpc(() => piDriver);

  setupWorkspaceIpc({ store, getMainWindow: () => mainWindow });

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
  });

  setupSettingsWindowIpc(() => mainWindow);

  // Terminal (node-pty)
  setupTerminalIpc();

  // Custom title bar (renderer-controlled)
  setupWindowIpc(() => mainWindow);
  setupWindowEvents(() => mainWindow);

  // Workbench context (renderer tells main which file user is viewing)
  setupWorkbenchIpc();

  // Auto-updater
  setupAutoUpdater({ getMainWindow: () => mainWindow });
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
  setupIPC();
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

  // 清理所有终端进程 (M4: 走 ptyManager)
  ptyManager.closeAll();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
