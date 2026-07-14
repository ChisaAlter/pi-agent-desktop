import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import log from 'electron-log/main';
import { isSettingsWindowTab, type SettingsWindowTab } from '@shared';
import { attachWebSecurityHandlers } from '../services/web-security';

let settingsWindow: BrowserWindow | null = null;
let pendingSettingsTab: SettingsWindowTab | undefined;
let settingsRendererReady = false;

const SETTINGS_WINDOW_WIDTH = 1067;
const SETTINGS_WINDOW_HEIGHT = 800;
const SETTINGS_WINDOW_MIN_WIDTH = 960;
const SETTINGS_WINDOW_MIN_HEIGHT = 694;

function sendSettingsTab(tab: SettingsWindowTab | undefined): void {
  if (!tab || !settingsWindow || settingsWindow.isDestroyed()) return;
  settingsWindow.webContents.send('settings:select-tab', tab);
}

function selectSettingsTab(tab: SettingsWindowTab | undefined): void {
  if (!tab) return;
  if (settingsRendererReady) {
    sendSettingsTab(tab);
  } else {
    pendingSettingsTab = tab;
  }
}

export function setupSettingsWindowIpc(getMainWindow?: () => BrowserWindow | null): void {
  ipcMain.handle('settings:open-window', (_event, requestedTab?: unknown) => {
    const tab = isSettingsWindowTab(requestedTab) ? requestedTab : undefined;
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      selectSettingsTab(tab);
      return;
    }

    pendingSettingsTab = tab;
    settingsRendererReady = false;
    settingsWindow = new BrowserWindow({
      width: SETTINGS_WINDOW_WIDTH,
      height: SETTINGS_WINDOW_HEIGHT,
      minWidth: SETTINGS_WINDOW_MIN_WIDTH,
      minHeight: SETTINGS_WINDOW_MIN_HEIGHT,
      resizable: true,
      title: '系统设置',
      modal: false,
      show: false,
      autoHideMenuBar: true,
      transparent: false,
      backgroundColor: "#00000000",
      ...(process.platform === "darwin"
        ? { titleBarStyle: "hiddenInset" as const, frame: true }
        : { frame: false }),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const mainWindow = getMainWindow?.();
    if (mainWindow && !mainWindow.isDestroyed()) {
      const mainBounds = mainWindow.getBounds();
      const workArea = screen.getDisplayMatching(mainBounds).workArea;
      const centeredX = mainBounds.x + Math.round((mainBounds.width - SETTINGS_WINDOW_WIDTH) / 2);
      const centeredY = mainBounds.y + Math.round((mainBounds.height - SETTINGS_WINDOW_HEIGHT) / 2);
      const maxX = Math.max(workArea.x, workArea.x + workArea.width - SETTINGS_WINDOW_WIDTH);
      const maxY = Math.max(workArea.y, workArea.y + workArea.height - SETTINGS_WINDOW_HEIGHT);
      settingsWindow.setBounds({
        x: Math.min(Math.max(centeredX, workArea.x), maxX),
        y: Math.min(Math.max(centeredY, workArea.y), maxY),
        width: SETTINGS_WINDOW_WIDTH,
        height: SETTINGS_WINDOW_HEIGHT,
      });
    }
    settingsWindow.webContents.setZoomFactor(1.5);
    settingsWindow.webContents.on('did-start-loading', () => {
      settingsRendererReady = false;
    });

    // audit round 3, Task 2.3: settings window is a full renderer surface with
    // access to window.piAPI, so it needs the same open/navigate guards as the
    // main window. Attached before loadURL so no page can race past it.
    attachWebSecurityHandlers(settingsWindow);

    settingsWindow.on('ready-to-show', () => {
      settingsWindow?.show();
    });

    settingsWindow.on('closed', () => {
      settingsWindow = null;
      pendingSettingsTab = undefined;
      settingsRendererReady = false;
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`);
    } else {
      void settingsWindow.loadFile(join(__dirname, '../renderer/settings.html'));
    }

    log.info('[SettingsWindow] Opened settings window');
  });

  ipcMain.handle('settings:renderer-ready', (event) => {
    if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) {
      return undefined;
    }
    settingsRendererReady = true;
    const tab = pendingSettingsTab;
    pendingSettingsTab = undefined;
    return tab;
  });

  ipcMain.handle('settings:close-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
  });
}
