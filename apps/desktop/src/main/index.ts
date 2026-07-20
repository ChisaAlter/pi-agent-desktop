// Electron Main Process Entry Point

import { app, BrowserWindow, Menu, Tray, nativeImage } from 'electron';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
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
import { setupDesktopOverlayIpc } from './ipc/desktop-overlay.ipc';
import { setupUpdaterIpc } from './ipc/updater.ipc';
import { setupDiagnosticsIpc } from './ipc/diagnostics.ipc';
import { setupWindowIpc, setupWindowEvents } from './ipc/window.ipc';
import { setupWorkspaceIpc } from './ipc/workspace.ipc';
import { setupProjectShellIpc } from './ipc/project-shell.ipc';
import { setupWorkbenchIpc } from './ipc/workbench.ipc';
import { setupPlanIpc } from './ipc/plan.ipc';
import { setupTaskIpc } from './ipc/task.ipc';
import { setupSubagentIpc } from './ipc/subagent.ipc';
import { PlanFileService } from './services/plan/plan-file-service';
import { registerLocalFileProtocol } from './services/local-file-protocol';
import { clearAllPendingApprovals } from './services/approval/approval-bridge';
import { clearPendingExtensionUiRequests } from './services/extensions/extension-ui-bridge';
import { setExtensionUiTargetResolver } from './services/extensions/extension-ui-bridge';
import { setupAutoUpdater, type AppUpdaterService } from './services/updater';
import { ptyManager } from './services/shell/pty-manager';
import { DEFAULT_LONG_HORIZON_SETTINGS, normalizeLongHorizonSettings, type AppSettings, type Session, type ToolPermissions } from '@shared';
import { SubagentManager, type SubagentSessionFactory } from './services/subagent/manager';
import { AutoScheduler, type ScheduledSubagentType } from './services/subagent/auto-scheduler';
import { createAutoSchedulerSpawnHandler, type SubagentSpawnHandlerDeps } from './services/subagent/spawn-handler';
import { MarkdownMemoryService } from './services/memory/markdown-memory-service';
import { SessionSummaryService } from './services/subagent/session-summary-service';
import { createWorkspaceSession } from './services/pi-session/factory';
import { AgentRuntimeRegistry } from './services/agent-runtime/registry';
import { ConfigManager } from './services/config/config-manager';
import { CodexSessionImporter } from './services/codex-session/importer';
import { ClaudeSessionImporter } from './services/claude-session/importer';
import { GoalService, buildSafeJudgeTranscript } from './services/long-horizon/goal-service';
import { JudgeModelClient, type ResolvedProvider, type ResolvedModel } from './services/long-horizon/judge-model-client';
import { MemoryService } from './services/long-horizon/memory-service';
import { CheckpointService } from './services/long-horizon/checkpoint-service';
import { TaskService } from './services/long-horizon/task-service';
import { getMostRecentlyActiveWorkspace } from './services/workspace-selection';
import { DesktopOverlayWindowManager } from './services/desktop-overlay-window';
import { createMainWindowLifecycleController, type MainWindowLifecycleController } from './services/window-lifecycle';
import { resolveTrayIconPath } from './services/tray-icon';
import { attachWebSecurityHandlers } from './services/web-security';
import { configureProductionLogging } from './services/log-redaction';
import { buildDiagnosticReport } from './services/diagnostics';
import { attachCrashDiagnostics, attachRendererCrashDiagnostics } from './services/crash-diagnostics';
import { resolveStoredToolPermissions } from './services/permission/runtime-policy';
import { resolveNativeSessionPath } from './services/pi-session/session-path';
import { forkNativeSession } from './services/pi-session/native-session-fork';
import { loadPiSdk } from './services/pi-session/sdk-runtime';
import { registerSingleInstance } from './services/single-instance';
import { SqliteSessionRepository } from './services/sqlite-session-repository';
import { resolveMainWindowChromeOptions, resolveMainWindowPerformancePreferences } from './services/main-window-options';
import { createMutationQueue, createKeyedMutator, type KeyedStore } from './utils/mutation-queue';
import { getSettingsWindow as getSharedSettingsWindow } from './ipc/settings-window.ipc';
import type { PiAgentConfig } from './types';

const e2eLocale = process.env.PI_DESKTOP_E2E_LOCALE;
if (e2eLocale) {
  app.commandLine?.appendSwitch('lang', e2eLocale);
}

let mainWindow: BrowserWindow | null = null;
let desktopOverlayWindowManager: DesktopOverlayWindowManager | null = null;
let mainWindowLifecycle: MainWindowLifecycleController | null = null;
let piAgentConfig: PiAgentConfig | null = null;
let modelConfigRefreshTail: Promise<void> = Promise.resolve();
let piDriver: PiDriver | null = null;

const MAIN_WINDOW_WIDTH = 896;
const MAIN_WINDOW_HEIGHT = 756;
let restoreRequestedBeforeReady = false;

