import { describe, expect, it, vi } from "vitest";
import { createWindowsFirstClickController, type FocusCapableWindow } from "../windows-first-click";

type FakeWindow = FocusCapableWindow & {
  emit(event: string): void;
  __setFocused(next: boolean): void;
  __setMinimized(next: boolean): void;
};

function createFakeWindow(overrides: Partial<FocusCapableWindow> = {}): FakeWindow {
  let visible = true;
  let focused = false;
  let minimized = false;
  const listeners = new Map<string, Array<() => void>>();
  const win = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => minimized),
    isVisible: vi.fn(() => visible),
    isFocused: vi.fn(() => focused),
    restore: vi.fn(() => {
      minimized = false;
      visible = true;
    }),
    show: vi.fn(() => {
      visible = true;
    }),
    focus: vi.fn(() => {
      focused = true;
    }),
    moveTop: vi.fn(),
    setSkipTaskbar: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    webContents: {
      focus: vi.fn(),
      isDestroyed: () => false,
    },
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
    __setFocused(next: boolean) {
      focused = next;
    },
    __setMinimized(next: boolean) {
      minimized = next;
      if (next) visible = false;
    },
    ...overrides,
  } as FakeWindow;
  return win;
}

describe("createWindowsFirstClickController", () => {
  it("hard raise is synchronous and only defers always-on-top release without re-focus", () => {
    const scheduled: Array<{ callback: () => void; delayMs?: number }> = [];
    const win = createFakeWindow();
    win.__setMinimized(true);
    const focusApp = { focus: vi.fn() };

    const controller = createWindowsFirstClickController({
      platform: "win32",
      focusAppObject: focusApp,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
      },
    });

    controller.raise(win);
    expect(win.restore).toHaveBeenCalledTimes(1);
    expect(win.setSkipTaskbar).toHaveBeenCalledWith(false);
    expect(win.show).toHaveBeenCalled();
    expect(win.moveTop).toHaveBeenCalled();
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(win.focus).toHaveBeenCalled();
    expect(focusApp.focus).toHaveBeenCalledWith({ steal: true });
    // webContents.focus must NOT run — it aborts native titlebar drag.
    expect(win.webContents?.focus).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(80);

    win.focus.mockClear();
    scheduled[0]?.callback();
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(false);
    // No second focus pulse after AOT release.
    expect(win.focus).not.toHaveBeenCalled();
  });

  it("softFocus never uses always-on-top or webContents.focus", () => {
    const win = createFakeWindow();
    win.__setMinimized(true);
    const controller = createWindowsFirstClickController({
      platform: "win32",
      schedule: () => undefined,
    });
    controller.softFocus(win);
    expect(win.restore).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.webContents?.focus).not.toHaveBeenCalled();
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(win.moveTop).not.toHaveBeenCalled();
  });

  it("restore handler only focuses and does not re-enter restore/show/webContents", () => {
    const win = createFakeWindow();
    const controller = createWindowsFirstClickController({
      platform: "win32",
      schedule: () => undefined,
    });
    controller.attachTaskbarActivation(win);
    win.restore.mockClear();
    win.show.mockClear();
    win.emit("restore");
    expect(win.focus).toHaveBeenCalled();
    expect(win.webContents?.focus).not.toHaveBeenCalled();
    expect(win.restore).not.toHaveBeenCalled();
    expect(win.show).not.toHaveBeenCalled();
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
  });

  it("repairs unfocused minimize only after a long unfocused period", () => {
    let clock = 1_000;
    const scheduled: Array<{ callback: () => void; delayMs?: number }> = [];
    const win = createFakeWindow();
    const controller = createWindowsFirstClickController({
      platform: "win32",
      now: () => clock,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
      },
    });
    controller.attachTaskbarActivation(win);

    win.__setFocused(false);
    win.emit("blur");
    clock += 1_000;
    win.__setMinimized(true);
    win.emit("minimize");

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delayMs).toBe(0);
    scheduled[0]?.callback();
    expect(win.restore).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it("does not repair intentional focused minimize", () => {
    const scheduled: Array<{ callback: () => void; delayMs?: number }> = [];
    const win = createFakeWindow();
    const controller = createWindowsFirstClickController({
      platform: "win32",
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
      },
    });
    controller.attachTaskbarActivation(win);

    win.__setFocused(true);
    win.emit("focus");
    win.__setMinimized(true);
    win.emit("minimize");

    expect(scheduled).toHaveLength(0);
    expect(win.restore).not.toHaveBeenCalled();
  });

  it("does not repair intentional taskbar minimize that blurs first", () => {
    let clock = 5_000;
    const scheduled: Array<{ callback: () => void; delayMs?: number }> = [];
    const win = createFakeWindow();
    const controller = createWindowsFirstClickController({
      platform: "win32",
      now: () => clock,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
      },
    });
    controller.attachTaskbarActivation(win);

    win.__setFocused(true);
    win.emit("focus");
    win.__setFocused(false);
    win.emit("blur");
    clock += 30;
    win.__setMinimized(true);
    win.emit("minimize");

    expect(scheduled).toHaveLength(0);
    expect(win.restore).not.toHaveBeenCalled();
  });

  it("ensureForeground uses soft path when visible or minimized", () => {
    const visible = createFakeWindow();
    visible.__setFocused(false);
    const minimized = createFakeWindow();
    minimized.__setMinimized(true);
    minimized.__setFocused(false);
    const controller = createWindowsFirstClickController({
      platform: "win32",
      schedule: () => undefined,
    });
    controller.ensureForeground(visible);
    expect(visible.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(visible.focus).toHaveBeenCalled();
    expect(visible.webContents?.focus).not.toHaveBeenCalled();

    controller.ensureForeground(minimized);
    expect(minimized.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(minimized.restore).toHaveBeenCalled();
  });

  it("ensureForeground uses hard raise only when hidden (tray path)", () => {
    const hidden = createFakeWindow();
    Object.defineProperty(hidden, "isVisible", { value: vi.fn(() => false) });
    Object.defineProperty(hidden, "isMinimized", { value: vi.fn(() => false) });
    Object.defineProperty(hidden, "isFocused", { value: vi.fn(() => false) });
    const controller = createWindowsFirstClickController({
      platform: "win32",
      schedule: () => undefined,
    });
    controller.ensureForeground(hidden);
    expect(hidden.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(hidden.show).toHaveBeenCalled();
    expect(hidden.webContents?.focus).not.toHaveBeenCalled();
  });

  it("debounces rapid hard raises from click + double-click", () => {
    const win = createFakeWindow();
    const controller = createWindowsFirstClickController({
      platform: "win32",
      schedule: () => undefined,
      debounceMs: 350,
    });
    controller.raise(win);
    controller.raise(win);
    controller.raise(win);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when window is destroyed", () => {
    const win = createFakeWindow({ isDestroyed: vi.fn(() => true) });
    const controller = createWindowsFirstClickController({
      platform: "win32",
      schedule: (callback) => callback(),
    });
    controller.raise(win);
    controller.softFocus(win);
    expect(win.show).not.toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
  });

  it("initial windowHadFocus is false when never focused so toggle repair can run", () => {
    let clock = 0;
    const scheduled: Array<{ callback: () => void; delayMs?: number }> = [];
    const win = createFakeWindow();
    win.__setFocused(false);
    const controller = createWindowsFirstClickController({
      platform: "win32",
      now: () => clock,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
      },
    });
    // No focus/blur events yet — show() without focus.
    controller.attachTaskbarActivation(win);
    clock += 1_000;
    win.__setMinimized(true);
    win.emit("minimize");
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.callback();
    expect(win.restore).toHaveBeenCalled();
  });
});
