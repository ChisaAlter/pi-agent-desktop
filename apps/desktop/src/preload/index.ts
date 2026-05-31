// Electron Preload Script - Secure API Bridge

import { contextBridge, ipcRenderer } from 'electron';

type PiEvent = { type: string } & Record<string, unknown>;

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('piAPI', {
  // Send a prompt to Pi CLI
  sendPrompt: (message: string, sessionId?: string) => {
    return ipcRenderer.invoke('pi:prompt', message, sessionId);
  },

  // Listen for Pi events
  onEvent: (callback: (event: PiEvent) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, event: PiEvent) => callback(event);
    ipcRenderer.on('pi:event', subscription);
    
    // Return unsubscribe function
    return () => {
      ipcRenderer.removeListener('pi:event', subscription);
    };
  },

  // Listen for Pi errors
  onError: (callback: (error: string) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
    ipcRenderer.on('pi:error', subscription);
    
    return () => {
      ipcRenderer.removeListener('pi:error', subscription);
    };
  },
  // Listen for structured Pi JSON events (--mode json)
  onPiJsonEvent: (callback: (event: Record<string, unknown>) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: Record<string, unknown>) => callback(data);
    ipcRenderer.on('pi:json-event', handler);
    return () => {
      ipcRenderer.removeListener('pi:json-event', handler);
    };
  },


  // Get Pi Driver status (full detection)
  getStatus: () => {
    return ipcRenderer.invoke('pi:status');
  },

  // Refresh Pi status (async, checks remote version)
  refreshPiStatus: () => {
    return ipcRenderer.invoke('pi:refresh-status');
  },

  // Install Pi CLI
  installPi: () => {
    return ipcRenderer.invoke('pi:install');
  },

  // Update Pi CLI
  updatePi: () => {
    return ipcRenderer.invoke('pi:update');
  },

  // Uninstall Pi CLI
  uninstallPi: () => {
    return ipcRenderer.invoke('pi:uninstall');
  },

  // Cancel ongoing install/update operation
  cancelPiOperation: () => {
    return ipcRenderer.invoke('pi:cancel-operation');
  },

  // Listen for Pi status changes
  onPiStatusChanged: (callback: (status: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: any) => callback(status);
    ipcRenderer.on('pi:status-changed', handler);
    return () => {
      ipcRenderer.removeListener('pi:status-changed', handler);
    };
  },

  // Listen for Pi install/update progress
  onPiInstallProgress: (callback: (progress: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: any) => callback(progress);
    ipcRenderer.on('pi:install-progress', handler);
    return () => {
      ipcRenderer.removeListener('pi:install-progress', handler);
    };
  },

  // Stop Pi Driver
  stop: () => {
    return ipcRenderer.invoke('pi:stop');
  },

  // Workspace management
  listWorkspaces: () => ipcRenderer.invoke('workspace:list'),
  createWorkspace: (name: string, path: string) => ipcRenderer.invoke('workspace:create', name, path),
  deleteWorkspace: (id: string) => ipcRenderer.invoke('workspace:delete', id),
  selectWorkspace: (path: string) => ipcRenderer.invoke('workspace:select', path),
  selectDirectory: () => ipcRenderer.invoke('workspace:select-directory'),

  // Session management
  listSessions: () => ipcRenderer.invoke('session:list'),
  createSession: (workspaceId: string, title?: string) => ipcRenderer.invoke('session:create', workspaceId, title),
  deleteSession: (id: string) => ipcRenderer.invoke('session:delete', id),

  // Git
  getGitStatus: (workspacePath: string) => ipcRenderer.invoke('git:status', workspacePath),
  gitDiff: (workspacePath: string, filePath?: string) => ipcRenderer.invoke('git:diff', workspacePath, filePath),
  gitDiffStaged: (workspacePath: string) => ipcRenderer.invoke('git:diff-staged', workspacePath),
  gitAdd: (workspacePath: string, files: string[]) => ipcRenderer.invoke('git:add', workspacePath, files),
  gitCommit: (workspacePath: string, message: string) => ipcRenderer.invoke('git:commit', workspacePath, message),
  gitLog: (workspacePath: string, count?: number) => ipcRenderer.invoke('git:log', workspacePath, count),
  gitBranches: (workspacePath: string) => ipcRenderer.invoke('git:branches', workspacePath),

  // Project detection & file tree
  detectProject: (workspacePath: string) => ipcRenderer.invoke('project:detect', workspacePath),
  getFileTree: (workspacePath: string, maxDepth?: number) => ipcRenderer.invoke('project:file-tree', workspacePath, maxDepth),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings:set', settings),

  // Pi Config — 读取本地 Pi Agent 配置
  loadPiConfig: () => ipcRenderer.invoke('settings:load-pi-config'),

  // Skills & Plugins
  listSkills: () => ipcRenderer.invoke('pi:list-skills'),
  listPlugins: () => ipcRenderer.invoke('pi:list-plugins'),
  getFullConfig: () => ipcRenderer.invoke('pi:get-full-config'),

  // Terminal
  createTerminal: (terminalId: string) => ipcRenderer.invoke('terminal:create', terminalId),
  terminalInput: (terminalId: string, data: string) => ipcRenderer.invoke('terminal:input', terminalId, data),
  terminalResize: (terminalId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
  closeTerminal: (terminalId: string) => ipcRenderer.invoke('terminal:close', terminalId),

  onTerminalOutput: (terminalId: string, callback: (data: string) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }) => {
      if (payload.id === terminalId) {
        callback(payload.data);
      }
    };
    ipcRenderer.on('terminal:output', subscription);
    return () => {
      ipcRenderer.removeListener('terminal:output', subscription);
    };
  },

  onTerminalExit: (terminalId: string, callback: (code: number | null) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: { id: string; code: number | null }) => {
      if (payload.id === terminalId) {
        callback(payload.code);
      }
    };
    ipcRenderer.on('terminal:exit', subscription);
    return () => {
      ipcRenderer.removeListener('terminal:exit', subscription);
    };
  },

  // Messaging Gateway
  gatewayStatus: () => ipcRenderer.invoke('gateway:status'),
  gatewayConnect: (platform: string) => ipcRenderer.invoke('gateway:connect', platform),
  gatewayDisconnect: (platform: string) => ipcRenderer.invoke('gateway:disconnect', platform),
  gatewaySend: (platform: string, chatId: string, content: string) => ipcRenderer.invoke('gateway:send', platform, chatId, content),
  gatewayMessages: () => ipcRenderer.invoke('gateway:messages'),
  gatewayConfig: (config: any) => ipcRenderer.invoke('gateway:config', config),
  onGatewayMessage: (callback: (msg: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: any) => callback(msg);
    ipcRenderer.on('gateway:message', handler);
    return () => {
      ipcRenderer.removeListener('gateway:message', handler);
    };
  },
});

// Expose a limited set of node APIs
contextBridge.exposeInMainWorld('nodeAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});