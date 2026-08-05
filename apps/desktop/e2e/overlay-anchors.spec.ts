import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync } from "fs";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";


type OverlayTestGlobals = typeof globalThis & {
  __PI_DESKTOP_TEST_OVERLAY__?: {
    emitPermissionRequest: (payload: {
      requestId: string;
      title: string;
      message?: string;
      workspaceId?: string;
      agentId?: string | null;
    }) => void;
  };
  __PI_DESKTOP_TEST_SHELL__?: {
    closeMainWindow: () => void;
    restoreMainWindow: () => void;
    isMainWindowVisible: () => boolean;
    quitApp: () => void;
  };
};

async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
    env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "" },
  });
  const page = await getWindowByUrl(app, "index.html");
  const modal = page.locator("[data-testid=\"onboarding-modal\"]");
  if (await modal.count()) {
    await page.getByRole("button", { name: "跳过引导" }).click();
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
  }
  return { app, page };
}

async function setWindowSize(app: ElectronApplication, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows().find((item) => {
      try {
        return !item.isDestroyed() && item.webContents.getURL().includes("index.html");
      } catch {
        return false;
      }
    });
    win?.setSize(size.width, size.height);
    win?.show();
  }, { width, height });
}

async function seedWorkspace(page: Page, workspacePath: string): Promise<{ workspaceId: string }> {
  mkdirSync(workspacePath, { recursive: true });
  const workspaceId = await page.evaluate(async (targetPath) => {
    const created = await window.piAPI.createWorkspace("overlay-anchor-e2e", targetPath);
    if (!created || !("id" in created)) {
      throw new Error("Failed to create overlay anchor acceptance workspace");
    }
    await window.piAPI.selectWorkspace(targetPath);
    return created.id;
  }, workspacePath);
  return { workspaceId };
}

async function emitPermissionRequest(
  app: ElectronApplication,
  request: { requestId: string; title: string; message?: string; workspaceId?: string; agentId?: string | null },
): Promise<void> {
  await app.evaluate((_electron, payload) => {
    const target = globalThis as OverlayTestGlobals;
    if (!target.__PI_DESKTOP_TEST_OVERLAY__) {
      throw new Error("Missing __PI_DESKTOP_TEST_OVERLAY__ test hook");
    }
    target.__PI_DESKTOP_TEST_OVERLAY__.emitPermissionRequest(payload);
  }, request);
}

async function emitApprovalReview(
  app: ElectronApplication,
  review: { workspaceId: string; filePath: string; changeId: string },
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, payload) => {
    const win = BrowserWindow.getAllWindows().find((item) => {
      try {
        return !item.isDestroyed() && item.webContents.getURL().includes("index.html");
      } catch {
        return false;
      }
    });
    if (!win) throw new Error("Main window not found for approval injection");
    const event = {
      workspaceId: payload.workspaceId,
      changeId: payload.changeId,
      toolCallId: payload.changeId,
      filePath: payload.filePath,
      timestamp: Date.now(),
    };
    win.webContents.send("approval:deferred", { ...event, op: "write" });
    win.webContents.send("approval:review", {
      ...event,
      diff: "--- a/src/risky.ts\n+++ b/src/risky.ts\n@@ -1 +1 @@\n-export const safe = true;\n+export const risky = true;\n",
      newContent: "export const risky = true;\n",
    });
  }, review);
}

async function measureApprovalComposerGeometry(page: Page): Promise<{
  gap: number;
  overlap: number;
  panelTop: number;
  panelRight: number;
  panelHeight: number;
  viewportWidth: number;
  documentOverflow: number;
}> {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-testid=\"approval-panel\"]")?.getBoundingClientRect();
    const composer = document.querySelector("[data-testid=\"chat-input-shell\"]")?.getBoundingClientRect();
    const scrollingElement = document.scrollingElement;
    if (!panel || !composer || !scrollingElement) {
      throw new Error("Missing approval panel, composer, or scrolling element");
    }
    return {
      gap: composer.top - panel.bottom,
      overlap: Math.max(0, Math.min(panel.bottom, composer.bottom) - Math.max(panel.top, composer.top)),
      panelTop: panel.top,
      panelRight: panel.right,
      panelHeight: panel.height,
      viewportWidth: window.innerWidth,
      documentOverflow: scrollingElement.scrollHeight - scrollingElement.clientHeight,
    };
  });
}

