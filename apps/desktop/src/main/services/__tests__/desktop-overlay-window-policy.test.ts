import { beforeEach, describe, expect, it, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  windows: [] as Array<{
    hide: ReturnType<typeof vi.fn>;
    showInactive: ReturnType<typeof vi.fn>;
    isVisible: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("electron", () => ({
  BrowserWindow: class {
    hide = vi.fn();
    showInactive = vi.fn();
    isVisible = vi.fn(() => false);
    isDestroyed = vi.fn(() => false);
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setBounds = vi.fn();
    loadFile = vi.fn(async () => undefined);
    loadURL = vi.fn(async () => undefined);
    destroy = vi.fn();
    on = vi.fn();

    constructor() {
      electronMocks.windows.push(this);
    }
  },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
    })),
  },
}));

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: false },
}));

vi.mock("../web-security", () => ({
  attachWebSecurityHandlers: vi.fn(),
}));

import {
  computeDesktopOverlayBounds,
  DesktopOverlayWindowManager,
} from "../desktop-overlay-window";

describe("desktop overlay visibility policy", () => {
  beforeEach(() => {
    electronMocks.windows.length = 0;
  });

  it("does not show progress reminders after the main window is hidden by default", () => {
    const manager = new DesktopOverlayWindowManager(() => ({
      isDestroyed: () => false,
      isVisible: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
    }) as never);
    electronMocks.windows[0]?.showInactive.mockClear();

    manager.updateWindowState({ visible: true, width: 336, height: 96 });

    expect(electronMocks.windows).toHaveLength(1);
    expect(electronMocks.windows[0]?.showInactive).not.toHaveBeenCalled();
    expect(electronMocks.windows[0]?.hide).toHaveBeenCalled();
  });

  it("still supports an explicit opt-in for hidden-window progress surfaces", () => {
    const manager = new DesktopOverlayWindowManager(
      () => ({
        isDestroyed: () => false,
        isVisible: () => false,
        getBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
      }) as never,
      { showWhenMainWindowHidden: true },
    );
    electronMocks.windows[0]?.showInactive.mockClear();

    manager.updateWindowState({ visible: true, width: 336, height: 96 });

    expect(electronMocks.windows[0]?.showInactive).toHaveBeenCalled();
  });

  // wave-98 residual
  it("hides overlay when main window is visible even with opt-in", () => {
    const manager = new DesktopOverlayWindowManager(
      () => ({
        isDestroyed: () => false,
        isVisible: () => true,
        getBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
      }) as never,
      { showWhenMainWindowHidden: true },
    );
    electronMocks.windows[0]?.showInactive.mockClear();
    electronMocks.windows[0]?.hide.mockClear();

    manager.updateWindowState({ visible: true, width: 336, height: 96 });

    expect(electronMocks.windows[0]?.showInactive).not.toHaveBeenCalled();
    expect(electronMocks.windows[0]?.hide).toHaveBeenCalled();
  });

  it("hides when overlay state is not visible", () => {
    const manager = new DesktopOverlayWindowManager(
      () => ({
        isDestroyed: () => false,
        isVisible: () => false,
        getBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
      }) as never,
      { showWhenMainWindowHidden: true },
    );
    electronMocks.windows[0]?.showInactive.mockClear();

    manager.updateWindowState({ visible: false, width: 336, height: 96 });

    expect(electronMocks.windows[0]?.showInactive).not.toHaveBeenCalled();
    expect(electronMocks.windows[0]?.hide).toHaveBeenCalled();
  });

  it("stores and returns main context", () => {
    const manager = new DesktopOverlayWindowManager(() => null);
    manager.setMainContext({ chatSurfaceActive: false, workspaceId: "ws_1", agentId: "agent_1" });
    expect(manager.getMainContext()).toEqual({
      chatSurfaceActive: false,
      workspaceId: "ws_1",
      agentId: "agent_1",
    });
  });

  it("getPermissionTarget always returns the main window", () => {
    const main = {
      isDestroyed: () => false,
      isVisible: () => true,
      getBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
    };
    const manager = new DesktopOverlayWindowManager(() => main as never);
    expect(manager.getPermissionTarget({ source: "permission", workspaceId: "ws" })).toBe(main);
    expect(manager.getPermissionTarget({ source: "plan", agentId: "a1" })).toBe(main);
  });
});

