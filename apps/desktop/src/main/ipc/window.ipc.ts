import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';

function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindowType | null {
  return BrowserWindow.fromWebContents(event.sender);
}

export function setupWindowIpc(getMainWindow: () => BrowserWindowType | null): void {
  ipcMain.handle("window:minimize", (event) => {
    const win = windowFromEvent(event) ?? getMainWindow();
    if (win && !win.isDestroyed()) win.minimize();
  });

  ipcMain.handle("window:toggle-maximize", (event) => {
    const win = windowFromEvent(event) ?? getMainWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMaximized()) {
      win.unmaximize();
      win.webContents.send("window:maximize-changed", false);
    } else {
      win.maximize();
      win.webContents.send("window:maximize-changed", true);
    }
  });

  ipcMain.handle("window:is-maximized", (event) => {
    const win = windowFromEvent(event) ?? getMainWindow();
    return win && !win.isDestroyed() ? win.isMaximized() : false;
  });

  ipcMain.handle("window:close", (event) => {
    const win = windowFromEvent(event) ?? getMainWindow();
    if (win && !win.isDestroyed()) win.close();
  });
}

export function setupWindowEvents(getMainWindow: () => BrowserWindowType | null): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    const sendMaximizeState = (maximized: boolean): void => {
      const w = getMainWindow();
      if (w && !w.isDestroyed()) {
        w.webContents.send("window:maximize-changed", maximized);
      }
    };
    win.on("maximize", () => sendMaximizeState(true));
    win.on("unmaximize", () => sendMaximizeState(false));
  }
}
