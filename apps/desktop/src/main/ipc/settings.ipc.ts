import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log/main';
import { ipcError } from '@shared';
import type { AppSettings, Workspace } from '@shared';
import type { PiAgentConfig } from '../types';
import { settingsSetSchema } from './schemas';
import { listLocalSkills } from '../services/skills/list-local-skills';

export function setupSettingsIpc(opts: {
  store: {
    get: ((key: 'settings') => AppSettings) & ((key: 'workspaces') => Workspace[]);
    set: (key: 'settings', value: AppSettings) => void;
  };
  getPiAgentConfig: () => PiAgentConfig | null;
  piAgentDir: string;
  onSettingsChanged?: (next: AppSettings, previous: AppSettings) => void;
}): void {
  const { store, getPiAgentConfig, piAgentDir, onSettingsChanged } = opts;

  const broadcastSettingsChanged = (settings: AppSettings): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send("settings:changed", settings);
      }
    }
  };

  ipcMain.handle('settings:get', async () => {
    return store.get('settings');
  });

  ipcMain.handle('settings:set', async (_, settings: Partial<AppSettings>) => {
    try {
      settingsSetSchema.parse([settings]);
    } catch (err) {
      log.warn("[settings.ipc] settings:set invalid args:", err);
      return ipcError(
        "ipcErrors.settings.invalidArgs",
        `设置参数无效: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const current = store.get('settings');
    // SubTask 40.6: shallow copy is sufficient — the spread below only replaces
    // top-level keys, so we never mutate nested fields of `previous`.
    const previous = { ...current };
    const updated = { ...current, ...settings };
    store.set('settings', updated);
    onSettingsChanged?.(updated, previous);
    broadcastSettingsChanged(updated);
    return updated;
  });

  ipcMain.handle('settings:load-pi-config', async () => {
    const piAgentConfig = getPiAgentConfig();
    if (!piAgentConfig) return { models: [], currentModel: null };

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

    const currentModel = piAgentConfig.defaultModel ? {
      model: piAgentConfig.defaultModel,
      provider: piAgentConfig.defaultProvider
    } : null;

    if (currentModel) {
      const currentSettings = store.get('settings');
      if (!currentSettings.model && !currentSettings.provider) {
        store.set('settings', {
          ...currentSettings,
          model: currentModel.model,
          provider: currentModel.provider,
        });
        broadcastSettingsChanged(store.get('settings'));
      }
    }

    return { models, currentModel };
  });

  ipcMain.handle('pi:get-full-config', async () => {
    const piAgentConfig = getPiAgentConfig();
    if (!piAgentConfig) {
      return {
        configPath: piAgentDir,
        defaultProvider: 'google',
        defaultModel: '',
        providers: []
      };
    }

    return {
      configPath: piAgentDir,
      defaultProvider: piAgentConfig.defaultProvider,
      defaultModel: piAgentConfig.defaultModel,
      providers: piAgentConfig.providers.map(p => ({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        modelCount: p.models.length,
        hasApiKey: Boolean(p.apiKey)
      }))
    };
  });

  ipcMain.handle('pi:list-skills', async (_, args?: { workspaceId?: string }) => {
    try {
      const workspaceId = args?.workspaceId;
      const workspaces = store.get('workspaces');
      const ws = workspaces.find(w => w.id === workspaceId);
      if (!ws) return ipcError("ipcErrors.settings.workspaceNotFound", "工作区不存在");
      return await listLocalSkills(ws.path);
    } catch (error) {
      log.error('Failed to list skills:', error);
      return [];
    }
  });

  // Renderer log forwarding to main process electron-log
  ipcMain.on('log:write', (_event, level: string, message: string, extra: unknown) => {
    const safeLevel: "error" | "warn" | "info" | "debug" =
      level === "error" || level === "warn" || level === "info" || level === "debug"
        ? level
        : "info";
    const safeExtra = Array.isArray(extra) ? (extra as unknown[]) : [];
    log[safeLevel]("[renderer] " + message, ...safeExtra);
  });
}
