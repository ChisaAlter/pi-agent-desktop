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

  // Get Pi Driver status
  getStatus: () => {
    return ipcRenderer.invoke('pi:status');
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

  // Git status
  getGitStatus: (workspacePath: string) => ipcRenderer.invoke('git:status', workspacePath),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke('settings:set', settings),

  // Pi Config — 读取本地 Pi Agent 配置
  loadPiConfig: () => ipcRenderer.invoke('settings:load-pi-config'),

  // Skills & Plugins
  listSkills: () => ipcRenderer.invoke('pi:list-skills'),
  listPlugins: () => ipcRenderer.invoke('pi:list-plugins'),
  getFullConfig: () => ipcRenderer.invoke('pi:get-full-config')
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