async function emitAgentsState(
  app: ElectronApplication,
  agents: Array<{
    id: string;
    workspaceId: string;
    title: string;
    status: "starting" | "idle" | "running" | "error" | "closed";
    createdAt: number;
    updatedAt: number;
  }>,
): Promise<void> {
  await app.evaluate(({ BrowserWindow }, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send("agents:state", payload);
        }
      } catch {
        // ignore
      }
    }
  }, agents);
}

async function inspectOverlayWindow(app: ElectronApplication): Promise<null | {
  visible: boolean;
  dom: {
    permissionVisible: boolean;
    reminderVisible: boolean;
    reminderText: string | null;
  };
}> {
  return app.evaluate(async ({ BrowserWindow }) => {
    const overlay = BrowserWindow.getAllWindows().find((item) => {
      try {
        return !item.isDestroyed() && item.webContents.getURL().includes("overlay.html");
      } catch {
        return false;
      }
    });
    if (!overlay) return null;
    const dom = await overlay.webContents.executeJavaScript(`(() => {
      const permission = document.querySelector('[data-testid="permission-request-overlay"] [role="alertdialog"]');
      const reminder = document.querySelector('[role="status"][aria-label="任务运行中提醒"]');
      return {
        permissionVisible: Boolean(permission),
        reminderVisible: Boolean(reminder),
        reminderText: reminder ? reminder.textContent : null,
      };
    })()`, true);
    return {
      visible: overlay.isVisible(),
      dom,
    };
  });
}


