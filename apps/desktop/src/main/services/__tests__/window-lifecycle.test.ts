import { describe, expect, it, vi } from "vitest";
import { createMainWindowLifecycleController } from "../window-lifecycle";

type CloseListener = (event: { preventDefault: () => void }) => void;
type VoidListener = () => void;

function createFakeWindow() {
  const listeners = new Map<string, Array<CloseListener | VoidListener>>();
  let visible = true;
  let minimized = false;
  return {
    on: vi.fn((event: string, listener: CloseListener | VoidListener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    emitClose(event: { preventDefault: () => void }) {
      for (const listener of listeners.get("close") ?? []) {
        (listener as CloseListener)(event);
      }
    },
    emit(event: "show" | "hide") {
      for (const listener of listeners.get(event) ?? []) {
        (listener as VoidListener)();
      }
    },
    hide: vi.fn(() => {
      visible = false;
    }),
    show: vi.fn(() => {
      visible = true;
    }),
    focus: vi.fn(),
    restore: vi.fn(() => {
      minimized = false;
    }),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => visible),
    isMinimized: vi.fn(() => minimized),
    __setMinimized(next: boolean) {
      minimized = next;
    },
  };
}

function createFakeTray() {
  const listeners = new Map<string, Array<VoidListener>>();
  return {
    on: vi.fn((event: string, listener: VoidListener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
    destroy: vi.fn(),
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
  };
}

describe("createMainWindowLifecycleController", () => {
  it("intercepts the main window close button and hides to tray instead", () => {
    const mainWindow = createFakeWindow();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });

    controller.attachMainWindow(mainWindow);
    const preventDefault = vi.fn();
    mainWindow.emitClose({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(mainWindow.hide).toHaveBeenCalled();
    expect(overlay.refreshVisibility).toHaveBeenCalled();
  });

  it("restores and focuses the main window when the tray icon is clicked", () => {
    const mainWindow = createFakeWindow();
    mainWindow.__setMinimized(true);
    const tray = createFakeTray();
    const beforeShowMainWindow = vi.fn();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay: { refreshVisibility: vi.fn(), destroy: vi.fn() },
      createTray: vi.fn(() => tray),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
      beforeShowMainWindow,
    });

    controller.attachMainWindow(mainWindow);
    controller.ensureTray("C:/icon.ico");
    tray.emit("click");

    expect(beforeShowMainWindow).toHaveBeenCalled();
    expect(mainWindow.restore).toHaveBeenCalled();
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
  });

  it("allows explicit quit to destroy tray resources and stop intercepting close", () => {
    const mainWindow = createFakeWindow();
    const tray = createFakeTray();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const onQuitRequested = vi.fn();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => tray),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested,
    });

    controller.attachMainWindow(mainWindow);
    controller.ensureTray("C:/icon.ico");
    controller.requestQuit();

    const preventDefault = vi.fn();
    mainWindow.emitClose({ preventDefault });

    expect(onQuitRequested).toHaveBeenCalled();
    expect(tray.destroy).toHaveBeenCalled();
    expect(overlay.destroy).toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  // wave-97 residual: tray idempotency, restore edges, quit flags, overlay sync, menu actions
  it("ensureTray is idempotent and reports hasTray", () => {
    const mainWindow = createFakeWindow();
    const tray = createFakeTray();
    const createTray = vi.fn(() => tray);
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      createTray,
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });

    expect(controller.hasTray()).toBe(false);
    const first = controller.ensureTray("C:/icon.ico");
    const second = controller.ensureTray("C:/other.ico");
    expect(first).toBe(tray);
    expect(second).toBe(tray);
    expect(createTray).toHaveBeenCalledTimes(1);
    expect(controller.hasTray()).toBe(true);
    expect(tray.setToolTip).toHaveBeenCalledWith("Pi Desktop");
  });

  it("restoreMainWindow is a no-op when window is null or destroyed", () => {
    const destroyed = createFakeWindow();
    destroyed.isDestroyed = vi.fn(() => true);
    const beforeShowMainWindow = vi.fn();
    let current: ReturnType<typeof createFakeWindow> | null = null;
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => current,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
      beforeShowMainWindow,
    });

    controller.restoreMainWindow();
    expect(beforeShowMainWindow).not.toHaveBeenCalled();

    current = destroyed;
    controller.restoreMainWindow();
    expect(beforeShowMainWindow).not.toHaveBeenCalled();
    expect(destroyed.show).not.toHaveBeenCalled();
  });

  it("beginQuit / requestQuit are idempotent and flip isQuitting", () => {
    const mainWindow = createFakeWindow();
    const tray = createFakeTray();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const onQuitRequested = vi.fn();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => tray),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested,
    });

    controller.ensureTray("C:/icon.ico");
    expect(controller.isQuitting()).toBe(false);
    controller.beginQuit();
    controller.beginQuit();
    expect(controller.isQuitting()).toBe(true);
    expect(tray.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.destroy).toHaveBeenCalledTimes(1);

    controller.requestQuit();
    expect(onQuitRequested).not.toHaveBeenCalled();
  });

  it("show/hide events refresh overlay visibility", () => {
    const mainWindow = createFakeWindow();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });

    controller.attachMainWindow(mainWindow);
    mainWindow.emit("show");
    mainWindow.emit("hide");
    expect(overlay.refreshVisibility).toHaveBeenCalledTimes(2);
  });

  it("tray context menu show restores window and quit requests exit", () => {
    const mainWindow = createFakeWindow();
    mainWindow.__setMinimized(true);
    const tray = createFakeTray();
    const onQuitRequested = vi.fn();
    let menuActions: { show: () => void; quit: () => void } | null = null;
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      createTray: vi.fn(() => tray),
      buildTrayMenu: vi.fn((actions) => {
        menuActions = actions;
        return { items: [] };
      }),
      onQuitRequested,
    });

    controller.ensureTray("C:/icon.ico");
    expect(menuActions).not.toBeNull();
    menuActions!.show();
    expect(mainWindow.restore).toHaveBeenCalled();
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();

    menuActions!.quit();
    expect(onQuitRequested).toHaveBeenCalledTimes(1);
    expect(controller.isQuitting()).toBe(true);
    expect(controller.hasTray()).toBe(false);
  });

  // wave-134 residual
  it("close while quitting does not preventDefault or hide again", () => {
    const mainWindow = createFakeWindow();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    controller.attachMainWindow(mainWindow);
    controller.beginQuit();
    overlay.refreshVisibility.mockClear();
    mainWindow.hide.mockClear();
    const preventDefault = vi.fn();
    mainWindow.emitClose({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mainWindow.hide).not.toHaveBeenCalled();
    expect(overlay.refreshVisibility).not.toHaveBeenCalled();
  });

  it("restoreMainWindow skips restore when not minimized and still shows/focuses", () => {
    const mainWindow = createFakeWindow();
    mainWindow.__setMinimized(false);
    const beforeShowMainWindow = vi.fn();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
      beforeShowMainWindow,
    });
    controller.restoreMainWindow();
    expect(beforeShowMainWindow).toHaveBeenCalledTimes(1);
    expect(mainWindow.restore).not.toHaveBeenCalled();
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    expect(overlay.refreshVisibility).toHaveBeenCalledTimes(1);
  });

  it("works without overlay dependency", () => {
    const mainWindow = createFakeWindow();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    controller.attachMainWindow(mainWindow);
    expect(() => mainWindow.emitClose({ preventDefault: vi.fn() })).not.toThrow();
    expect(() => controller.beginQuit()).not.toThrow();
    expect(controller.isQuitting()).toBe(true);
  });

  // wave-174 residual
  it("beginQuit without a tray still destroys overlay and marks quitting", () => {
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const onQuitRequested = vi.fn();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => createFakeWindow(),
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested,
    });
    expect(controller.hasTray()).toBe(false);
    controller.beginQuit();
    expect(overlay.destroy).toHaveBeenCalledTimes(1);
    expect(controller.isQuitting()).toBe(true);
    expect(controller.hasTray()).toBe(false);
    // requestQuit after beginQuit must not re-enter onQuitRequested
    controller.requestQuit();
    expect(onQuitRequested).not.toHaveBeenCalled();
  });

  it("ensureTray after beginQuit recreates a tray because ensureTray ignores quitting", () => {
    const first = createFakeTray();
    const second = createFakeTray();
    const createTray = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => createFakeWindow(),
      createTray,
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    controller.ensureTray("C:/icon-a.ico");
    controller.beginQuit();
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(controller.hasTray()).toBe(false);

    const recreated = controller.ensureTray("C:/icon-b.ico");
    expect(recreated).toBe(second);
    expect(createTray).toHaveBeenCalledTimes(2);
    expect(createTray).toHaveBeenLastCalledWith("C:/icon-b.ico");
    expect(second.setToolTip).toHaveBeenCalledWith("Pi Desktop");
    expect(controller.hasTray()).toBe(true);
    expect(controller.isQuitting()).toBe(true);
  });

  it("close while already hidden still preventDefault/hide and refreshes overlay", () => {
    const mainWindow = createFakeWindow();
    mainWindow.hide();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    controller.attachMainWindow(mainWindow);
    const preventDefault = vi.fn();
    mainWindow.emitClose({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mainWindow.hide).toHaveBeenCalledTimes(2); // initial + close path
    expect(overlay.refreshVisibility).toHaveBeenCalledTimes(1);
  });

  // wave-183 residual
  it("requestQuit begins quit then invokes onQuitRequested exactly once", () => {
    const tray = createFakeTray();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const onQuitRequested = vi.fn();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => createFakeWindow(),
      overlay,
      createTray: vi.fn(() => tray),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested,
    });
    controller.ensureTray("C:/icon.ico");
    controller.requestQuit();
    expect(controller.isQuitting()).toBe(true);
    expect(tray.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.destroy).toHaveBeenCalledTimes(1);
    expect(onQuitRequested).toHaveBeenCalledTimes(1);
    controller.requestQuit();
    expect(onQuitRequested).toHaveBeenCalledTimes(1);
    expect(tray.destroy).toHaveBeenCalledTimes(1);
  });

  it("restoreMainWindow is a no-op for null or destroyed window", () => {
    const destroyed = createFakeWindow();
    destroyed.isDestroyed = vi.fn(() => true);
    const beforeShowMainWindow = vi.fn();
    let current: ReturnType<typeof createFakeWindow> | null = null;
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => current,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
      beforeShowMainWindow,
    });
    controller.restoreMainWindow();
    expect(beforeShowMainWindow).not.toHaveBeenCalled();
    current = destroyed;
    controller.restoreMainWindow();
    expect(beforeShowMainWindow).not.toHaveBeenCalled();
    expect(destroyed.show).not.toHaveBeenCalled();
  });

  it("double attachMainWindow stacks close listeners (both fire until quit)", () => {
    const mainWindow = createFakeWindow();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    controller.attachMainWindow(mainWindow);
    controller.attachMainWindow(mainWindow);
    const preventDefault = vi.fn();
    mainWindow.emitClose({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(2);
    expect(mainWindow.hide).toHaveBeenCalledTimes(2);
    expect(overlay.refreshVisibility).toHaveBeenCalledTimes(2);
  });

  // wave-199 residual
  it("restoreMainWindow restores when minimized then shows/focuses and refreshes overlay", () => {
    const mainWindow = createFakeWindow();
    mainWindow.__setMinimized(true);
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const beforeShowMainWindow = vi.fn();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
      beforeShowMainWindow,
    });
    controller.restoreMainWindow();
    expect(beforeShowMainWindow).toHaveBeenCalledTimes(1);
    expect(mainWindow.restore).toHaveBeenCalledTimes(1);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    expect(overlay.refreshVisibility).toHaveBeenCalledTimes(1);
  });

  it("ensureTray reuses existing tray and wires click to restore", () => {
    const tray = createFakeTray();
    const createTray = vi.fn(() => tray);
    const mainWindow = createFakeWindow();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      createTray,
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    const first = controller.ensureTray("C:/icon.ico");
    const second = controller.ensureTray("C:/other.ico");
    expect(first).toBe(tray);
    expect(second).toBe(tray);
    expect(createTray).toHaveBeenCalledTimes(1);
    expect(tray.setToolTip).toHaveBeenCalledWith("Pi Desktop");
    tray.emit("click");
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
  });

  it("beginQuit nulls tray so hasTray is false after destroy", () => {
    const tray = createFakeTray();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => createFakeWindow(),
      createTray: vi.fn(() => tray),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    controller.ensureTray("C:/icon.ico");
    expect(controller.hasTray()).toBe(true);
    controller.beginQuit();
    expect(tray.destroy).toHaveBeenCalledTimes(1);
    expect(controller.hasTray()).toBe(false);
    expect(controller.isQuitting()).toBe(true);
  });

  // wave-207 residual
  it("restoreMainWindow without beforeShow still shows/focuses/refreshes overlay", () => {
    const mainWindow = createFakeWindow();
    mainWindow.__setMinimized(true);
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    controller.restoreMainWindow();
    expect(mainWindow.restore).toHaveBeenCalledTimes(1);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    expect(overlay.refreshVisibility).toHaveBeenCalledTimes(1);
  });

  it("close after requestQuit does not preventDefault; tray destroy is single-shot", () => {
    const mainWindow = createFakeWindow();
    const tray = createFakeTray();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const onQuitRequested = vi.fn();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => tray),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested,
    });
    controller.attachMainWindow(mainWindow);
    controller.ensureTray("C:/icon.ico");
    controller.requestQuit();
    expect(onQuitRequested).toHaveBeenCalledTimes(1);
    expect(tray.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.destroy).toHaveBeenCalledTimes(1);
    const preventDefault = vi.fn();
    mainWindow.emitClose({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mainWindow.hide).not.toHaveBeenCalled();
    // second requestQuit is no-op
    controller.requestQuit();
    expect(onQuitRequested).toHaveBeenCalledTimes(1);
    expect(tray.destroy).toHaveBeenCalledTimes(1);
  });

  it("hasTray is false until ensureTray; isQuitting false until begin/request", () => {
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => createFakeWindow(),
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    expect(controller.hasTray()).toBe(false);
    expect(controller.isQuitting()).toBe(false);
    controller.ensureTray("C:/icon.ico");
    expect(controller.hasTray()).toBe(true);
    expect(controller.isQuitting()).toBe(false);
  });

  // wave-222 residual
  it("restoreMainWindow restores minimized windows and calls beforeShowMainWindow", () => {
    const mainWindow = createFakeWindow();
    mainWindow.__setMinimized(true);
    const beforeShowMainWindow = vi.fn();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
      beforeShowMainWindow,
    });
    controller.restoreMainWindow();
    expect(beforeShowMainWindow).toHaveBeenCalledTimes(1);
    expect(mainWindow.restore).toHaveBeenCalledTimes(1);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    expect(overlay.refreshVisibility).toHaveBeenCalledTimes(1);
  });

  it("restoreMainWindow no-ops when window missing or destroyed; beginQuit is idempotent", () => {
    const destroyed = createFakeWindow();
    destroyed.isDestroyed = vi.fn(() => true);
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    let current: ReturnType<typeof createFakeWindow> | null = destroyed;
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => current,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    controller.restoreMainWindow();
    expect(destroyed.show).not.toHaveBeenCalled();
    current = null;
    controller.restoreMainWindow();
    controller.beginQuit();
    controller.beginQuit();
    expect(overlay.destroy).toHaveBeenCalledTimes(1);
    expect(controller.isQuitting()).toBe(true);
  });

  it("ensureTray is singleton and tray click restores main window", () => {
    const mainWindow = createFakeWindow();
    const tray = createFakeTray();
    const createTray = vi.fn(() => tray);
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      createTray,
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested: vi.fn(),
    });
    const t1 = controller.ensureTray("C:/icon.ico");
    const t2 = controller.ensureTray("C:/other.ico");
    expect(t1).toBe(t2);
    expect(createTray).toHaveBeenCalledTimes(1);
    expect(tray.setToolTip).toHaveBeenCalledWith("Pi Desktop");
    tray.emit("click");
    expect(mainWindow.show).toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalled();
  });

  // wave-249 residual
  it("close while quitting does not preventDefault or hide; show/hide refresh overlay", () => {
    const mainWindow = createFakeWindow();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const onQuitRequested = vi.fn();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({ items: [] })),
      onQuitRequested,
    });
    controller.attachMainWindow(mainWindow);
    controller.beginQuit();
    const preventDefault = vi.fn();
    mainWindow.emitClose({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mainWindow.hide).not.toHaveBeenCalled();
    mainWindow.emit("show");
    mainWindow.emit("hide");
    expect(overlay.refreshVisibility).toHaveBeenCalledTimes(2);
    expect(onQuitRequested).not.toHaveBeenCalled();
  });

  it("requestQuit begins once, destroys tray, invokes onQuitRequested; second call no-ops", () => {
    const mainWindow = createFakeWindow();
    const tray = createFakeTray();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const onQuitRequested = vi.fn();
    const buildTrayMenu = vi.fn(() => ({ items: ["quit"] }));
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => mainWindow,
      overlay,
      createTray: vi.fn(() => tray),
      buildTrayMenu,
      onQuitRequested,
    });
    controller.ensureTray("C:/icon.ico");
    expect(buildTrayMenu).toHaveBeenCalledWith(
      expect.objectContaining({ show: expect.any(Function), quit: expect.any(Function) }),
    );
    controller.requestQuit();
    controller.requestQuit();
    expect(onQuitRequested).toHaveBeenCalledTimes(1);
    expect(tray.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.destroy).toHaveBeenCalledTimes(1);
    expect(controller.isQuitting()).toBe(true);
    expect(controller.hasTray()).toBe(false);
  });

  // wave-262 residual
  it("restoreMainWindow no-ops when window missing or destroyed", () => {
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => null,
      overlay,
      createTray: vi.fn(),
      buildTrayMenu: vi.fn(),
      onQuitRequested: vi.fn(),
    });
    controller.restoreMainWindow();
    expect(overlay.refreshVisibility).not.toHaveBeenCalled();

    const destroyed = createFakeWindow();
    destroyed.isDestroyed.mockReturnValue(true);
    const c2 = createMainWindowLifecycleController({
      getMainWindow: () => destroyed,
      overlay,
      createTray: vi.fn(),
      buildTrayMenu: vi.fn(),
      onQuitRequested: vi.fn(),
    });
    c2.restoreMainWindow();
    expect(destroyed.show).not.toHaveBeenCalled();
  });

  it("beginQuit is idempotent; second call does not re-destroy tray", () => {
    const tray = createFakeTray();
    const overlay = { refreshVisibility: vi.fn(), destroy: vi.fn() };
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => createFakeWindow(),
      overlay,
      createTray: vi.fn(() => tray),
      buildTrayMenu: vi.fn(() => ({})),
      onQuitRequested: vi.fn(),
    });
    controller.ensureTray("icon");
    controller.beginQuit();
    controller.beginQuit();
    expect(tray.destroy).toHaveBeenCalledTimes(1);
    expect(overlay.destroy).toHaveBeenCalledTimes(1);
    expect(controller.isQuitting()).toBe(true);
    expect(controller.hasTray()).toBe(false);
  });



  // wave-290 residual
  it("ensureTray sets tooltip/menu/click once; second ensure returns same tray", () => {
    const tray = createFakeTray();
    const createTray = vi.fn(() => tray);
    const buildTrayMenu = vi.fn(() => ({ items: 1 }));
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => createFakeWindow(),
      createTray,
      buildTrayMenu,
      onQuitRequested: vi.fn(),
    });
    const first = controller.ensureTray("icon-a");
    const second = controller.ensureTray("icon-b");
    expect(first).toBe(second);
    expect(createTray).toHaveBeenCalledTimes(1);
    expect(createTray).toHaveBeenCalledWith("icon-a");
    expect(tray.setToolTip).toHaveBeenCalledWith("Pi Desktop");
    expect(buildTrayMenu).toHaveBeenCalledTimes(1);
    expect(tray.setContextMenu).toHaveBeenCalledWith({ items: 1 });
    expect(tray.on).toHaveBeenCalledWith("click", expect.any(Function));
    expect(controller.hasTray()).toBe(true);
  });

  it("close while not quitting preventDefault+hide; requestQuit then close allows exit", () => {
    const win = createFakeWindow();
    const onQuitRequested = vi.fn();
    const controller = createMainWindowLifecycleController({
      getMainWindow: () => win,
      createTray: vi.fn(() => createFakeTray()),
      buildTrayMenu: vi.fn(() => ({})),
      onQuitRequested,
    });
    controller.attachMainWindow(win);
    const preventDefault = vi.fn();
    win.emitClose({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(win.hide).toHaveBeenCalled();

    controller.requestQuit();
    expect(onQuitRequested).toHaveBeenCalledTimes(1);
    expect(controller.isQuitting()).toBe(true);
    win.hide.mockClear();
    const prevent2 = vi.fn();
    win.emitClose({ preventDefault: prevent2 });
    expect(prevent2).not.toHaveBeenCalled();
    expect(win.hide).not.toHaveBeenCalled();
  });

});
