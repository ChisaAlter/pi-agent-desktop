import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import type { BrowserWindow as BrowserWindowType } from 'electron';

const trackedMaximizedState = new WeakMap<BrowserWindowType, boolean>();
const normalBoundsBeforeMaximize = new WeakMap<BrowserWindowType, Rectangle>();
const activeWindowDrags = new WeakMap<BrowserWindowType, {
  pointerStartX: number;
  pointerStartY: number;
  windowStartX: number;
  windowStartY: number;
}>();

function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

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
    const isMaximized = trackedMaximizedState.get(win) ?? win.isMaximized();
    if (isMaximized) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        const bounds = normalBoundsBeforeMaximize.get(win);
        if (bounds) win.setBounds(bounds);
      }
      normalBoundsBeforeMaximize.delete(win);
      trackedMaximizedState.set(win, false);
      win.webContents.send("window:maximize-changed", false);
    } else {
      normalBoundsBeforeMaximize.set(win, win.getBounds());
      win.maximize();
      trackedMaximizedState.set(win, true);
      win.webContents.send("window:maximize-changed", true);
    }
  });

  ipcMain.handle("window:is-maximized", (event) => {
    const win = windowFromEvent(event) ?? getMainWindow();
    return win && !win.isDestroyed() ? trackedMaximizedState.get(win) ?? win.isMaximized() : false;
  });

  ipcMain.on("window:drag-start", (event, screenX: unknown, screenY: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
    if (!win || win.isDestroyed() || !isFiniteCoordinate(screenX) || !isFiniteCoordinate(screenY)) return;
    if (trackedMaximizedState.get(win) ?? win.isMaximized()) return;
    const bounds = win.getBounds();
    activeWindowDrags.set(win, {
      pointerStartX: screenX,
      pointerStartY: screenY,
      windowStartX: bounds.x,
      windowStartY: bounds.y,
    });
  });

  ipcMain.on("window:drag-move", (event, screenX: unknown, screenY: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
    if (!win || win.isDestroyed() || !isFiniteCoordinate(screenX) || !isFiniteCoordinate(screenY)) return;
    const drag = activeWindowDrags.get(win);
    if (!drag) return;
    win.setPosition(
      Math.round(drag.windowStartX + screenX - drag.pointerStartX),
      Math.round(drag.windowStartY + screenY - drag.pointerStartY),
    );
  });

  ipcMain.on("window:drag-end", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
    if (win) activeWindowDrags.delete(win);
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
        trackedMaximizedState.set(w, maximized);
        w.webContents.send("window:maximize-changed", maximized);
      }
    };
    win.on("maximize", () => sendMaximizeState(true));
    win.on("unmaximize", () => sendMaximizeState(false));
  }
}
