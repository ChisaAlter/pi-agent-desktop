import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock("electron", () => ({
  ipcMain: {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
}));

import { setupDesktopOverlayIpc } from "../desktop-overlay.ipc";

describe("setupDesktopOverlayIpc", () => {
  beforeEach(() => {
    handlers.clear();
  });

  it("forwards set-main-context and set-window-state to the manager", () => {
    const manager = {
      setMainContext: vi.fn(),
      updateWindowState: vi.fn(),
    };
    setupDesktopOverlayIpc(manager as never);

    expect(handlers.has("desktop-overlay:set-main-context")).toBe(true);
    expect(handlers.has("desktop-overlay:set-window-state")).toBe(true);

    const ctx = { workspaceId: "w1", sessionId: "s1" };
    handlers.get("desktop-overlay:set-main-context")!({}, ctx);
    expect(manager.setMainContext).toHaveBeenCalledWith(ctx);

    const state = { visible: true, progress: 0.5 };
    handlers.get("desktop-overlay:set-window-state")!({}, state);
    expect(manager.updateWindowState).toHaveBeenCalledWith(state);
  });

  // wave-99 residual
  it("forwards sequential main-context updates without coalescing", () => {
    const manager = {
      setMainContext: vi.fn(),
      updateWindowState: vi.fn(),
    };
    setupDesktopOverlayIpc(manager as never);
    const handler = handlers.get("desktop-overlay:set-main-context")!;
    handler({}, { chatSurfaceActive: true, workspaceId: "ws_a" });
    handler({}, { chatSurfaceActive: false, workspaceId: "ws_b", agentId: "agent_1" });
    expect(manager.setMainContext).toHaveBeenNthCalledWith(1, {
      chatSurfaceActive: true,
      workspaceId: "ws_a",
    });
    expect(manager.setMainContext).toHaveBeenNthCalledWith(2, {
      chatSurfaceActive: false,
      workspaceId: "ws_b",
      agentId: "agent_1",
    });
  });

  it("forwards hide and resize window-state payloads", () => {
    const manager = {
      setMainContext: vi.fn(),
      updateWindowState: vi.fn(),
    };
    setupDesktopOverlayIpc(manager as never);
    const handler = handlers.get("desktop-overlay:set-window-state")!;
    handler({}, { visible: false });
    handler({}, { visible: true, width: 400, height: 120 });
    expect(manager.updateWindowState).toHaveBeenNthCalledWith(1, { visible: false });
    expect(manager.updateWindowState).toHaveBeenNthCalledWith(2, {
      visible: true,
      width: 400,
      height: 120,
    });
  });

  // wave-104 residual
  it("forwards empty/partial context and state objects as given", () => {
    const manager = {
      setMainContext: vi.fn(),
      updateWindowState: vi.fn(),
    };
    setupDesktopOverlayIpc(manager as never);
    handlers.get("desktop-overlay:set-main-context")!({}, {});
    handlers.get("desktop-overlay:set-window-state")!({}, {});
    expect(manager.setMainContext).toHaveBeenCalledWith({});
    expect(manager.updateWindowState).toHaveBeenCalledWith({});
  });

  it("rebinds to the latest manager on subsequent setup", () => {
    const first = { setMainContext: vi.fn(), updateWindowState: vi.fn() };
    const second = { setMainContext: vi.fn(), updateWindowState: vi.fn() };
    setupDesktopOverlayIpc(first as never);
    setupDesktopOverlayIpc(second as never);
    handlers.get("desktop-overlay:set-main-context")!({}, { workspaceId: "ws" });
    expect(first.setMainContext).not.toHaveBeenCalled();
    expect(second.setMainContext).toHaveBeenCalledWith({ workspaceId: "ws" });
  });
});
