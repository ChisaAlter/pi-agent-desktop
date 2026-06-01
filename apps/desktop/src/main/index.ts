// Electron Main Process Entry Point

import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { homedir } from 'os';
import Store from 'electron-store';
import { detectProject } from './project-detector';
import { buildFileTree } from './file-tree';
import { MessagingGateway } from './messaging/gateway';
import { GatewayConfig } from './messaging/types';
import { PiDriver, type PiInstallProgress } from './pi-driver';
import { WorkspaceRegistry } from './services/pi-session/registry';
import { PendingEdits } from './services/approval/pending-edits';
import { setupChatIpc } from './ipc/chat.ipc';
import { setupFilesIpc } from './ipc/files.ipc';
import { setupSkillsIpc } from './ipc/skills.ipc';
import { setupTerminalIpc } from './ipc/terminal.ipc';
import { ptyManager } from './services/shell/pty-manager';
import { setupAutoUpdater } from './services/updater';
import { app } from 'electron';
import { join } from 'path';
import { clearAllPendingApprovals } from './services/approval/approval-bridge';

let mainWindow: BrowserWindow | null = null;
let piAgentConfig: PiAgentConfig | null = null;
let gateway: MessagingGateway | null = null;
let piDriver: PiDriver | null = null;

// M1: 长连接 Pi session 管理
const piRegistry = new WorkspaceRegistry();
const piPendingEdits = new PendingEdits();

// Pi Agent 配置结构（从 ~/.pi/agent/ 读取）
interface PiAgentModel {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: string[];
}

interface PiAgentConfig {
  defaultProvider: string;
  defaultModel: string;
  providers: Array<{
    id: string;
    name: string;
    baseUrl?: string;
    models: PiAgentModel[];
  }>;
}

const PI_AGENT_DIR = join(homedir(), '.pi', 'agent');

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
          const pd = providerData as any;
          const models: PiAgentModel[] = (pd.models || []).map((m: any) => ({
            id: m.id,
            name: m.name || m.id,
            provider: providerId,
            providerName: pd.name || providerId,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
            reasoning: m.reasoning,
            input: m.input
          }));
          providers.push({ id: providerId, name: pd.name || providerId, baseUrl: pd.baseUrl, models });
        }
      }
    }

    // 解析 models.yml (补充 models.json 中不存在的 provider)
    const modelsYmlPath = join(PI_AGENT_DIR, 'models.yml');
    if (existsSync(modelsYmlPath)) {
      const ymlContent = readFileSync(modelsYmlPath, 'utf-8');
      const ymlProviders = parseSimpleYamlProviders(ymlContent);
      for (const yp of ymlProviders) {
        if (!providers.find(p => p.id === yp.id)) {
          providers.push(yp);
        } else {
          // 合并模型中不存在的模型
          const existing = providers.find(p => p.id === yp.id);
          if (!existing) continue;
          for (const ym of yp.models) {
            if (!existing.models.find(m => m.id === ym.id)) {
              existing.models.push(ym);
            }
          }
        }
      }
    }

    return { defaultProvider, defaultModel, providers };
  } catch (e) {
    console.error('Failed to load Pi Agent config:', e);
    return null;
  }
}

