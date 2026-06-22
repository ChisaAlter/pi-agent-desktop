import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import log from 'electron-log/main';
import { ipcError } from '@shared';
import type { AppSettings } from '@shared';
import type { PiAgentConfig } from '../types';
import { settingsSetSchema } from './schemas';

export function setupSettingsIpc(opts: {
  store: { get: (key: 'settings') => AppSettings; set: (key: 'settings', value: AppSettings) => void };
  getPiAgentConfig: () => PiAgentConfig | null;
  piAgentDir: string;
}): void {
  const { store, getPiAgentConfig, piAgentDir } = opts;

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
    const updated = { ...current, ...settings };
    store.set('settings', updated);
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
        hasApiKey: false
      }))
    };
  });

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

          const skillMdPath = join(skillPath, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            try {
              const content = readFileSync(skillMdPath, 'utf-8');
              const lines = content.split('\n').filter((l: string) => l.trim());
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