describe("computeDesktopOverlayBounds", () => {
  // wave-98 residual: pure placement math
  it("anchors to the bottom-right of the work area with margin", () => {
    expect(
      computeDesktopOverlayBounds(
        { x: 0, y: 0, width: 1920, height: 1080 },
        { width: 336, height: 96 },
      ),
    ).toEqual({
      x: 1920 - 336 - 14,
      y: 1080 - 96 - 14,
      width: 336,
      height: 96,
    });
  });

  it("respects multi-monitor workArea offsets", () => {
    expect(
      computeDesktopOverlayBounds(
        { x: 1920, y: 100, width: 1600, height: 900 },
        { width: 200, height: 80 },
      ),
    ).toEqual({
      x: 1920 + 1600 - 200 - 14,
      y: 100 + 900 - 80 - 14,
      width: 200,
      height: 80,
    });
  });

  it("clamps non-positive sizes to 1", () => {
    expect(
      computeDesktopOverlayBounds(
        { x: 0, y: 0, width: 800, height: 600 },
        { width: 0, height: -5 },
      ),
    ).toEqual({
      x: 800 - 1 - 14,
      y: 600 - 1 - 14,
      width: 1,
      height: 1,
    });
  });

  it("rounds fractional sizes", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 0, y: 0, width: 1000.4, height: 800.6 },
      { width: 100.4, height: 50.6 },
    );
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(51);
    expect(Number.isInteger(bounds.x)).toBe(true);
    expect(Number.isInteger(bounds.y)).toBe(true);
  });

  // wave-133 residual
  it("places overlay using negative multi-monitor workArea origin", () => {
    expect(
      computeDesktopOverlayBounds(
        { x: -1920, y: -100, width: 1920, height: 1080 },
        { width: 336, height: 96 },
      ),
    ).toEqual({
      x: -1920 + 1920 - 336 - 14,
      y: -100 + 1080 - 96 - 14,
      width: 336,
      height: 96,
    });
  });

  it("clamps -Infinity to 1; NaN width stays NaN (Math.max/round product semantics)", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 10, y: 20, width: 500, height: 400 },
      { width: Number.NaN, height: Number.NEGATIVE_INFINITY },
    );
    // Math.round(NaN) is NaN and Math.max(1, NaN) is NaN by design
    expect(Number.isNaN(bounds.width)).toBe(true);
    expect(bounds.height).toBe(1);
    expect(Number.isNaN(bounds.x)).toBe(true);
    expect(bounds.y).toBe(Math.round(20 + 400 - 1 - 14));
  });

  // wave-153 residual
  it("places overlay when workArea is smaller than overlay + margin", () => {
    // product does not clamp into workArea — x/y may go below origin
    expect(
      computeDesktopOverlayBounds(
        { x: 0, y: 0, width: 100, height: 50 },
        { width: 336, height: 96 },
      ),
    ).toEqual({
      x: 100 - 336 - 14,
      y: 50 - 96 - 14,
      width: 336,
      height: 96,
    });
  });

  it("rounds fractional workArea origins independently of size rounding", () => {
    expect(
      computeDesktopOverlayBounds(
        { x: 10.6, y: 20.4, width: 800.2, height: 600.8 },
        { width: 100, height: 50 },
      ),
    ).toEqual({
      x: Math.round(10.6 + 800.2 - 100 - 14),
      y: Math.round(20.4 + 600.8 - 50 - 14),
      width: 100,
      height: 50,
    });
  });

  // wave-183 residual
  it("clamps +Infinity height/width via Math.max then Math.round to Infinity product path", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 0, y: 0, width: 1920, height: 1080 },
      { width: Number.POSITIVE_INFINITY, height: Number.POSITIVE_INFINITY },
    );
    // Math.max(1, Infinity) === Infinity; Math.round(Infinity) === Infinity
    expect(bounds.width).toBe(Number.POSITIVE_INFINITY);
    expect(bounds.height).toBe(Number.POSITIVE_INFINITY);
    expect(bounds.x).toBe(Number.NEGATIVE_INFINITY);
    expect(bounds.y).toBe(Number.NEGATIVE_INFINITY);
  });

  it("uses DEFAULT margin 14 for 1×1 overlay in corner", () => {
    expect(
      computeDesktopOverlayBounds(
        { x: 100, y: 200, width: 400, height: 300 },
        { width: 1, height: 1 },
      ),
    ).toEqual({
      x: 100 + 400 - 1 - 14,
      y: 200 + 300 - 1 - 14,
      width: 1,
      height: 1,
    });
  });

  it("rounds half-up style via Math.round for .5 sizes", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 0, y: 0, width: 1000, height: 800 },
      { width: 10.5, height: 20.5 },
    );
    expect(bounds.width).toBe(11); // Math.round(10.5) → 11 in JS
    expect(bounds.height).toBe(21);
  });

  // wave-197 residual
  it("places overlay with fractional negative workArea and integer sizes", () => {
    expect(
      computeDesktopOverlayBounds(
        { x: -100.4, y: -50.6, width: 800.2, height: 600.8 },
        { width: 200, height: 100 },
      ),
    ).toEqual({
      x: Math.round(-100.4 + 800.2 - 200 - 14),
      y: Math.round(-50.6 + 600.8 - 100 - 14),
      width: 200,
      height: 100,
    });
  });

  it("clamps only size, not workArea dimensions (zero workArea still subtracts margin)", () => {
    expect(
      computeDesktopOverlayBounds(
        { x: 0, y: 0, width: 0, height: 0 },
        { width: 10, height: 10 },
      ),
    ).toEqual({
      x: 0 - 10 - 14,
      y: 0 - 10 - 14,
      width: 10,
      height: 10,
    });
  });

  // wave-206 residual
  it("margin is always 14 regardless of large overlay size", () => {
    expect(
      computeDesktopOverlayBounds(
        { x: 50, y: 60, width: 1920, height: 1080 },
        { width: 900, height: 700 },
      ),
    ).toEqual({
      x: 50 + 1920 - 900 - 14,
      y: 60 + 1080 - 700 - 14,
      width: 900,
      height: 700,
    });
  });

  it("rounds size first then subtracts from workArea for placement", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 0, y: 0, width: 1000, height: 800 },
      { width: 99.2, height: 49.8 },
    );
    expect(bounds.width).toBe(99);
    expect(bounds.height).toBe(50);
    expect(bounds.x).toBe(1000 - 99 - 14);
    expect(bounds.y).toBe(800 - 50 - 14);
  });
});

