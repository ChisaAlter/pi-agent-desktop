import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";

type ShellTestGlobals = typeof globalThis & {
  __PI_DESKTOP_TEST_SHELL__?: {
    hasTray: () => boolean;
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

test.describe("Windows first-click foreground", () => {
  let app: ElectronApplication;

  test.afterEach(async () => {
    try {
      await app?.evaluate(() => {
        const target = globalThis as ShellTestGlobals;
        target.__PI_DESKTOP_TEST_SHELL__?.quitApp();
      });
      await app?.close();
    } catch {
      // ignore
    }
  });

  test("tray restore focuses main window on first restore call", async () => {
    ({ app } = await launchApp(test.info().outputPath(`first-click-tray-${Date.now()}`)));

    await expect.poll(async () => {
      return app.evaluate(() => {
        const target = globalThis as ShellTestGlobals;
        return target.__PI_DESKTOP_TEST_SHELL__?.hasTray() ?? false;
      });
    }, { timeout: 10_000 }).toBe(true);

    await app.evaluate(() => {
      const target = globalThis as ShellTestGlobals;
      target.__PI_DESKTOP_TEST_SHELL__?.closeMainWindow();
    });

    await expect.poll(async () => {
      return app.evaluate(() => {
        const target = globalThis as ShellTestGlobals;
        return target.__PI_DESKTOP_TEST_SHELL__?.isMainWindowVisible() ?? true;
      });
    }, { timeout: 10_000 }).toBe(false);

    await app.evaluate(() => {
      const target = globalThis as ShellTestGlobals;
      target.__PI_DESKTOP_TEST_SHELL__?.restoreMainWindow();
    });

    await expect.poll(async () => {
      return app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => {
          try {
            return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
          } catch {
            return false;
          }
        });
        if (!win) return { visible: false, focused: false };
        return { visible: win.isVisible(), focused: win.isFocused() };
      });
    }, { timeout: 10_000 }).toMatchObject({ visible: true, focused: true });
  });

  test("foreground IPC re-focuses main window after another window steals focus", async () => {
    ({ app } = await launchApp(test.info().outputPath(`first-click-blur-${Date.now()}`)));
    const page = await getWindowByUrl(app, "index.html");
    await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 30_000 });

    // Playwright's BrowserWindow.blur() is unreliable on Windows CI. Create a
    // temporary always-on-top window and give it focus instead.
    await app.evaluate(({ BrowserWindow }) => {
      const decoy = new BrowserWindow({
        width: 320,
        height: 200,
        show: true,
        frame: true,
        alwaysOnTop: true,
        skipTaskbar: true,
      });
      decoy.setAlwaysOnTop(true);
      decoy.show();
      decoy.focus();
      (globalThis as { __PI_DESKTOP_TEST_DECOY__?: BrowserWindow }).__PI_DESKTOP_TEST_DECOY__ = decoy;
    });

    await expect.poll(async () => {
      return app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => {
          try {
            return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
          } catch {
            return false;
          }
        });
        return win?.isFocused() ?? true;
      });
    }, { timeout: 5_000 }).toBe(false);

    // Simulate the renderer first-click path.
    await page.evaluate(() => {
      window.piAPI?.send?.("window:foreground-on-pointer");
    });

    await expect.poll(async () => {
      return app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => {
          try {
            return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
          } catch {
            return false;
          }
        });
        if (!win) return { visible: false, focused: false };
        return { visible: win.isVisible(), focused: win.isFocused() };
      });
    }, { timeout: 5_000 }).toMatchObject({ visible: true, focused: true });

    await app.evaluate(() => {
      const decoy = (globalThis as { __PI_DESKTOP_TEST_DECOY__?: { destroy(): void; isDestroyed(): boolean } })
        .__PI_DESKTOP_TEST_DECOY__;
      if (decoy && !decoy.isDestroyed()) decoy.destroy();
    });
  });


  
  
  test("intentional minimize stays minimized", async () => {
    ({ app } = await launchApp(test.info().outputPath(`first-click-intentional-min-${Date.now()}`)));
    const page = await getWindowByUrl(app, "index.html");
    await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 30_000 });

    // Focus main, then minimize while focused — must stay minimized.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => {
        try {
          return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
        } catch {
          return false;
        }
      });
      win?.show();
      win?.focus();
      win?.minimize();
    });

    await expect.poll(async () => {
      return app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => {
          try {
            return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
          } catch {
            return false;
          }
        });
        return win?.isMinimized() ?? false;
      });
    }, { timeout: 5_000 }).toBe(true);

    // Give the repair timer a chance to fire incorrectly; still minimized.
    await page.waitForTimeout(300);
    const stillMinimized = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => {
        try {
          return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
        } catch {
          return false;
        }
      });
      return win?.isMinimized() ?? false;
    });
    expect(stillMinimized).toBe(true);
  });

  test("repairs unfocused minimize from taskbar toggle bug", async () => {
    ({ app } = await launchApp(test.info().outputPath(`first-click-toggle-${Date.now()}`)));
    const page = await getWindowByUrl(app, "index.html");
    await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 30_000 });

    // Steal focus with a decoy window, then minimize the main window while it
    // is unfocused — this is the intermittent taskbar toggle bug path.
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((candidate) => {
        try {
          return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
        } catch {
          return false;
        }
      });
      const decoy = new BrowserWindow({
        width: 280,
        height: 160,
        show: true,
        frame: true,
        alwaysOnTop: true,
        skipTaskbar: true,
      });
      decoy.setAlwaysOnTop(true);
      decoy.show();
      decoy.focus();
      (globalThis as { __PI_DESKTOP_TEST_DECOY__?: BrowserWindow }).__PI_DESKTOP_TEST_DECOY__ = decoy;
      // Stay unfocused long enough that this is NOT an intentional
      // blur→minimize pair from taskbar toggle-while-focused.
      setTimeout(() => {
        main?.minimize();
      }, 350);
    });

    await expect.poll(async () => {
      return app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => {
          try {
            return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
          } catch {
            return false;
          }
        });
        if (!win) return { minimized: true, focused: false, visible: false };
        return {
          minimized: win.isMinimized(),
          focused: win.isFocused(),
          visible: win.isVisible(),
        };
      });
    }, { timeout: 5_000 }).toMatchObject({ minimized: false, focused: true, visible: true });

    await app.evaluate(() => {
      const decoy = (globalThis as { __PI_DESKTOP_TEST_DECOY__?: { destroy(): void; isDestroyed(): boolean } })
        .__PI_DESKTOP_TEST_DECOY__;
      if (decoy && !decoy.isDestroyed()) decoy.destroy();
    });
  });

  test("taskbar restore soft-focuses on first restore event", async () => {
    ({ app } = await launchApp(test.info().outputPath(`first-click-taskbar-${Date.now()}`)));
    const page = await getWindowByUrl(app, "index.html");
    await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 30_000 });

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => {
        try {
          return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
        } catch {
          return false;
        }
      });
      win?.minimize();
    });

    await expect.poll(async () => {
      return app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => {
          try {
            return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
          } catch {
            return false;
          }
        });
        return win?.isMinimized() ?? false;
      });
    }, { timeout: 5_000 }).toBe(true);

    // Simulate one taskbar click: OS restore + activation.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((candidate) => {
        try {
          return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
        } catch {
          return false;
        }
      });
      if (!win) return;
      win.restore();
      // restore event handler should soft-focus; also call show/focus like shell.
      win.show();
    });

    await expect.poll(async () => {
      return app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((candidate) => {
          try {
            return !candidate.isDestroyed() && candidate.webContents.getURL().includes("index.html");
          } catch {
            return false;
          }
        });
        if (!win) return { minimized: true, visible: false, focused: false };
        return {
          minimized: win.isMinimized(),
          visible: win.isVisible(),
          focused: win.isFocused(),
        };
      });
    }, { timeout: 5_000 }).toMatchObject({ minimized: false, visible: true, focused: true });
  });

  test("desktop overlay is created non-focusable", async () => {
    ({ app } = await launchApp(test.info().outputPath(`first-click-overlay-${Date.now()}`)));

    await expect.poll(async () => {
      return app.evaluate(({ BrowserWindow }) => {
        const overlay = BrowserWindow.getAllWindows().find((candidate) => {
          try {
            return !candidate.isDestroyed() && candidate.webContents.getURL().includes("overlay.html");
          } catch {
            return false;
          }
        });
        if (!overlay) return null;
        return { focusable: overlay.isFocusable() };
      });
    }, { timeout: 10_000 }).toMatchObject({ focusable: false });
  });
});
