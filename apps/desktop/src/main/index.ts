// Electron Main Process Entry Point

import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import yaml from 'js-yaml';
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
import { setupGitIpc } from './ipc/git.ipc';
import { setupPiDriverIpc } from './ipc/pi-driver.ipc';
import { setupSettingsIpc } from './ipc/settings.ipc';
import { setupWindowIpc, setupWindowEvents } from './ipc/window.ipc';
import { setupWorkspaceIpc } from './ipc/workspace.ipc';
import { setupProjectShellIpc } from './ipc/project-shell.ipc';
import { clearAllPendingApprovals } from './services/approval/approval-bridge';
import { setupAutoUpdater } from './services/updater';
import { ptyManager } from './services/shell/pty-manager';
import type { AppSettings, Session } from '@shared';
import { AgentRuntimeRegistry } from './services/agent-runtime/registry';
import { ConfigManager } from './services/config/config-manager';
import { CodexSessionImporter } from './services/codex-session/importer';
import type { PiAgentConfig, PiAgentModel } from './types';

let mainWindow: BrowserWindow | null = null;
let piAgentConfig: PiAgentConfig | null = null;
let piDriver: PiDriver | null = null;

// Pi session (long-lived AgentSession per workspace)
const piRegistry = new WorkspaceRegistry();
const piPendingEdits = new PendingEdits();

const PI_AGENT_DIR = join(homedir(), '.pi', 'agent');

// Startup banner for electron-log diagnostics
log.info(`[Main] Pi Desktop starting (electron ${process.versions.electron}, node ${process.versions.node})`);

// 从本地 Pi Agent 配置目录加载配置
function loadPiAgentConfig(): PiAgentConfig | null {
  try {
    if (!existsSync(PI_AGENT_DIR)) return null;

    // 读取 settings.json
    const settingsPath = join(PI_AGENT_DIR, 'settings.json');
    let defaultProvider = 'google';
    let defaultModel = '';
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      defaultProvider = settings.defaultProvider || defaultProvider;
      defaultModel = settings.defaultModel || '';
    }

    // 读取 models.json (优先) 和 models.yml (补充)
    const providers: PiAgentConfig['providers'] = [];

    // 解析 models.json
    const modelsJsonPath = join(PI_AGENT_DIR, 'models.json');
    if (existsSync(modelsJsonPath)) {
      const modelsData = JSON.parse(readFileSync(modelsJsonPath, 'utf-8'));
      if (modelsData.providers) {
        for (const [providerId, providerData] of Object.entries(modelsData.providers)) {
          const pd = providerData as {
            name?: string;
            baseUrl?: string;
            apiType?: string;
            api?: string;
            models?: Array<Record<string, unknown>>;
            _piDesktopDeletedModels?: string[];
          };
          const models: PiAgentModel[] = (pd.models || []).map((m) => ({
            id: String(m.id),
            name: typeof m.name === 'string' ? m.name : String(m.id),
            provider: providerId,
            providerName: pd.name || providerId,
            contextWindow: typeof m.contextWindow === 'number' ? m.contextWindow : undefined,
            maxTokens: typeof m.maxTokens === 'number' ? m.maxTokens : undefined,
            reasoning: Boolean(m.reasoning),
            input: Array.isArray(m.input) ? m.input as string[] : undefined
          }));
          providers.push({
            id: providerId,
            name: pd.name || providerId,
            baseUrl: pd.baseUrl,
            apiType: pd.apiType,
            api: pd.api,
            _piDesktopDeletedModels: Array.isArray(pd._piDesktopDeletedModels) ? pd._piDesktopDeletedModels : undefined,
            models,
          });
        }
      }
    }

    // 解析 models.yml (补充 models.json 中不存在的 provider)
    const modelsYmlPath = join(PI_AGENT_DIR, 'models.yml');
    if (existsSync(modelsYmlPath)) {
      const ymlContent = readFileSync(modelsYmlPath, 'utf-8');
      const ymlProviders = loadYamlProviders(ymlContent);
      for (const yp of ymlProviders) {
        if (!providers.find(p => p.id === yp.id)) {
          providers.push(yp);
        } else {
          // 合并模型中不存在的模型
          const existing = providers.find(p => p.id === yp.id);
          if (!existing) continue;
          const deletedModels = new Set(existing._piDesktopDeletedModels ?? []);
          for (const ym of yp.models) {
            if (deletedModels.has(ym.id)) continue;
            if (!existing.models.find(m => m.id === ym.id)) {
              existing.models.push(ym);
            }
          }
        }
      }
    }

    return { defaultProvider, defaultModel, providers };
  } catch (e) {
    log.error('Failed to load Pi Agent config:', e);
    return null;
  }
}

// Parse Pi models.yml into PiAgentConfig['providers'] using js-yaml.
// (replaces an earlier 60-line hand-written regex parser)
function loadYamlProviders(content: string): PiAgentConfig['providers'] {
  const data = yaml.load(content) as { providers?: Record<string, unknown> } | null;
  if (!data || typeof data !== 'object' || !data.providers) return [];

  const result: PiAgentConfig['providers'] = [];
  for (const [providerId, raw] of Object.entries(data.providers)) {
    const pd = raw as {
      name?: string;
      baseUrl?: string;
      apiType?: string;
      api?: string;
      _piDesktopDeletedModels?: string[];
      models?: Array<Record<string, unknown>>;
    };
    if (!pd || typeof pd !== 'object') continue;

    const models: PiAgentModel[] = Array.isArray(pd.models)
      ? pd.models
          .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof m.id === 'string')
          .map((m) => {
            const ctxRaw = m.contextWindow;
            const tokensRaw = m.maxTokens;
            return {
              id: m.id as string,
              name: typeof m.name === 'string' ? m.name : (m.id as string),
              provider: providerId,
              providerName: typeof pd.name === 'string' ? pd.name : providerId,
              contextWindow: typeof ctxRaw === 'number' ? ctxRaw : undefined,
              maxTokens: typeof tokensRaw === 'number' ? tokensRaw : undefined,
              reasoning: Boolean(m.reasoning),
              input: Array.isArray(m.input) ? (m.input as string[]) : undefined
            };
          })
      : [];

    result.push({
      id: providerId,
      name: typeof pd.name === 'string' ? pd.name : providerId,
      baseUrl: typeof pd.baseUrl === 'string' ? pd.baseUrl : undefined,
      apiType: typeof pd.apiType === 'string' ? pd.apiType : undefined,
      api: typeof pd.api === 'string' ? pd.api : undefined,
      _piDesktopDeletedModels: Array.isArray(pd._piDesktopDeletedModels)
        ? pd._piDesktopDeletedModels.filter((id): id is string => typeof id === 'string')
        : undefined,
      models
    });
  }

  return result;
}

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
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
      piAgentConfig = loadPiAgentConfig();
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

  // Terminal (node-pty)
  setupTerminalIpc();

  // Custom title bar (renderer-controlled)
  setupWindowIpc(() => mainWindow);
  setupWindowEvents(() => mainWindow);

  // Auto-updater
  setupAutoUpdater({ getMainWindow: () => mainWindow });
}

// App lifecycle
app.whenReady().then(() => {
  // 先加载 Pi 配置，再初始化
  piAgentConfig = loadPiAgentConfig();
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
  piPendingEdits.clear();
  piRegistry.disposeAll();
  agentRegistry.disposeAll();

  // 清理所有终端进程 (M4: 走 ptyManager)
  ptyManager.closeAll();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