// 简单 YAML providers 解析器（仅解析 Pi models.yml 格式）
function parseSimpleYamlProviders(content: string): PiAgentConfig['providers'] {
  const result: PiAgentConfig['providers'] = [];
  const lines = content.split('\n');
  let currentProvider: { id: string; name: string; baseUrl: string; models: PiAgentModel[] } | null = null;
  let currentModel: Partial<PiAgentModel> | null = null;

  for (const line of lines) {
    // provider 顶级键 (如 "  longcat:")
    const providerMatch = line.match(/^  (\w[\w-]*):$/);
    if (providerMatch && !line.includes('baseUrl') && !line.includes('apiKey') && !line.includes('api:')) {
      if (currentProvider && currentModel) {
        currentProvider.models.push(currentModel as PiAgentModel);
        currentModel = null;
      }
      if (currentProvider) result.push(currentProvider);
      currentProvider = { id: providerMatch[1], name: providerMatch[1], baseUrl: '', models: [] };
      continue;
    }

    if (!currentProvider) continue;

    const trimmed = line.trim();
    // baseUrl
    if (trimmed.startsWith('baseUrl:')) {
      currentProvider.baseUrl = trimmed.replace('baseUrl:', '').trim();
      continue;
    }
    // name
    if (trimmed.startsWith('name:') && currentProvider.name === currentProvider.id) {
      currentProvider.name = trimmed.replace('name:', '').trim();
      continue;
    }
    // 模型项
    const modelMatch = line.match(/^\s+- id:\s*(.+)/);
    if (modelMatch) {
      if (currentModel && currentModel.id) {
        currentProvider.models.push(currentModel as PiAgentModel);
      }
      currentModel = { id: modelMatch[1], name: modelMatch[1], provider: currentProvider.id, providerName: currentProvider.name };
      continue;
    }
    // 模型属性
    if (currentModel) {
      if (trimmed.startsWith('name:')) currentModel.name = trimmed.replace('name:', '').trim();
      if (trimmed.startsWith('contextWindow:')) currentModel.contextWindow = parseInt(trimmed.replace('contextWindow:', '').trim());
      if (trimmed.startsWith('maxTokens:')) currentModel.maxTokens = parseInt(trimmed.replace('maxTokens:', '').trim());
      if (trimmed.startsWith('reasoning:')) currentModel.reasoning = trimmed.includes('true');
    }
  }

  if (currentModel && currentModel.id && currentProvider) {
    currentProvider.models.push(currentModel as PiAgentModel);
  }
  if (currentProvider) result.push(currentProvider);

  return result;
}

interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

interface Session {
  id: string;
  title: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
}

interface AppSettings {
  theme: 'dark' | 'light';
  fontSize: number;
  model: string;
  provider: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  autoSave: boolean;
  showLineNumbers: boolean;
  wordWrap: boolean;
}

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
      model: 'gpt-4',
      provider: 'openai',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 4096,
      autoSave: true,
      showLineNumbers: true,
      wordWrap: true
    }
  }
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
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
    console.log(`[PiDriver] Detection: installed=${status.installed}, version=${status.localVersion}, latest=${status.latestVersion}, update=${status.updateAvailable}`);
    // 通知渲染进程状态已更新
    mainWindow?.webContents.send('pi:status-changed', status);
  }).catch(err => {
    console.warn('[PiDriver] Detection failed:', err);
  });
}

// Git status helper
function getGitStatus(workspacePath: string): { branch: string; modified: string[]; added: string[]; deleted: string[]; untracked: string[]; ahead: number; behind: number } | null {
  try {
    const gitDir = join(workspacePath, '.git');
    if (!existsSync(gitDir)) {
      return null;
    }

    // Get branch
    let branch = 'main';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: workspacePath, encoding: 'utf-8' }).trim();
    } catch {
      // fallback to main
    }

    // Get status
    const statusOutput = execSync('git status --porcelain', { cwd: workspacePath, encoding: 'utf-8' });
    const lines = statusOutput.split('\n').filter(l => l.trim());

    const modified: string[] = [];
    const added: string[] = [];
    const deleted: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3).trim();
      if (status.includes('M')) modified.push(file);
      if (status.includes('A')) added.push(file);
      if (status.includes('D')) deleted.push(file);
      if (status.includes('?')) untracked.push(file);
    }

    // Get ahead/behind
    let ahead = 0;
    let behind = 0;
    try {
      const revParse = execSync('git rev-parse --abbrev-ref @{u}', { cwd: workspacePath, encoding: 'utf-8' }).trim();
      const countOutput = execSync(`git rev-list --left-right --count HEAD...${revParse}`, { cwd: workspacePath, encoding: 'utf-8' }).trim();
      const parts = countOutput.split('\t');
      if (parts.length === 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    } catch {
      // No upstream or error
    }

    return { branch, modified, added, deleted, untracked, ahead, behind };
  } catch (error) {
    console.error('Git status error:', error);
    return null;
  }
}