function restoreExistingMainWindow(): void {
  if (mainWindowLifecycle) {
    mainWindowLifecycle.restoreMainWindow();
    return;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    restoreRequestedBeforeReady = true;
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

const isPrimaryInstance = registerSingleInstance(app, restoreExistingMainWindow);

type PiDesktopTestGlobals = typeof globalThis & {
  __PI_DESKTOP_TEST_AGENT_REGISTRY__?: AgentRuntimeRegistry;
  __PI_DESKTOP_TEST_OVERLAY__?: {
    emitPermissionRequest: (payload: {
      requestId: string;
      title: string;
      message?: string;
      workspaceId?: string;
      agentId?: string | null;
    }) => void;
  };
  __PI_DESKTOP_TEST_SHELL__?: {
    hasTray: () => boolean;
    closeMainWindow: () => void;
    restoreMainWindow: () => void;
    isMainWindowVisible: () => boolean;
    quitApp: () => void;
  };
};

// Pi session (long-lived AgentSession per workspace)
const piRegistry = new WorkspaceRegistry();
const piPendingEdits = new PendingEdits();
// Plan file service singleton (Task 4.4) — injected into setupPlanIpc.
const planFileService = new PlanFileService();

const PI_AGENT_DIR = process.env.PI_DESKTOP_CONFIG_DIR || join(homedir(), '.pi', 'agent');

// Configure redaction and bounded file rotation before the first log entry.
configureProductionLogging(log);
attachCrashDiagnostics({ processEvents: process, appEvents: app, logger: log });
// Startup banner for electron-log diagnostics
log.info(`[Main] Pi Desktop starting (electron ${process.versions.electron}, node ${process.versions.node})`);

interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastActiveAt?: number;
  /**
   * Per-workspace plan-mode runtime toggle (CRIT-1).
   * - `undefined` (legacy workspaces pre-migration): falls back to global `settings.longHorizon.planMode.enabled`
   * - `true` / `false`: overrides the global toggle for this workspace
   * Persisted in electron-store alongside the rest of the Workspace record
   * (same pattern as `lastActiveAt` / `createdAt`).
   */
  planModeEnabled?: boolean;
}

// Session type from @shared (includes messages field for persistence)
// Session type used by @shared (includes messages field)

interface StoreSchema {
  schemaVersion: number;
  workspaces: Workspace[];
  sessions: Session[];
  sessionStorage?: "sqlite-v1";
  settings: AppSettings;
  /**
   * AutoScheduler lastRunAt persistence (Phase 2 wire-inert-subsystems).
   * Keyed by `${workspaceId}:${type}` where type is "dream" | "distill".
   * Read by AutoScheduler.getLastRunAt, written by setLastRunAt — see
   * main/index.ts `setupIPC` for the wiring.
   */
  subagentLastRunAt?: Record<string, number>;
}

/** 当前持久化 schema 版本; 升级字段/重命名时递增并在 migrateStore 内补迁移步骤. */
const CURRENT_SCHEMA_VERSION = 2;
let resetSessionStorageOnOpen = false;

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
      schemaVersion: CURRENT_SCHEMA_VERSION,
      permissionLevel: 'smart',
      runtimeChannel: 'stable',
      autoCompactionEnabled: false,
      generatedUiEnabled: true,
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
  if (version < 2 || store.get('sessionStorage') !== 'sqlite-v1') {
    store.set('sessions', []);
    store.set('sessionStorage', 'sqlite-v1');
    resetSessionStorageOnOpen = true;
  }
  store.set('schemaVersion', CURRENT_SCHEMA_VERSION);
}
migrateStore();

let sessionRepository: SqliteSessionRepository | null = null;
const sessionToolPermissions = new Map<string, ToolPermissions>();

function getSessionRepository(): SqliteSessionRepository {
  if (!sessionRepository) {
    const userDataPath = app.getPath('userData');
    if (resetSessionStorageOnOpen) {
      for (const fileName of ['sessions.db', 'sessions.db-wal', 'sessions.db-shm', 'sessions.backup.db']) {
        rmSync(join(userDataPath, fileName), { force: true });
      }
      resetSessionStorageOnOpen = false;
    }
    sessionRepository = new SqliteSessionRepository(userDataPath);
  }
  return sessionRepository;
}

const sendToRenderer = (channel: string, payload: unknown) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
};

function shouldRefreshSessionsForSettingsChange(previous: AppSettings, next: AppSettings): boolean {
  const prevLongHorizon = previous.longHorizon ?? DEFAULT_LONG_HORIZON_SETTINGS;
  const nextLongHorizon = next.longHorizon ?? DEFAULT_LONG_HORIZON_SETTINGS;
  return previous.generatedUiEnabled !== next.generatedUiEnabled ||
    previous.autoCompactionEnabled !== next.autoCompactionEnabled ||
    JSON.stringify(prevLongHorizon) !== JSON.stringify(nextLongHorizon);
}

/**
 * Build per-workspace mode options for AgentRuntimeRegistry.
 *
 * CRIT-1: when a workspace has its `planModeEnabled` field set (true/false),
 * it overrides the global `settings.longHorizon.planMode.enabled`. Workspaces
 * created before this field existed (undefined) fall back to the global toggle
 * so existing behavior is preserved.
 *
 * Call chain (verified):
 *   plan:set-enabled IPC → setWorkspacePlanMode() (persists) + agentRegistry.refreshWorkspace(wsId)
 *     → refreshRuntimeSession → createPrimarySession → buildDesktopExtensions(wsId)
 *       → getModeOptions(wsId) → resolveBundledDesktopExtensionPaths (loads pi-openplan)
 *   prompt() → getModeOptions(wsId) → buildAgentModePrompt(mode, text, options)
 *     (Task 2 will read options.planModeEnabled to inject PLAN_DIRECTIVE)
 */
