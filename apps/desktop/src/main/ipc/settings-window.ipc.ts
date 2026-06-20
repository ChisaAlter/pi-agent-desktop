import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { is } from '@electron-toolkit/utils';
import log from 'electron-log/main';

let settingsWindow: BrowserWindow | null = null;

export function setupSettingsWindowIpc(getMainWindow?: () => BrowserWindow | null): void {
  ipcMain.handle('settings:open-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus();
      return;
    }

    settingsWindow = new BrowserWindow({
      width: 606,
      height: 389,
      minWidth: 606,
      minHeight: 389,
      resizable: true,
      title: '系统设置',
      modal: false,
      show: false,
      autoHideMenuBar: true,
      transparent: process.platform === "win32",
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
      settingsWindow.setBounds({
        x: mainBounds.x + 534,
        y: mainBounds.y + 388,
        width: 606,
        height: 389,
      });
    }
    settingsWindow.webContents.setZoomFactor(1.5);

    settingsWindow.on('ready-to-show', () => {
      settingsWindow?.show();
    });

    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      void settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings.html`);
    } else {
      void settingsWindow.loadFile(join(__dirname, '../renderer/settings.html'));
    }

    log.info('[SettingsWindow] Opened settings window');
  });

  ipcMain.handle('settings:close-window', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
  });
}
