import type { NativeImage } from "electron";
import {
  createWindowsFirstClickController,
  type FocusCapableApp,
  type FocusCapableWindow,
  type ForegroundScheduler,
} from "./windows-first-click";

type CloseEventLike = {
  preventDefault(): void;
};

type TrayIconLike = string | NativeImage;

type MainWindowLike = FocusCapableWindow & {
  on(event: "close" | "show" | "hide", listener: ((event: CloseEventLike) => void) | (() => void)): void;
  hide(): void;
};

type TrayLike = {
  on(event: "click" | "right-click" | "double-click", listener: () => void): void;
  destroy(): void;
  setToolTip(text: string): void;
  setContextMenu(menu: unknown): void;
  /** Prefer this over permanent setContextMenu on Windows so left-click is not swallowed. */
  popUpContextMenu?(menu?: unknown): void;
};

type OverlayLifecycleLike = {
  refreshVisibility(): void;
  destroy(): void;
};

interface MainWindowLifecycleControllerOptions {
  getMainWindow: () => MainWindowLike | null;
  overlay?: OverlayLifecycleLike | null;
  createTray: (icon: TrayIconLike) => TrayLike;
  buildTrayMenu: (actions: { show: () => void; quit: () => void }) => unknown;
  onQuitRequested: () => void;
  beforeShowMainWindow?: () => void;
  /** Optional platform override for tests; defaults to process.platform. */
  platform?: NodeJS.Platform;
  /** Optional app-level focus steal (Electron app.focus({ steal: true })). */
  focusApp?: () => void;
  schedule?: ForegroundScheduler;
  /** Electron app object for steal-focus; used to keep first-click foreground reliable. */
  focusAppObject?: FocusCapableApp;
  /**
   * Optional shared first-click controller so tray/taskbar/pointer share one
   * debounce + always-on-top hold token. When omitted, a local controller is created.
   */
  firstClickController?: ReturnType<typeof createWindowsFirstClickController>;
}

export interface MainWindowLifecycleController {
  attachMainWindow(win: MainWindowLike): void;
  ensureTray(icon: TrayIconLike): TrayLike;
  hasTray(): boolean;
  restoreMainWindow(): void;
  beginQuit(): void;
  requestQuit(): void;
  isQuitting(): boolean;
}

export function createMainWindowLifecycleController(
  options: MainWindowLifecycleControllerOptions,
): MainWindowLifecycleController {
  let tray: TrayLike | null = null;
  let quitting = false;
  const platform = options.platform ?? process.platform;
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs = 0) => {
      setTimeout(callback, delayMs);
    });
  const firstClick =
    options.firstClickController ??
    createWindowsFirstClickController({
      platform,
      schedule,
      focusApp: options.focusAppObject ?? (options.focusApp ? { focus: () => options.focusApp?.() } : undefined),
    });

  const syncOverlayVisibility = (): void => {
    options.overlay?.refreshVisibility();
  };

  const restoreMainWindow = (): void => {
    const win = options.getMainWindow();
    if (!win || win.isDestroyed()) return;
    options.beforeShowMainWindow?.();
    // Synchronous raise — tray click already has foreground rights on Windows.
    firstClick.raise(win);
    syncOverlayVisibility();
  };

  const beginQuit = (): void => {
    if (quitting) return;
    quitting = true;
    tray?.destroy();
    tray = null;
    options.overlay?.destroy();
  };

  const requestQuit = (): void => {
    if (quitting) return;
    beginQuit();
    options.onQuitRequested();
  };

  return {
    attachMainWindow(win) {
      win.on("close", (event) => {
        if (quitting) return;
        event.preventDefault();
        // Fully leave the taskbar so the tray icon is the only restore surface.
        win.setSkipTaskbar(true);
        win.hide();
        syncOverlayVisibility();
      });
      win.on("show", syncOverlayVisibility);
      win.on("hide", syncOverlayVisibility);
    },
    ensureTray(icon) {
      if (tray) return tray;
      tray = options.createTray(icon);
      tray.setToolTip("Pi Desktop");
      const contextMenu = options.buildTrayMenu({
        show: restoreMainWindow,
        quit: requestQuit,
      });
      // Windows: a permanent tray context menu often swallows the first left-click
      // while the app is in the background. Bind left-click to restore, and only
      // pop the menu on right-click. Debounce inside raise() collapses
      // click + double-click into a single restore.
      if (platform === "win32") {
        tray.on("click", restoreMainWindow);
        tray.on("double-click", restoreMainWindow);
        tray.on("right-click", () => {
          tray?.popUpContextMenu?.(contextMenu);
        });
      } else {
        tray.setContextMenu(contextMenu);
        tray.on("click", restoreMainWindow);
      }
      return tray;
    },
    hasTray() {
      return Boolean(tray);
    },
    restoreMainWindow,
    beginQuit,
    requestQuit,
    isQuitting() {
      return quitting;
    },
  };
}