const getLongHorizonModeOptions = (workspaceId?: string) => {
  const longHorizon = store.get('settings').longHorizon ?? DEFAULT_LONG_HORIZON_SETTINGS;
  const workspace = workspaceId
    ? store.get('workspaces').find((w) => w.id === workspaceId)
    : undefined;
  const workspacePlanMode = workspace?.planModeEnabled;
  return {
    generatedUiEnabled: store.get('settings').generatedUiEnabled !== false,
    longHorizonEnabled: longHorizon.enabled,
    planModeEnabled:
      workspacePlanMode !== undefined ? workspacePlanMode : longHorizon.planMode.enabled,
    composeModeEnabled: longHorizon.composeMode.enabled,
    workflowEnabled: longHorizon.workflow.enabled,
    composeWorkflowEnabled: longHorizon.composeWorkflow.enabled,
  };
};

/**
 * Read a workspace's plan-mode runtime toggle (CRIT-1).
 * Returns `undefined` for unknown workspaces or workspaces that haven't opted
 * into a per-workspace override (so callers can fall back to the global setting).
 */
const getWorkspacePlanMode = (workspaceId: string): boolean | undefined => {
  const workspace = store.get('workspaces').find((w) => w.id === workspaceId);
  return workspace?.planModeEnabled;
};

// Shared serial mutation queue for workspace records.
//
// `main/index.ts` 的 `setWorkspacePlanMode` 与 `ipc/workspace.ipc.ts` 的
// workspace CRUD/选择 handler **共享** 这一个队列, 避免两份独立 Promise tail
// 在并发 plan-mode 切换 + workspace 写入时以 last-write-wins 互相覆盖
// electron-store 的 `workspaces` 数组。锁范围仅覆盖 get/set 的 RMW;
// `refreshWorkspace` 等重 IO 仍在 mutate 返回之后再执行, 不进队列。
//
// 队列语义对齐 `ipc/skills.ipc.ts` 的 `withSkillsLock`: 一次 mutate 抛错
// 不会卡死后续写入 (tail 永续)。
const workspaceMutationQueue = createMutationQueue();
const workspaceStore = store as unknown as KeyedStore<'workspaces', Workspace[]>;
const mutateWorkspaces = createKeyedMutator(workspaceMutationQueue, workspaceStore, 'workspaces');

/**
 * Persist a workspace's plan-mode runtime toggle (CRIT-1).
 * Called by the `plan:set-enabled` IPC handler in chat.ipc.ts.
 */
async function setWorkspacePlanMode(workspaceId: string, enabled: boolean): Promise<void> {
  await mutateWorkspaces((current) =>
    current.map((workspace) =>
      workspace.id === workspaceId
        ? { ...workspace, planModeEnabled: enabled, lastActiveAt: workspace.lastActiveAt ?? Date.now() }
        : workspace,
    ),
  );
}

/**
 * SubagentManager sessionFactory (Phase 2 wire-inert-subsystems).
 *
 * Adapts the manager's `SubagentSessionFactory` shape to `createWorkspaceSession`.
 * Each spawn gets its own isolated Pi AgentSession with the subagent's
 * toolAllowlist + customTools, the workspace's current provider/model (or the
 * explicit `modelRef` override), and the same Pi agent dir as the primary
 * session. The manager owns the resulting AgentSession via SubagentSession
 * (which calls `session.dispose()` on its own teardown).
 *
 * Lazy closures over `piAgentConfig` / `store` are safe: the factory is only
 * invoked at spawn time (runtime), long after `app.whenReady()` has populated
 * `piAgentConfig`.
 */
const subagentSessionFactory: SubagentSessionFactory = async (opts) => {
  const settings = store.get('settings');
  const provider = opts.modelRef?.provider ?? settings.provider ?? piAgentConfig?.defaultProvider;
  const modelId = opts.modelRef?.modelId ?? settings.model ?? piAgentConfig?.defaultModel;
  const result = await createWorkspaceSession({
    workspaceId: opts.context.workspaceId,
    workspacePath: opts.context.workspacePath,
    provider,
    modelId,
    piAgentConfig,
    agentDir: PI_AGENT_DIR,
    tools: opts.toolAllowlist,
    customTools: opts.customTools,
    thinkingLevel: settings.thinkingLevel === 'none' ? 'off' : settings.thinkingLevel,
    autoCompactionEnabled: settings.autoCompactionEnabled,
  });
  return result.session;
};

/**
 * SubagentManager singleton. Owns the per-(agentId, actorId) registry of
 * spawned subagents and the periodic GC sweep. The `onEvent` callback
 * broadcasts state transitions to the renderer via the `subagent:event`
 * IPC channel (consumed by the Subagent panel + `piAPI.onSubagentEvent`).
 *
 * Constructed before `agentRegistry` so the latter can inject the
 * `actor` tool via `getSubagentManager`. GC sweep is started in
 * `app.whenReady()` (after all IPC handlers are registered) so the
 * unref'd timer doesn't race with shutdown during early startup errors.
 */
const subagentManager = new SubagentManager({
  sessionFactory: subagentSessionFactory,
  onEvent: (event) => sendToRenderer('subagent:event', event),
});

