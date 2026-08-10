import { BrowserWindow, screen } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { attachWebSecurityHandlers } from "./web-security";

const OVERLAY_MARGIN = 14;
const DEFAULT_WIDTH = 336;
const DEFAULT_HEIGHT = 96;

export interface DesktopOverlayMainContext {
    chatSurfaceActive: boolean;
    workspaceId?: string;
    agentId?: string | null;
}

export interface DesktopOverlayWindowState {
    visible: boolean;
    width?: number;
    height?: number;
}

export interface DesktopOverlayPermissionTarget {
    workspaceId?: string;
    agentId?: string;
    source: "permission" | "plan" | "extension";
}
export interface DesktopOverlayWindowManagerOptions {
    showWhenMainWindowHidden?: boolean;
}


export function computeDesktopOverlayBounds(
    workArea: { x: number; y: number; width: number; height: number },
    size: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
    const width = Math.max(1, Math.round(size.width));
    const height = Math.max(1, Math.round(size.height));
    return {
        x: Math.round(workArea.x + workArea.width - width - OVERLAY_MARGIN),
        y: Math.round(workArea.y + workArea.height - height - OVERLAY_MARGIN),
        width,
        height,
    };
}

export class DesktopOverlayWindowManager {
    private overlayWindow: BrowserWindow | null = null;
    private mainContext: DesktopOverlayMainContext = { chatSurfaceActive: true };
    private overlayState: Required<Pick<DesktopOverlayWindowState, "visible" | "width" | "height">> = {
        visible: false,
        width: DEFAULT_WIDTH,
        height: DEFAULT_HEIGHT,
    };

    constructor(
        private readonly getMainWindow: () => BrowserWindow | null,
        private readonly options: DesktopOverlayWindowManagerOptions = {},
    ) {}

    ensureWindow(): BrowserWindow {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            return this.overlayWindow;
        }

        const overlayWindow = new BrowserWindow({
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            show: false,
            frame: false,
            transparent: true,
            backgroundColor: "#00000000",
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            hasShadow: false,
            // Windows: an always-on-top focusable overlay can eat the first click
            // aimed at the main window when the app is in the background.
            focusable: false,
            webPreferences: {
                preload: join(__dirname, "../preload/index.js"),
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
            },
        });

        overlayWindow.setAlwaysOnTop(true, "screen-saver");
        overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        overlayWindow.on("closed", () => {
            this.overlayWindow = null;
        });

        // audit round 3, Task 2.4: overlay is a renderer surface (permission /
        // extension UI) — attach open/navigate guards before loadURL so a
        // compromised overlay page can't pop a second window or navigate away.
        attachWebSecurityHandlers(overlayWindow);

        if (is.dev && process.env.ELECTRON_RENDERER_URL) {
            void overlayWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay.html`);
        } else {
            void overlayWindow.loadFile(join(__dirname, "../renderer/overlay.html"));
        }

        this.overlayWindow = overlayWindow;
        this.applyWindowState();
        return overlayWindow;
    }

    setMainContext(next: DesktopOverlayMainContext): void {
        this.mainContext = next;
    }

    getMainContext(): DesktopOverlayMainContext {
        return this.mainContext;
    }

    updateWindowState(next: DesktopOverlayWindowState): void {
        this.overlayState = {
            visible: next.visible,
            width: Math.max(1, Math.round(next.width ?? this.overlayState.width ?? DEFAULT_WIDTH)),
            height: Math.max(1, Math.round(next.height ?? this.overlayState.height ?? DEFAULT_HEIGHT)),
        };
        this.applyWindowState();
    }

    getPermissionTarget(target: DesktopOverlayPermissionTarget): BrowserWindow | null {
        void target;
        return this.getMainWindow();
    }

    refreshVisibility(): void {
        this.applyWindowState();
    }

    destroy(): void {
        if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
            this.overlayWindow.destroy();
        }
        this.overlayWindow = null;
    }

    private applyWindowState(): void {
        const overlayWindow = this.ensureWindow();
        const shouldShow = this.overlayState.visible
            && !this.isMainWindowVisible()
            && this.options.showWhenMainWindowHidden === true;
        if (!shouldShow) {
            overlayWindow.hide();
            return;
        }
        const workArea = this.resolveWorkArea();
        overlayWindow.setBounds(computeDesktopOverlayBounds(workArea, {
            width: this.overlayState.width,
            height: this.overlayState.height,
        }));
        if (!overlayWindow.isVisible()) {
            overlayWindow.showInactive();
        }
    }

    private resolveWorkArea(): { x: number; y: number; width: number; height: number } {
        const mainWindow = this.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            return screen.getDisplayMatching(mainWindow.getBounds()).workArea;
        }
        return screen.getPrimaryDisplay().workArea;
    }

    private isMainWindowVisible(): boolean {
        const mainWindow = this.getMainWindow();
        return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
    }
}