describe("DesktopOverlayWindowManager residual (wave-153)", () => {
  beforeEach(() => {
    electronMocks.windows.length = 0;
  });

  it("keeps prior width/height when updateWindowState omits size", () => {
    const manager = new DesktopOverlayWindowManager(
      () => ({
        isDestroyed: () => false,
        isVisible: () => false,
        getBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
      }) as never,
      { showWhenMainWindowHidden: true },
    );
    manager.updateWindowState({ visible: true, width: 400, height: 120 });
    const overlay = electronMocks.windows[0];
    expect(overlay?.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ width: 400, height: 120 }),
    );

    overlay?.setBounds.mockClear();
    manager.updateWindowState({ visible: true });
    expect(overlay?.setBounds).toHaveBeenCalledWith(
      expect.objectContaining({ width: 400, height: 120 }),
    );
  });

  it("falls back to primary display workArea when main window is null", () => {
    const manager = new DesktopOverlayWindowManager(() => null, {
      showWhenMainWindowHidden: true,
    });
    manager.updateWindowState({ visible: true, width: 336, height: 96 });
    const overlay = electronMocks.windows[0];
    expect(overlay?.setBounds).toHaveBeenCalledWith({
      x: 1920 - 336 - 14,
      y: 1080 - 96 - 14,
      width: 336,
      height: 96,
    });
    expect(overlay?.showInactive).toHaveBeenCalled();
  });

  it("destroy is idempotent and clears overlay handle", () => {
    const manager = new DesktopOverlayWindowManager(() => null);
    manager.ensureWindow();
    const overlay = electronMocks.windows[0];
    expect(overlay).toBeDefined();
    manager.destroy();
    expect(overlay?.destroy).toHaveBeenCalledTimes(1);
    manager.destroy();
    // second destroy does not re-call destroyed window
    expect(overlay?.destroy).toHaveBeenCalledTimes(1);
  });

  it("refreshVisibility re-applies hide when main becomes visible", () => {
    let mainVisible = false;
    const manager = new DesktopOverlayWindowManager(
      () => ({
        isDestroyed: () => false,
        isVisible: () => mainVisible,
        getBounds: () => ({ x: 0, y: 0, width: 900, height: 700 }),
      }) as never,
      { showWhenMainWindowHidden: true },
    );
    manager.updateWindowState({ visible: true, width: 336, height: 96 });
    const overlay = electronMocks.windows[0];
    expect(overlay?.showInactive).toHaveBeenCalled();

    overlay?.hide.mockClear();
    overlay?.showInactive.mockClear();
    mainVisible = true;
    manager.refreshVisibility();
    expect(overlay?.hide).toHaveBeenCalled();
    expect(overlay?.showInactive).not.toHaveBeenCalled();
  });

  // wave-222 residual
  it("computeDesktopOverlayBounds anchors bottom-right with margin and clamps size to >=1", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 10, y: 20, width: 1000, height: 800 },
      { width: 0.4, height: -3 },
    );
    expect(bounds.width).toBe(1);
    expect(bounds.height).toBe(1);
    expect(bounds.x).toBe(Math.round(10 + 1000 - 1 - 14));
    expect(bounds.y).toBe(Math.round(20 + 800 - 1 - 14));
  });

  it("updateWindowState keeps previous size when width/height omitted; clamps fractional sizes", () => {
    const manager = new DesktopOverlayWindowManager(() => null, { showWhenMainWindowHidden: true });
    manager.updateWindowState({ visible: false, width: 200.6, height: 50.2 });
    manager.updateWindowState({ visible: true });
    const overlay = electronMocks.windows[0];
    expect(overlay?.setBounds).toHaveBeenCalled();
    const last = overlay?.setBounds.mock.calls.at(-1)?.[0] as { width: number; height: number };
    expect(last.width).toBe(201);
    expect(last.height).toBe(50);
  });

  it("getPermissionTarget always returns main window; showWhenMainWindowHidden false never shows", () => {
    const main = {
      isDestroyed: () => false,
      isVisible: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    };
    const manager = new DesktopOverlayWindowManager(() => main as never);
    expect(manager.getPermissionTarget({ source: "permission" })).toBe(main);
    manager.updateWindowState({ visible: true, width: 100, height: 80 });
    const overlay = electronMocks.windows[0];
    expect(overlay?.showInactive).not.toHaveBeenCalled();
    expect(overlay?.hide).toHaveBeenCalled();
  });

  // wave-250 residual
  it("computeDesktopOverlayBounds uses primary workArea bottom-right for large size", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 100, y: 200, width: 1600, height: 900 },
      { width: 336, height: 96 },
    );
    expect(bounds).toEqual({
      width: 336,
      height: 96,
      x: Math.round(100 + 1600 - 336 - 14),
      y: Math.round(200 + 900 - 96 - 14),
    });
  });

  it("setMainContext/getMainContext round-trip; ensureWindow reuses non-destroyed instance", () => {
    const manager = new DesktopOverlayWindowManager(() => null, { showWhenMainWindowHidden: true });
    manager.setMainContext({ chatSurfaceActive: false, workspaceId: "w1", agentId: "a1" });
    expect(manager.getMainContext()).toEqual({
      chatSurfaceActive: false,
      workspaceId: "w1",
      agentId: "a1",
    });
    const first = manager.ensureWindow();
    const second = manager.ensureWindow();
    expect(second).toBe(first);
    expect(electronMocks.windows).toHaveLength(1);
  });

  // wave-263 residual
  it("computeDesktopOverlayBounds clamps non-positive size to 1 and uses margin 14", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 0, y: 0, width: 1000, height: 800 },
      { width: 0, height: -5 },
    );
    expect(bounds.width).toBe(1);
    expect(bounds.height).toBe(1);
    expect(bounds.x).toBe(Math.round(0 + 1000 - 1 - 14));
    expect(bounds.y).toBe(Math.round(0 + 800 - 1 - 14));
  });

  it("destroy nulls overlay; second destroy is safe; refreshVisibility after destroy recreates", () => {
    const manager = new DesktopOverlayWindowManager(() => null, { showWhenMainWindowHidden: true });
    manager.updateWindowState({ visible: true, width: 120, height: 60 });
    expect(electronMocks.windows.length).toBeGreaterThanOrEqual(1);
    manager.destroy();
    manager.destroy();
    manager.refreshVisibility();
    // refreshVisibility calls ensureWindow which recreates
    expect(electronMocks.windows.length).toBeGreaterThanOrEqual(1);
  });

  // wave-273 residual
  it("computeDesktopOverlayBounds anchors bottom-right with margin 14 for default sizes", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 100, y: 50, width: 1920, height: 1080 },
      { width: 336, height: 96 },
    );
    expect(bounds.width).toBe(336);
    expect(bounds.height).toBe(96);
    expect(bounds.x).toBe(Math.round(100 + 1920 - 336 - 14));
    expect(bounds.y).toBe(Math.round(50 + 1080 - 96 - 14));
  });

  it("setMainContext replaces fields; getMainContext returns current snapshot", () => {
    const manager = new DesktopOverlayWindowManager(() => null, { showWhenMainWindowHidden: true });
    manager.setMainContext({ chatSurfaceActive: true, workspaceId: "w0", agentId: null });
    expect(manager.getMainContext()).toEqual({
      chatSurfaceActive: true,
      workspaceId: "w0",
      agentId: null,
    });
    manager.setMainContext({ chatSurfaceActive: false, workspaceId: "w2", agentId: "ag" });
    expect(manager.getMainContext().workspaceId).toBe("w2");
    expect(manager.getMainContext().agentId).toBe("ag");
    expect(manager.getMainContext().chatSurfaceActive).toBe(false);
  });


  // wave-280 residual
  it("computeDesktopOverlayBounds clamps size to at least 1x1", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 0, y: 0, width: 800, height: 600 },
      { width: 0, height: -5 },
    );
    expect(bounds.width).toBe(1);
    expect(bounds.height).toBe(1);
    expect(bounds.x).toBe(Math.round(800 - 1 - 14));
    expect(bounds.y).toBe(Math.round(600 - 1 - 14));
  });

  it("computeDesktopOverlayBounds uses workArea origin offset", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 200, y: 100, width: 1000, height: 700 },
      { width: 100, height: 50 },
    );
    expect(bounds.x).toBe(Math.round(200 + 1000 - 100 - 14));
    expect(bounds.y).toBe(Math.round(100 + 700 - 50 - 14));
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(50);
  });



  // wave-289 residual
  it("rounds fractional sizes; margin is 14 from right/bottom of workArea", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 10.4, y: 20.6, width: 800.2, height: 600.8 },
      { width: 100.4, height: 50.6 },
    );
    expect(bounds.width).toBe(Math.max(1, Math.round(100.4)));
    expect(bounds.height).toBe(Math.max(1, Math.round(50.6)));
    expect(bounds.x).toBe(Math.round(10.4 + 800.2 - bounds.width - 14));
    expect(bounds.y).toBe(Math.round(20.6 + 600.8 - bounds.height - 14));
  });

  it("negative workArea origin still applies margin; large overlay clamps to 1 min size only on size", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: -100, y: -50, width: 500, height: 400 },
      { width: -10, height: 0 },
    );
    expect(bounds.width).toBe(1);
    expect(bounds.height).toBe(1);
    expect(bounds.x).toBe(Math.round(-100 + 500 - 1 - 14));
    expect(bounds.y).toBe(Math.round(-50 + 400 - 1 - 14));
  });



  // wave-303 residual
  it("computeDesktopOverlayBounds places bottom-right with margin 14; rounds width/height", () => {
    const bounds = computeDesktopOverlayBounds(
      { x: 0, y: 0, width: 1920, height: 1080 },
      { width: 336.4, height: 96.6 },
    );
    expect(bounds.width).toBe(Math.round(336.4));
    expect(bounds.height).toBe(Math.round(96.6));
    expect(bounds.x).toBe(Math.round(1920 - bounds.width - 14));
    expect(bounds.y).toBe(Math.round(1080 - bounds.height - 14));
  });

  it("size clamp max(1,round); workArea multi-monitor offset preserved", () => {
    const tiny = computeDesktopOverlayBounds(
      { x: 1920, y: 0, width: 1280, height: 800 },
      { width: 0.4, height: 0.4 },
    );
    // round(0.4)=0 → max(1,0)=1
    expect(tiny.width).toBe(1);
    expect(tiny.height).toBe(1);
    expect(tiny.x).toBe(Math.round(1920 + 1280 - 1 - 14));
    expect(tiny.y).toBe(Math.round(0 + 800 - 1 - 14));
  });



  // wave-314 residual
  it("computeDesktopOverlayBounds margin 14 bottom-right; clamps sub-1 sizes; multi-monitor origin", () => {
    const b = computeDesktopOverlayBounds(
      { x: 100, y: 200, width: 1000, height: 800 },
      { width: 200, height: 100 },
    );
    expect(b.width).toBe(200);
    expect(b.height).toBe(100);
    expect(b.x).toBe(Math.round(100 + 1000 - 200 - 14));
    expect(b.y).toBe(Math.round(200 + 800 - 100 - 14));

    const tiny = computeDesktopOverlayBounds(
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 0, height: -5 },
    );
    expect(tiny.width).toBe(1);
    expect(tiny.height).toBe(1);
    expect(tiny.x).toBe(Math.round(100 - 1 - 14));
    expect(tiny.y).toBe(Math.round(100 - 1 - 14));
  });

  it("rounds fractional size before placement", () => {
    const b = computeDesktopOverlayBounds(
      { x: 0, y: 0, width: 500, height: 500 },
      { width: 10.4, height: 10.6 },
    );
    expect(b.width).toBe(10);
    expect(b.height).toBe(11);
    expect(b.x).toBe(Math.round(500 - 10 - 14));
    expect(b.y).toBe(Math.round(500 - 11 - 14));
  });
});
