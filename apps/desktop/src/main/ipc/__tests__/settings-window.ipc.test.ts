import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  handlers,
  windowListeners,
  webContentsListeners,
  sendMock,
  webContents,
  mockWindow,
  BrowserWindowMock,
} = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const windowListeners = new Map<string, (...args: unknown[]) => void>();
  const webContentsListeners = new Map<string, (...args: unknown[]) => void>();
  const sendMock = vi.fn();
  const webContents = {
    setZoomFactor: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    getURL: vi.fn(() => "file:///C:/app/settings.html"),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      webContentsListeners.set(event, listener);
    }),
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      webContentsListeners.set(event, listener);
    }),
    send: sendMock,
  };
  const mockWindow = {
    webContents,
    isDestroyed: vi.fn(() => false),
    focus: vi.fn(),
    setBounds: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    loadFile: vi.fn(async () => undefined),
    loadURL: vi.fn(async () => undefined),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      windowListeners.set(event, listener);
    }),
  };
  const BrowserWindowMock = vi.fn(function BrowserWindowMock() {
    return mockWindow;
  });
  return {
    handlers,
    windowListeners,
    webContentsListeners,
    sendMock,
    webContents,
    mockWindow,
    BrowserWindowMock,
  };
});

vi.mock("electron", () => ({
  app: {
    on: vi.fn(),
  },
  BrowserWindow: BrowserWindowMock,
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  screen: {
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
}));

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: false },
}));

vi.mock("electron-log/main", () => ({
  default: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../services/web-security", () => ({
  attachWebSecurityHandlers: vi.fn(),
}));

import { setupSettingsWindowIpc } from "../settings-window.ipc";

describe("setupSettingsWindowIpc", () => {
  beforeEach(() => {
    handlers.clear();
    windowListeners.clear();
    webContentsListeners.clear();
    sendMock.mockReset();
    BrowserWindowMock.mockClear();
    mockWindow.show.mockClear();
    mockWindow.hide.mockClear();
    mockWindow.close.mockClear();
    mockWindow.focus.mockClear();
    setupSettingsWindowIpc();
  });

  afterEach(() => {
    windowListeners.get("closed")?.();
  });

  it("buffers the initial tab until the settings renderer reports ready", async () => {
    const openWindow = handlers.get("settings:open-window");
    expect(openWindow).toBeTruthy();
    await openWindow?.({}, "model");

    expect(sendMock).not.toHaveBeenCalled();
    const rendererReady = handlers.get("settings:renderer-ready");
    expect(rendererReady).toBeTruthy();
    expect(rendererReady?.({ sender: webContents })).toBe("model");
  });

  it("uses an opaque settings window to avoid the Windows transparent renderer penalty", async () => {
    const openWindow = handlers.get("settings:open-window");
    await openWindow?.({}, "general");

    expect(BrowserWindowMock).toHaveBeenCalledWith(expect.objectContaining({
      transparent: false,
    }));
  });

  it("hides and reuses the settings window instead of destroying it", async () => {
    const openWindow = handlers.get("settings:open-window");
    const closeWindow = handlers.get("settings:close-window");

    await openWindow?.({}, "general");
    await closeWindow?.({});
    await openWindow?.({}, "usage");

    expect(BrowserWindowMock).toHaveBeenCalledTimes(1);
    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
    expect(mockWindow.close).not.toHaveBeenCalled();
    expect(mockWindow.show).toHaveBeenCalledTimes(1);
    expect(mockWindow.focus).toHaveBeenCalledTimes(1);
  });

  it("turns a native close request into a hide while the app is running", async () => {
    const openWindow = handlers.get("settings:open-window");
    await openWindow?.({}, "general");
    const event = { preventDefault: vi.fn() };

    windowListeners.get("close")?.(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockWindow.hide).toHaveBeenCalledTimes(1);
  });
});
