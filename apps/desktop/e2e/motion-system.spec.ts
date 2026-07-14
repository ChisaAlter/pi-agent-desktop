import { expect, _electron, test, type ElectronApplication, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";

interface MotionSample {
  label: string;
  milliseconds: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY;
}

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const userDataDir = test.info().outputPath(`motion-user-data-${Date.now()}`);
  const app = await _electron.launch({
    executablePath: resolveElectronExecutablePath(),
    args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
    env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "" },
  });
  const page = await getWindowByUrl(app, "index.html");
  const onboarding = page.locator('[data-testid="onboarding-modal"]');
  if (await onboarding.count()) {
    await page.getByRole("button", { name: "跳过引导" }).click();
    await expect(onboarding).toHaveCount(0);
  }
  await page.waitForLoadState("networkidle");
  return { app, page };
}

async function measureMainTab(page: Page, label: string, panelId: string): Promise<number> {
  return page.evaluate(({ label: tabLabel, panelId: targetPanel }) => new Promise<number>((resolve, reject) => {
    const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
      .find((candidate) => candidate.getAttribute("aria-label") === tabLabel);
    if (!tab) {
      reject(new Error(`Missing main tab: ${tabLabel}`));
      return;
    }

    const startedAt = performance.now();
    tab.click();
    const deadline = startedAt + 2_000;
    const inspect = (): void => {
      const panel = document.querySelector<HTMLElement>(`[data-main-panel="${targetPanel}"]`);
      if (tab.getAttribute("aria-selected") === "true" && panel?.dataset.active === "true") {
        requestAnimationFrame(() => resolve(performance.now() - startedAt));
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error(`Main tab did not activate: ${tabLabel}`));
        return;
      }
      requestAnimationFrame(inspect);
    };
    inspect();
  }), { label, panelId });
}

async function measureSettingsTab(page: Page, label: string, tabId: string): Promise<number> {
  return page.evaluate(({ label: tabLabel, tabId: targetTab }) => new Promise<number>((resolve, reject) => {
    const tab = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]'))
      .find((candidate) => candidate.getAttribute("aria-label") === tabLabel);
    if (!tab) {
      reject(new Error(`Missing settings tab: ${tabLabel}`));
      return;
    }

    const startedAt = performance.now();
    tab.click();
    const deadline = startedAt + 2_000;
    const inspect = (): void => {
      const panel = document.querySelector<HTMLElement>('[data-testid="settings-active-panel"]');
      if (tab.getAttribute("aria-selected") === "true" && panel?.dataset.settingsActiveTab === targetTab) {
        requestAnimationFrame(() => resolve(performance.now() - startedAt));
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error(`Settings tab did not activate: ${tabLabel}`));
        return;
      }
      requestAnimationFrame(inspect);
    };
    inspect();
  }), { label, tabId });
}