const agentRegistry = new AgentRuntimeRegistry({
  getWorkspace: (workspaceId: string) => store.get('workspaces').find((workspace) => workspace.id === workspaceId),
  pendingEdits: piPendingEdits,
  send: sendToRenderer,
  agentDir: PI_AGENT_DIR,
  getSettings: () => store.get('settings'),
  getEffectiveToolPermissions: (workspaceId, sessionId) => {
    const sessionPermissions = sessionId
      ? sessionToolPermissions.get(sessionId)
      : undefined;
    const workspacePermissions = store.get('settings')?.workspaceToolDefaults?.[workspaceId];
    return resolveStoredToolPermissions({ sessionPermissions, workspacePermissions });
  },
  resolveNativeSessionPath: (sessionId) => {
    const sessionPath = resolveNativeSessionPath(app.getPath('userData'), sessionId);
    mkdirSync(dirname(sessionPath), { recursive: true });
    return sessionPath;
  },
  getPiAgentConfig: () => piAgentConfig,
  getTaskService: () => taskService,
  getMemoryService: () => memoryService,
  getModeOptions: getLongHorizonModeOptions,
  getSubagentManager: () => subagentManager,
  onTurnEnd: (workspaceId, agentId) => goalService?.onTurnEnd(workspaceId, agentId),
});
if (process.env.CI === "1" || process.env.NODE_ENV === "test") {
  (globalThis as PiDesktopTestGlobals).__PI_DESKTOP_TEST_AGENT_REGISTRY__ = agentRegistry;
}
const configManager = new ConfigManager(PI_AGENT_DIR);
const codexSessionImporter = new CodexSessionImporter();
const claudeSessionImporter = new ClaudeSessionImporter();
let goalService: GoalService | null = null;
let judgeModelClient: JudgeModelClient | null = null;
let memoryService: MemoryService | null = null;
let checkpointService: CheckpointService | null = null;
let taskService: TaskService | null = null;
let markdownMemoryService: MarkdownMemoryService | null = null;
let sessionSummaryService: SessionSummaryService | null = null;
let autoScheduler: AutoScheduler | null = null;

function refreshPiAgentConfig(configManager: ConfigManager): PiAgentConfig | null {
  piAgentConfig = configManager.loadPiAgentConfig();
  return piAgentConfig;
}

function apiFromApiType(apiType?: string): string | undefined {
  const trimmed = apiType?.trim();
  if (!trimmed) return undefined;
  if (trimmed === 'openai' || trimmed === 'openai-chat-completions' || trimmed === 'openai-completions') return 'openai-completions';
  if (trimmed === 'responses' || trimmed === 'openai-responses') return 'openai-responses';
  if (trimmed === 'anthropic' || trimmed === 'anthropic-messages') return 'anthropic-messages';
  return trimmed;
}

async function resolveJudgeApiKey(providerId: string): Promise<string | undefined> {
  const [authResult, modelsResult] = await Promise.all([
    configManager.getAuthConfig(),
    configManager.getModelsConfig(),
  ]);
  const authItem = authResult.parsed[providerId];
  return authItem?.key ?? authItem?.apiKey ?? modelsResult.parsed.providers?.[providerId]?.apiKey;
}

async function resolveJudgeProvider(providerId: string): Promise<ResolvedProvider> {
  const config = refreshPiAgentConfig(configManager);
  const provider = config?.providers.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error(`judge provider not found: ${providerId}`);
  return {
    id: provider.id,
    baseUrl: provider.baseUrl,
    api: apiFromApiType(provider.api ?? provider.apiType) ?? 'openai-completions',
    apiKey: await resolveJudgeApiKey(provider.id),
    models: provider.models.map((model) => ({ id: model.id })),
  };
}

function resolveConfiguredModelRef(): { providerId: string; modelId: string } | null {
  const settings = store.get('settings');
  const longHorizon = normalizeLongHorizonSettings(settings.longHorizon ?? DEFAULT_LONG_HORIZON_SETTINGS);
  const judgeProvider = longHorizon.goal.judgeProvider?.trim();
  const judgeModel = longHorizon.goal.judgeModel?.trim();
  if (judgeProvider && judgeModel) return { providerId: judgeProvider, modelId: judgeModel };
  const providerId = settings.provider ?? piAgentConfig?.defaultProvider;
  const modelId = settings.model ?? piAgentConfig?.defaultModel;
  if (!providerId || !modelId) return null;
  return { providerId, modelId };
}

async function resolveActiveModel(_workspaceId: string): Promise<{ provider: ResolvedProvider; model: ResolvedModel } | null> {
  const modelRef = resolveConfiguredModelRef();
  if (!modelRef) return null;
  const provider = await resolveJudgeProvider(modelRef.providerId);
  const model = provider.models?.find((candidate) => candidate.id === modelRef.modelId) ?? { id: modelRef.modelId };
  return { provider, model };
}

