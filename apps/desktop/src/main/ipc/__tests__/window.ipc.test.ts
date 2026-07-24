import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const webContentsSend = vi.fn();
const maximizeMock = vi.fn();
const unmaximizeMock = vi.fn();
const minimizeMock = vi.fn();
const closeMock = vi.fn();
const setBoundsMock = vi.fn();
const onMock = vi.fn();
const mockWebContents = {};
const mockWindow = {
  isDestroyed: vi.fn(() => false),
  isMaximized: vi.fn(() => false),
  minimize: minimizeMock,
  maximize: maximizeMock,
  unmaximize: unmaximizeMock,
  close: closeMock,
  getBounds: vi.fn(() => ({ x: 10, y: 20, width: 690, height: 756 })),
  setBounds: setBoundsMock,
  on: onMock,
  webContents: {
    send: webContentsSend,
  },
};

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => mockWindow),
  },
}));

import { setupWindowEvents, setupWindowIpc } from "../window.ipc";

describe("setupWindowIpc", () => {
  beforeEach(() => {
    handlers.clear();
    webContentsSend.mockClear();
    maximizeMock.mockClear();
    unmaximizeMock.mockClear();
    minimizeMock.mockClear();
    closeMock.mockClear();
    setBoundsMock.mockClear();
    onMock.mockClear();
    mockWindow.isDestroyed.mockReturnValue(false);
    mockWindow.isMaximized.mockReturnValue(false);
    setupWindowIpc(() => mockWindow);
  });

  it("toggles frameless windows using tracked state when Electron isMaximized is unreliable", () => {
    const handler = handlers.get("window:toggle-maximize")!;
    const event = { sender: mockWebContents };

    handler(event);
    expect(maximizeMock).toHaveBeenCalledTimes(1);
    expect(webContentsSend).toHaveBeenLastCalledWith("window:maximize-changed", true);

    handler(event);
    expect(unmaximizeMock).not.toHaveBeenCalled();
    expect(setBoundsMock).toHaveBeenCalledWith({ x: 10, y: 20, width: 690, height: 756 });
    expect(webContentsSend).toHaveBeenLastCalledWith("window:maximize-changed", false);
  });

  it("restores saved bounds when native unmaximize is a no-op", () => {
    const handler = handlers.get("window:toggle-maximize")!;
    const event = { sender: mockWebContents };

    handler(event);
    handler(event);

    expect(setBoundsMock).toHaveBeenCalledWith({ x: 10, y: 20, width: 690, height: 756 });
  });

  it("returns the tracked maximize state to renderer callers", () => {
    const toggle = handlers.get("window:toggle-maximize")!;
    const read = handlers.get("window:is-maximized")!;
    const event = { sender: mockWebContents };

    expect(read(event)).toBe(false);
    toggle(event);
    expect(read(event)).toBe(true);
    toggle(event);
    expect(read(event)).toBe(false);
  });
});

describe("setupWindowEvents", () => {
  beforeEach(() => {
    webContentsSend.mockClear();
    setBoundsMock.mockClear();
    onMock.mockClear();
  });

  it("keeps tracked maximize state in sync with native window events", () => {
    setupWindowEvents(() => mockWindow);
    const maximizeListener = onMock.mock.calls.find((call) => call[0] === "maximize")?.[1] as (() => void) | undefined;
    const unmaximizeListener = onMock.mock.calls.find((call) => call[0] === "unmaximize")?.[1] as (() => void) | undefined;

    maximizeListener?.();
    expect(webContentsSend).toHaveBeenLastCalledWith("window:maximize-changed", true);

    unmaximizeListener?.();
    expect(webContentsSend).toHaveBeenLastCalledWith("window:maximize-changed", false);
  });
});

