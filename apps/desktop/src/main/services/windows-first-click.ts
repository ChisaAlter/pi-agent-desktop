/**
 * Windows first-click / tray-restore / taskbar helpers.
 *
 * Hard path (tray / hidden):
 *   show + moveTop + brief always-on-top + focus. Stay synchronous so the tray
 *   click still holds SetForegroundWindow rights.
 *
 * Soft path (taskbar / visible unfocused):
 *   restore if needed + window focus only. Never always-on-top. Never thrash
 *   webContents.focus during restore — that cancels native titlebar drag for
 *   the next few presses.
 *
 * Toggle-bug repair:
 *   unfocused minimize after a long blur is reversed. blur→minimize within
 *   200ms is intentional taskbar/titlebar minimize and must stay minimized.
 */

export type FocusCapableWindow = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isVisible(): boolean;
  isFocused?(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  moveTop(): void;
  setSkipTaskbar(skip: boolean): void;
  setAlwaysOnTop(flag: boolean): void;
  webContents?: { focus(): void; isDestroyed?: () => boolean };
  on?(
    event: "restore" | "show" | "focus" | "blur" | "minimize",
    listener: () => void,
  ): void;
};

export type FocusCapableApp = {
  focus(options?: { steal: boolean }): void;
};

export type ForegroundScheduler = (callback: () => void, delayMs?: number) => void;

export interface WindowsFirstClickOptions {
  platform?: NodeJS.Platform;
  schedule?: ForegroundScheduler;
  focusApp?: FocusCapableApp;
  focusAppObject?: FocusCapableApp;
  debounceMs?: number;
  now?: () => number;
}

export interface WindowsFirstClickController {
  raise(win: FocusCapableWindow): void;
  softFocus(win: FocusCapableWindow): void;
  ensureForeground(win: FocusCapableWindow): void;
  attachTaskbarActivation(win: FocusCapableWindow): void;
}

const DEFAULT_HOLD_MS = 80;
const DEFAULT_DEBOUNCE_MS = 350;
const INTENTIONAL_MINIMIZE_AFTER_BLUR_MS = 200;

export function createWindowsFirstClickController(
  options: WindowsFirstClickOptions = {},
): WindowsFirstClickController {
  const platform = options.platform ?? process.platform;
  const schedule =
    options.schedule ??
    ((callback: () => void, delayMs = 0) => {
      setTimeout(callback, delayMs);
    });
  const focusApp = options.focusAppObject ?? options.focusApp;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const now = options.now ?? (() => Date.now());
  let lastHardRaiseAt = 0;
  let holdToken = 0;

  const focusWindowOnly = (win: FocusCapableWindow): void => {
    if (win.isDestroyed()) return;
    if (win.isFocused?.()) return;
    win.focus();
    try {
      focusApp?.focus({ steal: true });
    } catch {
      // Older Electron builds may not support focus options.
    }
  };

  /**
   * Soft focus for taskbar / in-window activation.
   * Do not call webContents.focus — it aborts native -webkit-app-region drag.
   */
  const softFocus = (win: FocusCapableWindow): void => {
    if (platform !== "win32") return;
    if (win.isDestroyed()) return;
    win.setSkipTaskbar(false);
    if (win.isMinimized()) {
      win.restore();
    } else if (!win.isVisible()) {
      win.show();
    }
    focusWindowOnly(win);
  };

  const hardRaise = (win: FocusCapableWindow, opts?: { force?: boolean }): void => {
    if (win.isDestroyed()) return;

    const t = now();
    if (!opts?.force && t - lastHardRaiseAt < debounceMs) {
      return;
    }
    lastHardRaiseAt = t;

    win.setSkipTaskbar(false);
    if (win.isMinimized()) {
      win.restore();
    }
    win.show();
    win.moveTop();

    // try/finally so AOT can never stick if focus throws.
    try {
      win.setAlwaysOnTop(true);
      focusWindowOnly(win);
    } finally {
      const token = ++holdToken;
      schedule(() => {
        if (token !== holdToken) return;
        if (win.isDestroyed()) return;
        win.setAlwaysOnTop(false);
        // Do not re-focus here — a second focus pulse after open kills titlebar drag.
      }, DEFAULT_HOLD_MS);
    }
  };

  return {
    raise(win) {
      if (platform !== "win32") {
        if (!win.isDestroyed() && win.isMinimized()) win.restore();
        win.show();
        win.focus();
        return;
      }
      hardRaise(win);
    },
    softFocus,
    ensureForeground(win) {
      if (platform !== "win32") return;
      if (win.isDestroyed()) return;
      if (win.isVisible() && !win.isMinimized() && win.isFocused?.()) return;
      if (win.isVisible() || win.isMinimized()) {
        softFocus(win);
        return;
      }
      hardRaise(win, { force: true });
    },
    attachTaskbarActivation(win) {
      if (platform !== "win32") return;
      if (typeof win.on !== "function") return;

      // Important: default false. show() without focus must not look "focused".
      let windowHadFocus = Boolean(win.isFocused?.());
      let lastBlurAt = 0;
      let repairingToggleBug = false;

      win.on("focus", () => {
        windowHadFocus = true;
        // Do NOT webContents.focus here — breaks titlebar drag on activation.
      });

      win.on("blur", () => {
        windowHadFocus = false;
        lastBlurAt = now();
      });

      // Taskbar restore: focus window only. No restore/show re-entry, no webContents thrash.
      win.on("restore", () => {
        if (win.isDestroyed()) return;
        focusWindowOnly(win);
      });

      win.on("minimize", () => {
        if (win.isDestroyed() || repairingToggleBug) return;

        const focusedNow = Boolean(win.isFocused?.());
        if (windowHadFocus || focusedNow) {
          return;
        }

        // blur→minimize within 200ms = intentional taskbar/titlebar minimize.
        if (lastBlurAt > 0 && now() - lastBlurAt < INTENTIONAL_MINIMIZE_AFTER_BLUR_MS) {
          return;
        }

        repairingToggleBug = true;
        schedule(() => {
          try {
            if (win.isDestroyed()) return;
            if (win.isMinimized()) {
              win.restore();
            }
            if (!win.isVisible()) {
              win.show();
            }
            focusWindowOnly(win);
          } finally {
            repairingToggleBug = false;
          }
        }, 0);
      });
    },
  };
}