async function lookupTranscript(workspaceId: string, agentId?: string): Promise<Array<{ role: 'user' | 'assistant'; content: string; id?: string }>> {
  const repository = getSessionRepository();
  const sessions = await repository.listSessionSummaries();
  const candidates = sessions
    .filter((session) => session.workspaceId === workspaceId && (!agentId || session.id === agentId))
    .sort((a, b) => (b.lastOpenedAt ?? b.updatedAt) - (a.lastOpenedAt ?? a.updatedAt));
  const session = candidates[0] ? await repository.getSession(candidates[0].id) : undefined;
  const transcript: Array<{ role: 'user' | 'assistant'; content: string; id?: string }> = [];
  for (const message of session?.messages ?? []) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (message.content.trim().length === 0) continue;
    transcript.push({
      id: message.id,
      role: message.role,
      content: message.content,
    });
  }
  return buildSafeJudgeTranscript(transcript);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_WIDTH,
    minHeight: MAIN_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    // Custom title bar (renderer-controlled)
    //  - darwin: hiddenInset preserves native traffic lights
    //  - 其他: frame:false 全部由 renderer 渲染 drag region + 按钮
    ...resolveMainWindowChromeOptions(process.platform),
    webPreferences: {
      ...resolveMainWindowPerformancePreferences(),
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // audit round 3, Task 2.2: attach window-open / will-navigate guards BEFORE
  // any renderer content loads so an early XSS payload can't race past them.
  attachWebSecurityHandlers(mainWindow);
  attachRendererCrashDiagnostics({ webContents: mainWindow.webContents, logger: log });

  // Load the renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  if (mainWindowLifecycle) {
    mainWindowLifecycle.attachMainWindow(mainWindow);
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
  const sessions = getSessionRepository();
  void sessions.listSessionSummaries().then((items) => {
    for (const session of items) {
      if (session.toolPermissions) sessionToolPermissions.set(session.id, session.toolPermissions);
    }
  }).catch((error) => log.error('[Main] session summary hydration failed:', error));
  // Pi session (long-lived AgentSession)
  const longHorizonRoot = join(app.getPath('userData'), 'long-horizon');
  memoryService ??= new MemoryService({ rootDir: longHorizonRoot });
  taskService ??= new TaskService(memoryService.getDatabase());
  judgeModelClient ??= new JudgeModelClient({
    resolveProvider: resolveJudgeProvider,
    resolveApiKey: resolveJudgeApiKey,
  });
  goalService ??= new GoalService({
    database: memoryService.getDatabase(),
    legacyStateFile: join(longHorizonRoot, 'goals.json'),
    send: (channel, _workspaceId, payload) => sendToRenderer(channel, payload),
    taskService,
    // Stop-gate trigger (Phase C Task 3): let GoalService read the per-workspace
    // long-horizon toggle so onTurnEnd can short-circuit when goal evaluation
    // is disabled. Task 4 will additionally consult goal.evaluateInterval /
    // goal.maxReact once that type is extended.
    getLongHorizonSettings: () => normalizeLongHorizonSettings(store.get('settings').longHorizon ?? DEFAULT_LONG_HORIZON_SETTINGS),
    judgeModelClient,
    // Inject verdict.reason as a synthetic followUp turn on inconclusive
    // judge results. Wraps the existing Pi AgentSession.sendUserMessage
    // (already patched in factory.ts to route `deliverAs: "followUp"` through
    // the Pi queue when the agent is mid-stream).
    //
    // 主聊天路径已迁移到 `agentRegistry` (AgentRuntimeRegistry), 但这里原先
    // 只查 `piRegistry` (legacy WorkspaceRegistry) → 当 workspace 只有 agent
    // 会话时 followUp 静默 no-op, 长程目标的 inconclusive 注入失效。
    // 现在 agent 优先, piRegistry 仅作 fallback, 保证两种 runtime 都能注入。
    agentSessionLookup: (workspaceId) => {
      const agent = agentRegistry.findDefaultAgent(workspaceId);
      if (agent) {
        try {
          const ws = agentRegistry.getWorkspaceSession(agent.id);
          return {
            followUp: async (message: string) => {
              await ws.session.sendUserMessage(message, { deliverAs: 'followUp' } as never);
            },
          };
        } catch (err) {
          log.warn('[Main] GoalService agentSessionLookup: agent registry miss, falling back to piRegistry:', err);
        }
      }
      const ws = piRegistry.tryGetWorkspaceSession(workspaceId);
      if (!ws) return null;
      return {
        followUp: async (message: string) => {
          await ws.session.sendUserMessage(message, { deliverAs: 'followUp' } as never);
        },
      };
    },
    resolveActiveModel,
    transcriptLookup: lookupTranscript,
  });
  // Wire the stop-gate hook: every `turn_end` Pi event forwarded by
  // event-bridge.ts will now trigger GoalService.onTurnEnd, which runs the
  // judge and either applies the verdict (satisfied/failed), injects a
  // followUp (inconclusive, within MAX_GOAL_REACT), or fails open.
  // Fire-and-forget with a catch so a flaky judge never tears down the
  // session — GoalService.evaluate already fail-opens to inconclusive.
  //
  // 去重: 当该 workspace 已有 agent 会话时, agentRegistry 的 onTurnEnd 已经
  // 触发过 GoalService.onTurnEnd (见 AgentRuntimeRegistry 构造注入), 这里
  // 再从 piRegistry 触发会造成双 judge / 重复 toast。仅在没有 agent 会话
  // 的纯 legacy 路径才让 piRegistry 触发。
  piRegistry.setOnTurnEnd((workspaceId) => {
    if (agentRegistry.findDefaultAgent(workspaceId)) return; // agent 路径已处理
    void goalService?.onTurnEnd(workspaceId).catch((err) => {
      log.warn('[Main] GoalService.onTurnEnd failed:', err);
    });
  });
  // Thread GoalService.disposeWorkspace into the registry's dispose path so
  // react/turn counters don't leak across workspace session recreation.
  piRegistry.setOnDisposeWorkspace((workspaceId) => {
    try {
      goalService?.disposeWorkspace(workspaceId);
    } catch (err) {
      log.warn('[Main] GoalService.disposeWorkspace failed:', workspaceId, err);
    }
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
    transcriptLookup: lookupTranscript,
    getWorkspace: (id: string) => store.get('workspaces').find((w) => w.id === id),
    getDefaultWorkspace: () => {
      return getMostRecentlyActiveWorkspace(store.get('workspaces'));
    },
    getWorkspacePlanMode,
    setWorkspacePlanMode,
    // 只允许主聊天窗发起 approval/permission/plan/autoApprove;
    // settings 窗的请求被静默忽略, 防止被设置窗的 XSS/误调用绕过审批。
    isSettingsWebContents: (sender) => {
      const settings = getSharedSettingsWindow();
      return !!settings && !settings.isDestroyed() && sender === settings.webContents;
    },
  });

  setupAgentsIpc(agentRegistry);

  // ── Subagent system (Phase 2 wire-inert-subsystems) ────────────────────
  //  - markdownMemoryService: FTS5-backed markdown memory search (used by
  //    dream/distill subagents via spawn-handler's buildSubagentCustomTools).
  //  - sessionSummaryService: read-only adapter over persisted Session[] —
  //    lets dream subagents review recent work without DB/file access.
  //  - setupSubagentIpc: list-types / list-instances / cancel channels.
  //  - subagentManager.start(): kick off the GC sweep (unref'd timer; won't
  //    block process exit). Idempotent — safe even if start() is called twice.
  //  - AutoScheduler: per-tick, scans active workspaces and spawns dream/distill
  //    subagents when the primary agent is idle, no subagent is in-flight, and
  //    the configured interval has elapsed since the last run.
  markdownMemoryService ??= new MarkdownMemoryService({});
  sessionSummaryService ??= new SessionSummaryService(sessions);
  setupSubagentIpc({ subagentManager });
  subagentManager.start();

  const subagentSpawnHandlerDeps: SubagentSpawnHandlerDeps = {
    subagentManager,
    agentRegistry,
    memoryService,
    markdownMemoryService,
    sessionSummaryService,
    // resourceLoader is intentionally omitted — distill's inventory tools
    // degrade gracefully when undefined (see spawn-handler.ts buildSubagentCustomTools).
    setLastRunAt: (workspaceId, type, ts) => {
      const map = store.get('subagentLastRunAt') ?? {};
      map[`${workspaceId}:${type}`] = ts;
      store.set('subagentLastRunAt', map);
    },
  };
  autoScheduler ??= new AutoScheduler({
    subagentManager,
    getWorkspaces: () => store.get('workspaces'),
    getAgentForWorkspace: (workspaceId) => agentRegistry.findDefaultAgent(workspaceId),
    getLongHorizonSettings: (_workspaceId) =>
      normalizeLongHorizonSettings(store.get('settings').longHorizon ?? DEFAULT_LONG_HORIZON_SETTINGS),
    spawn: createAutoSchedulerSpawnHandler(
      subagentSpawnHandlerDeps,
      (id) => store.get('workspaces').find((w) => w.id === id),
    ),
    getLastRunAt: (workspaceId, type: ScheduledSubagentType) => {
      const map = store.get('subagentLastRunAt') ?? {};
      return map[`${workspaceId}:${type}`];
    },
    setLastRunAt: (workspaceId, type: ScheduledSubagentType, ts: number) => {
      const map = store.get('subagentLastRunAt') ?? {};
      map[`${workspaceId}:${type}`] = ts;
      store.set('subagentLastRunAt', map);
    },
  });
  autoScheduler.start();
  setupConfigIpc(configManager, {
    onManagedModelsChanged: () => {
      refreshPiAgentConfig(configManager);
      if (piAgentConfig) {
        const currentSettings = store.get('settings');
        store.set('settings', {
          ...currentSettings,
          provider: piAgentConfig.defaultProvider,
          model: piAgentConfig.defaultModel,
        });
      }
      modelConfigRefreshTail = modelConfigRefreshTail.catch(() => undefined).then(async () => {
        const workspaceIds = [...new Set(agentRegistry.list().map((agent) => agent.workspaceId))];
        await Promise.all(workspaceIds.map((workspaceId) => agentRegistry.refreshWorkspace(workspaceId)));
        piRegistry.disposeAll();
      });
      void modelConfigRefreshTail.catch((error) => {
        log.error("[Main] failed to refresh live model registries after config change:", error);
      });
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
    // 共享同一队列, 避免 plan-mode 切换与 workspace CRUD 互相覆盖。
    mutateWorkspaces,
    disposeWorkspaceSession: (workspaceId) => {
      piRegistry.dispose(workspaceId);
      agentRegistry.disposeWorkspace(workspaceId);
    },
  });

  // Session management (delegated to sessions.ipc.ts)
  setupSessionsIpc({
    repository: sessions,
    renameNativeSession: async (sessionId, title) => {
      const activeAgent = agentRegistry.list().find((agent) => agent.sessionId === sessionId);
      if (activeAgent) {
        agentRegistry.getWorkspaceSession(activeAgent.id).session.setSessionName(title);
        return;
      }
      const sessionPath = resolveNativeSessionPath(app.getPath('userData'), sessionId);
      if (!existsSync(sessionPath)) return;
      const sdk = await loadPiSdk();
      sdk.SessionManager.open(sessionPath).appendSessionInfo(title);
    },
    forkNativeSession: async ({ sourceSessionId, targetSessionId, workspaceId, fromMessageId, messages }) => {
      const workspace = store.get('workspaces').find((candidate) => candidate.id === workspaceId);
      if (!workspace) throw new Error(`工作区不存在: ${workspaceId}`);
      const settings = store.get('settings');
      await forkNativeSession({
        sourcePath: resolveNativeSessionPath(app.getPath('userData'), sourceSessionId),
        targetPath: resolveNativeSessionPath(app.getPath('userData'), targetSessionId),
        targetCwd: workspace.path,
        messages,
        fromMessageId,
        provider: settings.provider,
        model: settings.model,
      });
    },
    onSessionUpdated: (session) => {
      if (session.toolPermissions) sessionToolPermissions.set(session.id, session.toolPermissions);
      else sessionToolPermissions.delete(session.id);
    },
    onSessionDeleted: (sessionId) => sessionToolPermissions.delete(sessionId),
  });

  setupPackagesIpc();
  setupProjectShellIpc();

  setupGitIpc();

  setupSettingsIpc({
    store,
    getPiAgentConfig: () => piAgentConfig,
    reloadPiAgentConfig: () => refreshPiAgentConfig(configManager),
    piAgentDir: PI_AGENT_DIR,
    onSettingsChanged: async (next, previous) => {
      const modelChanged = previous.provider !== next.provider || previous.model !== next.model;
      if (modelChanged && next.provider && next.model) {
        await modelConfigRefreshTail;
        await Promise.all([
          agentRegistry.setModelForAll(next.provider, next.model),
          piRegistry.setModelForAll(next.provider, next.model),
        ]);
      }

      if ((previous.generatedUiEnabled !== false) !== (next.generatedUiEnabled !== false)) {
        piRegistry.disposeAll();
      }

      if (shouldRefreshSessionsForSettingsChange(previous, next)) {
        const workspaceIds = [...new Set(agentRegistry.list().map((agent) => agent.workspaceId))];
        for (const workspaceId of workspaceIds) {
          void agentRegistry.refreshWorkspace(workspaceId).catch((error) => {
            log.warn("[Main] failed to refresh workspace runtime after settings change:", workspaceId, error);
          });
        }
      }
    },
  });

  setupSettingsWindowIpc(() => mainWindow);
  if (desktopOverlayWindowManager) {
    setupDesktopOverlayIpc(desktopOverlayWindowManager);
  }
  setupUpdaterIpc(updaterService);
  setupDiagnosticsIpc({
    getMainWindow: () => mainWindow,
    buildReport: async () => {
      const sessionStats = await sessions.getStats();
      return buildDiagnosticReport({
      appVersion: app.getVersion(),
      userDataPath: app.getPath("userData"),
      logPath: log.transports.file.getFile().path,
      platform: process.platform,
      versions: {
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
      },
      workspaces: store.get("workspaces"),
        sessionStats: { count: sessionStats.sessionCount, messageCount: sessionStats.messageCount },
        databaseHealth: sessions.checkHealth(),
      });
    },
  });

  // Terminal (node-pty) — 注入 getMainWindow, 避免设置窗先创建时终端输出进错窗。
  setupTerminalIpc({ getMainWindow: () => mainWindow });

  // Custom title bar (renderer-controlled)
  setupWindowIpc(() => mainWindow);
  setupWindowEvents(() => mainWindow);

  // Workbench context (renderer tells main which file user is viewing)
  setupWorkbenchIpc();

  // Plan file CRUD IPC (Task 4.4) — plan:create/list/get/update/complete/delete
  setupPlanIpc({
    planFileService,
    getWorkspace: (id: string) => store.get('workspaces').find((w) => w.id === id),
  });

  // Task IPC (Phase B Task 4) — task:create/list/get/start/block/unblock/done/abandon/rename
  // workspace → session 解析: Task 1 迁移策略把 session_id 设为 workspace_id,
  // 当前每个 workspace 只有一个活跃 session,直接用 workspaceId 作为 session_id.
  // TODO: 当 multi-session per workspace 上线后,需要真正的 workspace → session 映射.
  setupTaskIpc({
    taskRegistry: taskService.getRegistry(),
    getWorkspaceSessionId: (workspaceId: string) => workspaceId,
  });

}

/**
 * Cleanup flag — ensures cleanupAllServices() is a true no-op on second call.
 * Both `window-all-closed` (which fires on Windows/Linux when quitting) and
 * `will-quit` (fallback for Cmd+Q / system shutdown) call this function, so
 * without the flag the second call would attempt to close already-closed
 * resources and log spurious errors.
 */
let servicesCleanedUp = false;

/**
 * Tear down all long-running services on app shutdown.
 *
 * Covers services NOT already handled by `window-all-closed`'s existing
 * piDriver / piPendingEdits / piRegistry / ptyManager cleanup:
 *  - autoScheduler: stop the periodic spawn tick (no new subagents mid-teardown).
 *  - subagentManager: cancel running actors + dispose their AgentSessions.
 *    Runs BEFORE primary-session cleanup so subagents don't outlive their
 *    primary agent.
 *  - markdownMemoryService: close its FTS5 SQLite index handle.
 *  - memoryService: close SQLite handle (otherwise WAL stays uncheckpointed
 *    on hard-kill). taskService and checkpointService share this database,
 *    so closing it once covers all three.
 *  - goalService: close its SQLite handle if it owns the database.
 *
 * Async close methods are fire-and-forget with .catch handlers — Electron
 * doesn't await async work in window-all-closed / will-quit anyway, but we
 * still need to swallow rejections to avoid "unhandled promise rejection"
 * crashes.
 *
 * Idempotent via the `servicesCleanedUp` flag.
 */
function cleanupAllServices(): void {
  if (servicesCleanedUp) return;
  servicesCleanedUp = true;
  // Subagent system teardown (Phase 2 wire-inert-subsystems):
  //  1. Stop the AutoScheduler tick so no new subagents are spawned mid-teardown.
  //  2. Dispose all subagents (cancels running actors + disposes their
  //     AgentSessions) BEFORE primary sessions are torn down — subagent
  //     sessions must not outlive their primary agent.
  //  3. Close the markdown memory SQLite index.
  // All three are best-effort — failures are logged but don't block the
  // subsequent memoryService / goalService cleanup.
  try {
    autoScheduler?.stop();
  } catch (e) {
    log.error("autoScheduler stop failed:", e);
  }
  try {
    subagentManager?.disposeAll();
  } catch (e) {
    log.error("subagentManager disposeAll failed:", e);
  }
  try {
    markdownMemoryService?.close();
  } catch (e) {
    log.error("markdownMemoryService close failed:", e);
  }
  try {
    memoryService?.close()?.catch((e: unknown) => log.error("memoryService close failed:", e));
  } catch (e) {
    log.error("memoryService close failed:", e);
  }
  try {
    goalService?.close()?.catch((e: unknown) => log.error("goalService close failed:", e));
  } catch (e) {
    log.error("goalService close failed:", e);
  }
  try {
    sessionRepository?.close();
  } catch (e) {
    log.error("sessionRepository close failed:", e);
  }
}

// App lifecycle
app.whenReady().then(() => {
  if (!isPrimaryInstance) return;

  // audit round 3, Task 3.3: localfile:// now needs the active workspace path
  // so it can enforce a workspace boundary. We resolve it lazily on every
  // request (not captured at startup) so workspace switches take effect
  // immediately without re-registering the protocol. Mirrors the
  // getMostRecentlyActiveWorkspace lookup used by skills.ipc / chat.ipc.
  registerLocalFileProtocol({
    getCurrentWorkspacePath: () =>
      getMostRecentlyActiveWorkspace(store.get('workspaces'))?.path ?? null,
  });

  // 先加载 Pi 配置，再初始化
  refreshPiAgentConfig(configManager);
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
  desktopOverlayWindowManager = new DesktopOverlayWindowManager(() => mainWindow);
  desktopOverlayWindowManager.ensureWindow();
  mainWindowLifecycle = createMainWindowLifecycleController({
    getMainWindow: () => mainWindow,
    overlay: desktopOverlayWindowManager,
    createTray: (iconPath) => new Tray(iconPath),
    buildTrayMenu: ({ show, quit }) => Menu.buildFromTemplate([
      { label: "显示主窗口", click: show },
      { type: "separator" },
      { label: "退出", click: quit },
    ]),
    onQuitRequested: () => app.quit(),
  });
  if (mainWindow) {
    mainWindowLifecycle.attachMainWindow(mainWindow);
  }
  if (restoreRequestedBeforeReady) {
    restoreRequestedBeforeReady = false;
    mainWindowLifecycle.restoreMainWindow();
  }
  try {
    const trayIconResolution = resolveTrayIconPath({
      appPath: app.getAppPath(),
      cwd: process.cwd(),
      resourcesPath: process.resourcesPath,
    });
    if (!trayIconResolution.path) {
      throw new Error(`tray icon not found; checked=${trayIconResolution.checkedPaths.join(", ")}`);
    }
    const trayIcon = nativeImage.createFromPath(trayIconResolution.path);
    if (trayIcon.isEmpty()) {
      throw new Error(`tray icon could not be loaded from ${trayIconResolution.path}`);
    }
    log.info(`[Main] initializing tray icon from ${trayIconResolution.path}`);
    mainWindowLifecycle.ensureTray(trayIcon);
  } catch (error) {
    log.error("[Main] failed to initialize tray:", error);
  }
  setExtensionUiTargetResolver((payload) => desktopOverlayWindowManager?.getPermissionTarget(payload) ?? mainWindow);
  if (process.env.CI === "1" || process.env.NODE_ENV === "test") {
    (globalThis as PiDesktopTestGlobals).__PI_DESKTOP_TEST_OVERLAY__ = {
      emitPermissionRequest: (payload) => {
        const targetWindow = desktopOverlayWindowManager?.getPermissionTarget({
          workspaceId: payload.workspaceId,
          agentId: payload.agentId ?? undefined,
          source: "permission",
        }) ?? mainWindow;
        targetWindow?.webContents.send("permission:request", {
          requestId: payload.requestId,
          workspaceId: payload.workspaceId,
          agentId: payload.agentId ?? undefined,
          kind: "select",
          source: "permission",
          title: payload.title,
          message: payload.message,
          createdAt: Date.now(),
        });
      },
    };
    (globalThis as PiDesktopTestGlobals).__PI_DESKTOP_TEST_SHELL__ = {
      hasTray: () => mainWindowLifecycle?.hasTray() ?? false,
      closeMainWindow: () => {
        mainWindow?.close();
      },
      restoreMainWindow: () => {
        mainWindowLifecycle?.restoreMainWindow();
      },
      isMainWindowVisible: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
      quitApp: () => {
        mainWindowLifecycle?.requestQuit();
      },
    };
  }
  const updaterService = setupAutoUpdater();
  setupIPC(updaterService);
  initializePiDriver();

  app.on('before-quit', () => {
    mainWindowLifecycle?.beginQuit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
    mainWindowLifecycle?.restoreMainWindow();
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
  delete (globalThis as PiDesktopTestGlobals).__PI_DESKTOP_TEST_OVERLAY__;
  delete (globalThis as PiDesktopTestGlobals).__PI_DESKTOP_TEST_SHELL__;

  // 清理所有终端进程 (M4: 走 ptyManager)
  ptyManager.closeAll();

  // Close long-running services (SQLite WAL checkpoint, goal-service DB
  // handle). Idempotent — safe to also call from will-quit.
  cleanupAllServices();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Fallback cleanup for Cmd+Q / system shutdown / process kill — fires even
// when window-all-closed doesn't (e.g. tray-only quit). Idempotent: the
// servicesCleanedUp flag inside cleanupAllServices makes this a no-op if
// window-all-closed already ran cleanup.
app.on('will-quit', () => {
  cleanupAllServices();
});