test.describe("Pi Desktop silky motion acceptance", () => {
  test("keeps navigation immediate and transitions the main interaction surfaces", async () => {
    test.setTimeout(90_000);
    let app: ElectronApplication | undefined;

    try {
      const launched = await launchApp();
      app = launched.app;
      const page = launched.page;

      await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible();

      const mainTabs = [
        { label: "运行", panelId: "run" },
        { label: "工作台", panelId: "workbench" },
        { label: "扩展", panelId: "skills" },
        { label: "对话", panelId: "chat" },
      ] as const;

      for (const target of mainTabs) {
        await measureMainTab(page, target.label, target.panelId);
      }

      const samples: MotionSample[] = [];
      for (let pass = 0; pass < 5; pass += 1) {
        for (const target of mainTabs) {
          samples.push({
            label: target.label,
            milliseconds: await measureMainTab(page, target.label, target.panelId),
          });
        }
      }

      const mainMedians: Record<string, number> = {};
      for (const target of mainTabs) {
        const values = samples.filter((sample) => sample.label === target.label).map((sample) => sample.milliseconds);
        mainMedians[target.label] = median(values);
        expect(mainMedians[target.label], `${target.label} median latency`).toBeLessThan(100);
      }

      const chatMotion = await page.locator('[data-main-panel="chat"]').evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          transitionProperty: style.transitionProperty,
          transitionDuration: style.transitionDuration,
        };
      });
      expect(chatMotion.transitionProperty).toContain("opacity");
      expect(chatMotion.transitionProperty).toContain("transform");
      expect(chatMotion.transitionDuration).toContain("0.16s");

      await page.getByRole("tab", { name: "扩展" }).click();
      const inactiveChat = page.locator('[data-main-panel="chat"]');
      await expect(inactiveChat).toHaveAttribute("data-active", "false");
      await expect(inactiveChat).toHaveAttribute("aria-hidden", "true");
      await expect(inactiveChat).toHaveAttribute("inert", "");
      await expect(page.locator("#pi-global-composer-root textarea")).toHaveCount(0);

      await page.getByRole("tab", { name: "对话" }).click();
      const leftRail = page.getByLabel("primary navigation");
      await page.getByRole("button", { name: "折叠左侧栏" }).click();
      await expect(leftRail).toHaveAttribute("data-collapsed", "true");
      const leftRailMotion = await leftRail.evaluate((node) => getComputedStyle(node).transitionDuration);
      expect(leftRailMotion).toContain("0.16s");
      await page.getByRole("button", { name: "展开左侧栏" }).click();
      await expect(leftRail).toHaveAttribute("data-collapsed", "false");

      const agentModeTrigger = page.getByRole("button", { name: "选择 Agent 模式" });
      await agentModeTrigger.click();
      const popover = page.locator('[data-pi-popover-surface]').last();
      await expect(popover).toHaveAttribute("data-motion-state", "enter");
      const popoverAnimation = await popover.evaluate((node) => getComputedStyle(node).animationDuration);
      expect(popoverAnimation).toBe("0.14s");
      await page.keyboard.press("Escape");
      await expect(popover).toHaveCount(0, { timeout: 1_000 });

      await page.screenshot({ path: test.info().outputPath("motion-main.png"), fullPage: true });

      const settingsWindowPromise = app.waitForEvent("window");
      await page.getByRole("button", { name: "打开设置" }).click();
      const settingsWindow = await settingsWindowPromise;
      await settingsWindow.waitForLoadState("domcontentloaded");
      await expect(settingsWindow.getByTestId("settings-window-frame")).toHaveAttribute("data-settings-window-motion", "enter");

      const settingsTabs = [
        ["通用", "general"],
        ["模型", "model"],
        ["Pi Code Agent", "piagent"],
        ["界面", "appearance"],
        ["权限", "permissions"],
        ["用量", "usage"],
        ["长程能力", "longHorizon"],
        ["快捷键", "shortcuts"],
        ["配置文件", "config"],
        ["关于", "about"],
      ] as const;
      const settingsSamples: MotionSample[] = [];
      for (const [label, tabId] of settingsTabs) {
        settingsSamples.push({ label, milliseconds: await measureSettingsTab(settingsWindow, label, tabId) });
      }
      const settingsMedian = median(settingsSamples.map((sample) => sample.milliseconds));
      expect(settingsMedian, "settings median latency").toBeLessThan(100);

      await settingsWindow.getByRole("tab", { name: "模型" }).click();
      await settingsWindow.getByRole("button", { name: "新增模型" }).click();
      const modelDialog = settingsWindow.getByRole("dialog", { name: "模型编辑" });
      await expect(modelDialog).toHaveAttribute("data-motion-state", "enter");
      expect(await modelDialog.evaluate((node) => getComputedStyle(node).animationDuration)).toBe("0.18s");
      await modelDialog.getByRole("button", { name: "取消" }).click();
      await expect(modelDialog).toHaveCount(0, { timeout: 1_000 });

      await settingsWindow.screenshot({ path: test.info().outputPath("motion-settings.png"), fullPage: true });
      const latencyEvidence = {
        mainSamples: samples,
        mainMedians,
        settingsSamples,
        settingsMedian,
      };
      const latencyJson = JSON.stringify(latencyEvidence, null, 2);
      writeFileSync(test.info().outputPath("motion-latency.json"), latencyJson, "utf8");
      console.log(`MOTION_LATENCY ${JSON.stringify({ mainMedians, settingsMedian })}`);
      await test.info().attach("motion-latency.json", {
        body: Buffer.from(latencyJson),
        contentType: "application/json",
      });

      const settingsClosed = settingsWindow.waitForEvent("close");
      await settingsWindow.evaluate(() => {
        const closeButton = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
          .find((button) => button.getAttribute("aria-label") === "关闭窗口");
        closeButton?.click();
      });
      await settingsClosed;

      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByRole("tab", { name: "扩展" }).click();
      const reducedMotion = await page.locator('[data-main-panel="chat"]').evaluate((node) => {
        const style = getComputedStyle(node);
        return { duration: style.transitionDuration, transform: style.transform };
      });
      expect(reducedMotion.duration).toContain("0.001s");
      expect(reducedMotion.transform).toBe("none");
    } finally {
      await app?.close().catch(() => undefined);
    }
  });
});