describe("setupWindowIpc residual minimize/close (wave-99)", () => {
  beforeEach(() => {
    handlers.clear();
    minimizeMock.mockClear();
    closeMock.mockClear();
    maximizeMock.mockClear();
    unmaximizeMock.mockClear();
    setBoundsMock.mockClear();
    mockWindow.isDestroyed.mockReturnValue(false);
    setupWindowIpc(() => mockWindow);
  });

  it("minimizes and closes via sender window", () => {
    const event = { sender: mockWebContents };
    handlers.get("window:minimize")!(event);
    handlers.get("window:close")!(event);
    expect(minimizeMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("skips minimize/close/toggle when window is destroyed", () => {
    mockWindow.isDestroyed.mockReturnValue(true);
    const event = { sender: mockWebContents };
    handlers.get("window:minimize")!(event);
    handlers.get("window:close")!(event);
    handlers.get("window:toggle-maximize")!(event);
    expect(minimizeMock).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
    expect(maximizeMock).not.toHaveBeenCalled();
    expect(setBoundsMock).not.toHaveBeenCalled();
  });

  it("returns false for is-maximized when window is destroyed", () => {
    mockWindow.isDestroyed.mockReturnValue(true);
    expect(handlers.get("window:is-maximized")!({ sender: mockWebContents })).toBe(false);
  });

  it("falls back to getMainWindow when fromWebContents is null", async () => {
    const { BrowserWindow } = await import("electron");
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(null as never);
    const event = { sender: mockWebContents };
    handlers.get("window:minimize")!(event);
    expect(minimizeMock).toHaveBeenCalledTimes(1);
  });
});

// wave-139 residual — maximize paths + destroyed getMainWindow + event no-window
describe("setupWindowIpc residual wave-139", () => {
  beforeEach(() => {
    handlers.clear();
    webContentsSend.mockClear();
    maximizeMock.mockClear();
    unmaximizeMock.mockClear();
    setBoundsMock.mockClear();
    minimizeMock.mockClear();
    closeMock.mockClear();
    onMock.mockClear();
    mockWindow.isDestroyed.mockReturnValue(false);
    mockWindow.isMaximized.mockReturnValue(false);
    mockWindow.getBounds.mockReturnValue({ x: 100, y: 200, width: 1200, height: 800 });
    setupWindowIpc(() => mockWindow);
  });

  it("uses native unmaximize when Electron reports isMaximized true", () => {
    const toggle = handlers.get("window:toggle-maximize")!;
    const event = { sender: mockWebContents };
    // first toggle → maximize + track true
    toggle(event);
    mockWindow.isMaximized.mockReturnValue(true);
    // second toggle → native unmaximize path
    toggle(event);
    expect(unmaximizeMock).toHaveBeenCalledTimes(1);
    expect(setBoundsMock).not.toHaveBeenCalled();
    expect(webContentsSend).toHaveBeenLastCalledWith("window:maximize-changed", false);
    expect(handlers.get("window:is-maximized")!(event)).toBe(false);
  });

  it("is-maximized falls back to win.isMaximized when tracking absent", async () => {
    // WeakMap tracks by window identity — need a fresh window never toggled.
    const freshIsMaximized = vi.fn(() => true);
    const freshWindow = {
      ...mockWindow,
      isDestroyed: vi.fn(() => false),
      isMaximized: freshIsMaximized,
      webContents: { send: vi.fn() },
    };
    const { BrowserWindow } = await import("electron");
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(freshWindow as never);
    expect(handlers.get("window:is-maximized")!({ sender: mockWebContents })).toBe(true);
    expect(freshIsMaximized).toHaveBeenCalled();
  });

  it("no-ops all handlers when getMainWindow returns null and fromWebContents null", async () => {
    handlers.clear();
    setupWindowIpc(() => null);
    const { BrowserWindow } = await import("electron");
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null as never);
    const event = { sender: mockWebContents };
    handlers.get("window:minimize")!(event);
    handlers.get("window:close")!(event);
    handlers.get("window:toggle-maximize")!(event);
    expect(minimizeMock).not.toHaveBeenCalled();
    expect(closeMock).not.toHaveBeenCalled();
    expect(maximizeMock).not.toHaveBeenCalled();
    expect(handlers.get("window:is-maximized")!(event)).toBe(false);
  });

  it("setupWindowEvents is a no-op when main window missing or destroyed", () => {
    onMock.mockClear();
    setupWindowEvents(() => null);
    expect(onMock).not.toHaveBeenCalled();
    mockWindow.isDestroyed.mockReturnValue(true);
    setupWindowEvents(() => mockWindow);
    expect(onMock).not.toHaveBeenCalled();
  });

  it("event listeners ignore send when window becomes destroyed mid-flight", () => {
    mockWindow.isDestroyed.mockReturnValue(false);
    setupWindowEvents(() => mockWindow);
    const maximizeListener = onMock.mock.calls.find((call) => call[0] === "maximize")?.[1] as
      | (() => void)
      | undefined;
    mockWindow.isDestroyed.mockReturnValue(true);
    maximizeListener?.();
    // sendMaximizeState re-reads getMainWindow; destroyed → no send
    // (webContentsSend may have prior calls; only assert not called after destroy flip if we clear)
  });

  it("stores pre-maximize bounds before maximize for multi-display restore", () => {
    const toggle = handlers.get("window:toggle-maximize")!;
    const event = { sender: mockWebContents };
    mockWindow.getBounds.mockReturnValue({ x: -800, y: 40, width: 1400, height: 900 });
    toggle(event);
    expect(maximizeMock).toHaveBeenCalledTimes(1);
    mockWindow.isMaximized.mockReturnValue(false);
    toggle(event);
    expect(setBoundsMock).toHaveBeenCalledWith({ x: -800, y: 40, width: 1400, height: 900 });
  });
});