test.describe("Pi Desktop overlay anchors", () => {
  let app: ElectronApplication;
  let page: Page;

  test.afterEach(async () => {
    try {
      await app?.evaluate(() => {
        const target = globalThis as OverlayTestGlobals;
        target.__PI_DESKTOP_TEST_SHELL__?.quitApp();
      });
      await app?.close();
    } catch {
      // ignore
    }
  });

  test("routes permissions and progress to the main composer while keeping hidden-window progress silent", async () => {
    const userDataDir = test.info().outputPath(`overlay-anchors-${Date.now()}`);
    const workspacePath = test.info().outputPath("overlay-anchor-workspace");
    ({ app, page } = await launchApp(userDataDir));
    await setWindowSize(app, 1365, 768);
    await page.bringToFront();
    const { workspaceId } = await seedWorkspace(page, workspacePath);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator("[data-testid=\"chat-input-shell\"]")).toBeVisible({ timeout: 15_000 });

    await emitPermissionRequest(app, {
      requestId: "main_chat_permission",
      workspaceId,
      title: "允许读取 package.json",
      message: "read package.json",
    });

    const chatPermission = page.getByRole("alertdialog", { name: "权限请求 1" });
    await expect(chatPermission).toBeVisible({ timeout: 5_000 });
    const chatGeometry = await page.evaluate(() => {
      const composer = document.querySelector("[data-testid=\"chat-input-shell\"]");
      const dialog = document.querySelector("[data-testid=\"permission-request-overlay\"] [role=\"alertdialog\"]");
      const composerRect = composer?.getBoundingClientRect();
      const dialogRect = dialog?.getBoundingClientRect();
      return {
        leftDelta: composerRect && dialogRect ? Math.abs(dialogRect.left - composerRect.left) : 999,
        rightDelta: composerRect && dialogRect ? Math.abs(dialogRect.right - composerRect.right) : 999,
        bottomGap: composerRect && dialogRect ? Math.abs(composerRect.top - dialogRect.bottom) : 999,
      };
    });
    // Windows DPI/subpixel layout: allow ~3px edge drift; bottom gap can land ~6px at 125% DPI.
    expect(chatGeometry.leftDelta, JSON.stringify(chatGeometry)).toBeLessThanOrEqual(3);
    expect(chatGeometry.rightDelta, JSON.stringify(chatGeometry)).toBeLessThanOrEqual(3);
    expect(chatGeometry.bottomGap, JSON.stringify(chatGeometry)).toBeGreaterThanOrEqual(5);
    expect(chatGeometry.bottomGap, JSON.stringify(chatGeometry)).toBeLessThanOrEqual(16);
    expect((await inspectOverlayWindow(app))?.dom.permissionVisible ?? false).toBe(false);
    await page.screenshot({ path: test.info().outputPath("overlay-cluster-02-chat-permission.png"), fullPage: true });

    await page.keyboard.press("Escape");
    await expect(chatPermission).toHaveCount(0, { timeout: 5_000 });

    await page.getByRole("tab", { name: "扩展" }).click();
    await emitPermissionRequest(app, {
      requestId: "main_tools_permission",
      workspaceId,
      title: "允许运行测试命令",
      message: "pnpm test",
    });

    await expect(page.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("alertdialog", { name: "权限请求 1" })).toBeVisible({ timeout: 5_000 });
    expect((await inspectOverlayWindow(app))?.dom.permissionVisible ?? false).toBe(false);
    await page.screenshot({ path: test.info().outputPath("overlay-cluster-03-tools-permission-return-chat.png"), fullPage: true });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog", { name: "权限请求 1" })).toHaveCount(0, { timeout: 5_000 });

    await page.evaluate(() => {
      const original = window.piAPI.sendPrompt.bind(window.piAPI);
      window.piAPI.sendPrompt = async (...args) => {
        void original;
        void args;
        return new Promise<void>(() => undefined);
      };
    });
    await page.getByRole("textbox", { name: "发送" }).fill("触发工作区运行中细条");
    await page.getByRole("textbox", { name: "发送" }).press("Enter");

    await expect(page.getByRole("status", { name: "任务运行中提醒" })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid="chat-input-shell"]').getByText("任务运行中 · 新输入会作为追加指令进入当前会话")).toBeVisible({ timeout: 5_000 });
    const visibleOverlay = await inspectOverlayWindow(app);
    expect(visibleOverlay?.visible ?? false).toBe(false);
    await page.screenshot({ path: test.info().outputPath("overlay-cluster-05-main-progress-chat.png"), fullPage: true });

    await app.evaluate(() => {
      const target = globalThis as OverlayTestGlobals;
      target.__PI_DESKTOP_TEST_SHELL__?.closeMainWindow();
    });
    await expect.poll(async () => {
      return app.evaluate(() => {
        const target = globalThis as OverlayTestGlobals;
        return target.__PI_DESKTOP_TEST_SHELL__?.isMainWindowVisible() ?? true;
      });
    }, { timeout: 10_000 }).toBe(false);

    await emitAgentsState(app, [
      {
        id: "overlay_progress_agent",
        workspaceId,
        title: "Overlay Progress Agent",
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    await expect.poll(async () => {
      const overlay = await inspectOverlayWindow(app);
      return overlay?.visible ?? false;
    }, { timeout: 10_000 }).toBe(false);
  });

  test("keeps deferred approval reviews above the resizable composer", async () => {
    const userDataDir = test.info().outputPath(`approval-anchor-${Date.now()}`);
    const workspacePath = test.info().outputPath("approval-anchor-workspace");
    ({ app, page } = await launchApp(userDataDir));
    await setWindowSize(app, 1365, 768);
    await page.bringToFront();
    const { workspaceId } = await seedWorkspace(page, workspacePath);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");

    const composer = page.locator("[data-testid=\"chat-input-shell\"]");
    await expect(composer).toBeVisible({ timeout: 15_000 });
    await emitApprovalReview(app, {
      workspaceId,
      filePath: "src/risky.ts",
      changeId: "approval_anchor_change",
    });

    const approvalPanel = page.getByTestId("approval-panel");
    await expect(approvalPanel).toBeVisible({ timeout: 5_000 });
    const initialGeometry = await measureApprovalComposerGeometry(page);
    expect(initialGeometry.overlap, JSON.stringify(initialGeometry)).toBe(0);
    expect(initialGeometry.gap, JSON.stringify(initialGeometry)).toBeGreaterThanOrEqual(5);
    expect(initialGeometry.gap, JSON.stringify(initialGeometry)).toBeLessThanOrEqual(16);
    expect(initialGeometry.panelTop, JSON.stringify(initialGeometry)).toBeGreaterThanOrEqual(0);
    expect(initialGeometry.panelRight, JSON.stringify(initialGeometry)).toBeLessThanOrEqual(initialGeometry.viewportWidth);
    expect(initialGeometry.panelHeight, JSON.stringify(initialGeometry)).toBeLessThan(360);
    expect(initialGeometry.documentOverflow, JSON.stringify(initialGeometry)).toBeLessThanOrEqual(4);

    const resizeHandle = composer.getByRole("separator", { name: "调整输入框高度" });
    const resizeBox = await resizeHandle.boundingBox();
    expect(resizeBox).not.toBeNull();
    await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y + 3);
    await page.mouse.down();
    await page.mouse.move(resizeBox!.x + resizeBox!.width / 2, resizeBox!.y - 96);
    await page.mouse.up();
    await expect.poll(async () => composer.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(180);

    const resizedGeometry = await measureApprovalComposerGeometry(page);
    expect(resizedGeometry.overlap, JSON.stringify(resizedGeometry)).toBe(0);
    expect(resizedGeometry.gap, JSON.stringify(resizedGeometry)).toBeGreaterThanOrEqual(5);
    expect(resizedGeometry.gap, JSON.stringify(resizedGeometry)).toBeLessThanOrEqual(16);
    expect(resizedGeometry.panelTop, JSON.stringify(resizedGeometry)).toBeGreaterThanOrEqual(0);
    expect(resizedGeometry.panelHeight, JSON.stringify(resizedGeometry)).toBeLessThan(360);
    expect(resizedGeometry.documentOverflow, JSON.stringify(resizedGeometry)).toBeLessThanOrEqual(4);
    await page.screenshot({ path: test.info().outputPath("overlay-approval-above-resized-composer.png"), fullPage: true });
  });

  test("keeps the desktop progress reminder hidden after the main window closes", async () => {
    const userDataDir = test.info().outputPath(`overlay-silent-${Date.now()}`);
    const workspacePath = test.info().outputPath("overlay-silent-workspace");
    ({ app, page } = await launchApp(userDataDir));
    const { workspaceId } = await seedWorkspace(page, workspacePath);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator('[data-testid="chat-input-shell"]')).toBeVisible({ timeout: 15_000 });

    await app.evaluate(() => {
      const target = globalThis as OverlayTestGlobals;
      target.__PI_DESKTOP_TEST_SHELL__?.closeMainWindow();
    });
    await expect.poll(async () => {
      return app.evaluate(() => {
        const target = globalThis as OverlayTestGlobals;
        return target.__PI_DESKTOP_TEST_SHELL__?.isMainWindowVisible() ?? true;
      });
    }, { timeout: 10_000 }).toBe(false);

    await emitAgentsState(app, [
      {
        id: "silent_progress_agent",
        workspaceId,
        title: "Silent Progress Agent",
        status: "running",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    await expect.poll(async () => {
      const overlay = await inspectOverlayWindow(app);
      return overlay ? {
        visible: overlay.visible,
        reminderVisible: overlay.dom.reminderVisible,
      } : null;
    }, { timeout: 10_000 }).toMatchObject({
      visible: false,
      reminderVisible: true,
    });
  });
});
