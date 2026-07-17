import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();
const webContentsSend = vi.fn();
const maximizeMock = vi.fn();
const unmaximizeMock = vi.fn();
const minimizeMock = vi.fn();
const closeMock = vi.fn();
const setBoundsMock = vi.fn();
const setPositionMock = vi.fn();
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
  setPosition: setPositionMock,
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
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      listeners.set(channel, handler);
    }),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(() => mockWindow),
  },
}));

import { setupWindowEvents, setupWindowIpc } from "../window.ipc";

describe("setupWindowIpc", () => {
  beforeEach(() => {
    handlers.clear();
    listeners.clear();
    webContentsSend.mockClear();
    maximizeMock.mockClear();
    unmaximizeMock.mockClear();
    minimizeMock.mockClear();
    closeMock.mockClear();
    setBoundsMock.mockClear();
    setPositionMock.mockClear();
    onMock.mockClear();
    mockWindow.isDestroyed.mockReturnValue(false);
    mockWindow.isMaximized.mockReturnValue(false);
    setupWindowIpc(() => mockWindow);
  });

  it("toggles frameless transparent windows using tracked state when Electron isMaximized is unreliable", () => {
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

  it("moves the current frameless window while the explicit titlebar drag is active", () => {
    const event = { sender: mockWebContents };

    listeners.get("window:drag-start")?.(event, 100, 200);
    listeners.get("window:drag-move")?.(event, 142, 263);

    expect(setPositionMock).toHaveBeenLastCalledWith(52, 83);

    listeners.get("window:drag-end")?.(event);
    setPositionMock.mockClear();
    listeners.get("window:drag-move")?.(event, 170, 290);
    expect(setPositionMock).not.toHaveBeenCalled();
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