// IPC Handlers
function setupIPC(): void {
  // M1: 替换老的 pi:prompt (一次性 spawn), 走 AgentSession 长连接
  setupChatIpc({
    registry: piRegistry,
    pendingEdits: piPendingEdits,
    getWorkspace: (id: string) => store.get('workspaces').find((w) => w.id === id),
    getDefaultWorkspace: () => {
      const ws = store.get('workspaces');
      return ws.length > 0 ? ws[0] : undefined;
    },
  });

  // M2: 文件搜索 (给 @ 引用和 CommandPalette 用)
  setupFilesIpc();

  // M3: Skills 面板 (SkillHub 集成)
  setupSkillsIpc({
    getWorkspacePath: () => {
      const ws = store.get('workspaces');
      return ws.length > 0 ? ws[0].path : undefined;
    },
    getStateFile: () => join(app.getPath('userData'), 'skills-state.json'),
  });

  // ── Pi Driver 管理 ───────────────────────────────────────────────

  ipcMain.handle('pi:status', async () => {
    if (!piDriver) return { installed: false, error: 'PiDriver not initialized' };
    // 优先用缓存，否则同步检测
    return piDriver.detectSync();
  });

  ipcMain.handle('pi:refresh-status', async () => {
    if (!piDriver) throw new Error('PiDriver not initialized');
    const status = await piDriver.detect();
    return status;
  });

  ipcMain.handle('pi:install', async () => {
    if (!piDriver) throw new Error('PiDriver not initialized');
    await piDriver.install();
    return piDriver.detectSync();
  });

  ipcMain.handle('pi:update', async () => {
    if (!piDriver) throw new Error('PiDriver not initialized');
    await piDriver.update();
    return piDriver.detectSync();
  });

  ipcMain.handle('pi:uninstall', async () => {
    if (!piDriver) throw new Error('PiDriver not initialized');
    await piDriver.uninstall();
    return piDriver.detectSync();
  });

  ipcMain.handle('pi:cancel-operation', async () => {
    piDriver?.cancelOperation();
  });

  // 注: pi:stop 已经在 setupChatIpc 里注册 (M1 走 session.abort 而不是 SIGKILL)

  // Workspace management
  ipcMain.handle('workspace:list', async () => {
    let workspaces = store.get('workspaces');
    if (workspaces.length === 0) {
      workspaces = [{
        id: 'default',
        name: 'Default',
        path: process.cwd(),
        createdAt: Date.now()
      }];
      store.set('workspaces', workspaces);
    }
    return workspaces;
  });

  ipcMain.handle('workspace:create', async (_, name: string, path: string) => {
    const workspace = {
      id: Date.now().toString(),
      name,
      path,
      createdAt: Date.now()
    };
    const workspaces = store.get('workspaces');
    workspaces.push(workspace);
    store.set('workspaces', workspaces);
    return workspace;
  });

  ipcMain.handle('workspace:delete', async (_, id: string) => {
    const workspaces = store.get('workspaces').filter(w => w.id !== id);
    store.set('workspaces', workspaces);
  });

  ipcMain.handle('workspace:select', async (_, path: string) => {
    // Pipe 模式无需重启持久进程，直接返回成功
    console.log('Workspace selected:', path);
  });

  ipcMain.handle('workspace:select-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select Workspace Directory'
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Session management
  ipcMain.handle('session:list', async () => {
    return store.get('sessions');
  });

  ipcMain.handle('session:create', async (_, workspaceId: string, title?: string) => {
    const sessions = store.get('sessions');
    const session = {
      id: Date.now().toString(),
      title: title || `Session ${sessions.length + 1}`,
      workspaceId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    sessions.push(session);
    store.set('sessions', sessions);
    return session;
  });

  ipcMain.handle('session:delete', async (_, id: string) => {
    const sessions = store.get('sessions').filter(s => s.id !== id);
    store.set('sessions', sessions);
  });

  // Git status
  ipcMain.handle('git:status', async (_, workspacePath: string) => {
    return getGitStatus(workspacePath);
  });

  // Git diff (指定文件或全部)
  ipcMain.handle('git:diff', async (_, workspacePath: string, filePath?: string) => {
    try {
      const cmd = filePath ? `git diff "${filePath}"` : 'git diff';
      return execSync(cmd, { cwd: workspacePath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      return '';
    }
  });

  // Git staged diff
  ipcMain.handle('git:diff-staged', async (_, workspacePath: string) => {
    try {
      return execSync('git diff --staged', { cwd: workspacePath, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    } catch {
      return '';
    }
  });

  // Git add
  ipcMain.handle('git:add', async (_, workspacePath: string, files: string[]) => {
    const filesArg = files.map(f => `"${f}"`).join(' ');
    execSync(`git add ${filesArg}`, { cwd: workspacePath });
  });

  // Git commit
  ipcMain.handle('git:commit', async (_, workspacePath: string, message: string) => {
    const escaped = message.replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return execSync(`git commit -m "${escaped}"`, { cwd: workspacePath, encoding: 'utf-8' });
  });

  // Git log (最近 N 条)
  ipcMain.handle('git:log', async (_, workspacePath: string, count: number = 20) => {
    try {
      const format = '--pretty=format:{"hash":"%h","author":"%an","date":"%ai","message":"%s"}';
      const output = execSync(`git log ${format} -n ${count}`, { cwd: workspacePath, encoding: 'utf-8' });
      return output.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
    } catch {
      return [];
    }
  });

  // Git branches
  ipcMain.handle('git:branches', async (_, workspacePath: string) => {
    try {
      const output = execSync('git branch -a', { cwd: workspacePath, encoding: 'utf-8' });
      return output.split('\n').filter(l => l.trim()).map(l => ({
        name: l.replace(/^\*?\s+/, '').trim(),
        isCurrent: l.startsWith('*'),
        isRemote: l.includes('remotes/')
      }));
    } catch {
      return [];
    }
  });

  // Settings
  ipcMain.handle('settings:get', async () => {
    return store.get('settings');
  });

  ipcMain.handle('settings:set', async (_, settings: Partial<AppSettings>) => {
    const current = store.get('settings');
    const updated = { ...current, ...settings };
    store.set('settings', updated);
    return updated;
  });

  // Load Pi Agent local config — 直接返回已解析的本地配置（不含 API Key）
  ipcMain.handle('settings:load-pi-config', async () => {
    if (!piAgentConfig) return { models: [], currentModel: null };

    // 构建模型列表（不包含 API Key）
    const models = piAgentConfig.providers.flatMap(p =>
      p.models.map(m => ({
        id: m.id,
        name: m.name,
        provider: p.id,
        providerName: p.name,
        description: `${p.name} · ${m.reasoning ? '推理' : '通用'} · ${m.contextWindow ? `${Math.round(m.contextWindow / 1000)}K` : '未知'}上下文`,
        maxTokens: m.maxTokens
      }))
    );

    // 当前默认模型信息
    const currentModel = piAgentConfig.defaultModel ? {
      model: piAgentConfig.defaultModel,
      provider: piAgentConfig.defaultProvider
    } : null;

    return { models, currentModel };
  });

  // Get full Pi Agent config (for settings panel)
  ipcMain.handle('pi:get-full-config', async () => {
    if (!piAgentConfig) {
      return {
        configPath: PI_AGENT_DIR,
        defaultProvider: 'google',
        defaultModel: '',
        providers: []
      };
    }

    return {
      configPath: PI_AGENT_DIR,
      defaultProvider: piAgentConfig.defaultProvider,
      defaultModel: piAgentConfig.defaultModel,
      providers: piAgentConfig.providers.map(p => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        modelCount: p.models.length,
        hasApiKey: false // 从配置文件读取，不返回实际 key
      }))
    };
  });

  // List skills from .agents/skills directory
  ipcMain.handle('pi:list-skills', async () => {
    try {
      const skillsDir = join(process.cwd(), '.agents', 'skills');
      if (!existsSync(skillsDir)) return [];

      const entries = readdirSync(skillsDir, { withFileTypes: true });
      const skills = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillPath = join(skillsDir, entry.name);
          let description = '';

          // Try to read SKILL.md for description
          const skillMdPath = join(skillPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            try {
              const content = readFileSync(skillMdPath, 'utf-8');
              const lines = content.split('\n').filter((l: string) => l.trim());
              // Get first non-empty, non-heading line as description
              for (const line of lines) {
                if (!line.startsWith('#') && line.trim().length > 0) {
                  description = line.trim().substring(0, 100);
                  break;
                }
              }
            } catch {
              // ignore read errors
            }
          }

          skills.push({
            name: entry.name,
            description,
            path: skillPath,
            enabled: true
          });
        }
      }

      return skills;
    } catch (error) {
      console.error('Failed to list skills:', error);
      return [];
    }
  });

  // List plugins (providers) from Pi Agent config
  ipcMain.handle('pi:list-plugins', async () => {
    try {
      if (!piAgentConfig) return [];

      return piAgentConfig.providers.map(p => ({
        name: p.name,
        description: `${p.models.length} 个模型${p.baseUrl ? ` · ${p.baseUrl}` : ''}`,
        version: '1.0',
        enabled: true,
        type: 'provider' as const
      }));
    } catch (error) {
      console.error('Failed to list plugins:', error);
      return [];
    }
  });

  // ── Messaging Gateway IPC ────────────────────────────────────────

  ipcMain.handle('gateway:status', async () => {
    return gateway?.getStatus() || [];
  });

  ipcMain.handle('gateway:connect', async (_, platform: string) => {
    if (!gateway) {
      const config: GatewayConfig = {
        wechat: { enabled: true },
        feishu: { enabled: true },
        qq: { enabled: true },
        autoReply: false,
        replyMode: 'pi',
      };
      gateway = new MessagingGateway(config);
      if (mainWindow) gateway.setMainWindow(mainWindow);
    }
    return await gateway.connectPlatform(platform);
  });

  ipcMain.handle('gateway:disconnect', async (_, platform: string) => {
    await gateway?.disconnectPlatform(platform);
  });

  ipcMain.handle('gateway:send', async (_, platform: string, chatId: string, content: string) => {
    if (!gateway) throw new Error('Gateway not initialized');
    await gateway.sendReply(platform, chatId, content);
  });

  ipcMain.handle('gateway:messages', async () => {
    return gateway?.getMessageHistory() || [];
  });

  ipcMain.handle('gateway:config', async (_, config: Partial<GatewayConfig>) => {
    gateway?.updateConfig(config);
  });

  // ── Terminal IPC Handlers ──────────────────────────────────────────

  // ── Project Detection & File Tree ────────────────────────────────
  ipcMain.handle('project:detect', async (_, workspacePath: string) => {
    return detectProject(workspacePath);
  });

  ipcMain.handle('project:file-tree', async (_, workspacePath: string, maxDepth?: number) => {
    return buildFileTree(workspacePath, maxDepth || 3);
  });

  // M4: Terminal IPC 走 node-pty (替换老 child_process.spawn 模式)
  setupTerminalIpc();

  // M5: Auto-updater (从 GitHub Releases 拉, 仅在 packaged 模式跑)
  setupAutoUpdater({ getMainWindow: () => mainWindow });
}

// App lifecycle
app.whenReady().then(() => {
  // 先加载 Pi 配置，再初始化
  piAgentConfig = loadPiAgentConfig();
  if (piAgentConfig) {
    console.log(`Pi config loaded: provider=${piAgentConfig.defaultProvider}, model=${piAgentConfig.defaultModel}, ${piAgentConfig.providers.length} providers`);
    // 更新 electron-store 默认设置与 Pi 配置同步
    const currentSettings = store.get('settings');
    if (currentSettings.provider === 'openai' && currentSettings.model === 'gpt-4') {
      // 仅在用户从未自定义设置的情况下同步 Pi 配置
      store.set('settings', {
        ...currentSettings,
        provider: piAgentConfig.defaultProvider,
        model: piAgentConfig.defaultModel
      });
    }
  } else {
    console.log('No Pi Agent config found, using defaults');
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
  // 清理消息网关
  if (gateway) {
    gateway.destroy();
    gateway = null;
  }

  // 清理 Pi Driver
  if (piDriver) {
    piDriver.destroy();
    piDriver = null;
  }

  // M1: 清理所有 Pi session (每个 workspace 一个)
  clearAllPendingApprovals();
  piPendingEdits.clear();
  piRegistry.disposeAll();

  // 清理所有终端进程 (M4: 走 ptyManager)
  ptyManager.closeAll();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});