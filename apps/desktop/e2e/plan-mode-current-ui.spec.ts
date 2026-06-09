import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { electronMainEntry } from "../playwright.config";

async function skipOnboarding(page: Page): Promise<void> {
  const modal = page.locator('[data-testid="onboarding-modal"]');
  if (await modal.count() === 0) return;
  await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
  await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function installTestIpc(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const target = globalThis as typeof globalThis & {
      __currentUiPromptCalls?: Array<{ kind: "legacy"; workspaceId: string; message: string } | { kind: "agent"; input: { agentId: string; message: string } }>;
      __currentUiSelectedFiles?: unknown[];
      __currentUiStopCalls?: string[];
      __currentUiAgentAbortCalls?: string[];
    };
    target.__currentUiPromptCalls = [];
    target.__currentUiSelectedFiles = [];
    target.__currentUiStopCalls = [];
    target.__currentUiAgentAbortCalls = [];

    ipcMain.removeHandler("pi:status");
    ipcMain.handle("pi:status", async () => ({
      installed: true,
      localVersion: "e2e",
      latestVersion: "e2e",
      updateAvailable: false,
    }));

    ipcMain.removeHandler("pi:send");
    ipcMain.handle("pi:send", async (_event, workspaceId: string, message: string) => {
      target.__currentUiPromptCalls?.push({ kind: "legacy", workspaceId, message });
      return undefined;
    });

    ipcMain.removeHandler("pi:stop");
    ipcMain.handle("pi:stop", async (_event, workspaceId: string) => {
      target.__currentUiStopCalls?.push(workspaceId);
      return undefined;
    });

    ipcMain.removeHandler("agents:prompt");
    ipcMain.handle("agents:prompt", async (_event, input: { agentId: string; message: string }) => {
      target.__currentUiPromptCalls?.push({ kind: "agent", input });
      return undefined;
    });

    ipcMain.removeHandler("agents:abort");
    ipcMain.handle("agents:abort", async (_event, agentId: string) => {
      target.__currentUiAgentAbortCalls?.push(agentId);
      return undefined;
    });

    ipcMain.removeHandler("files:select");
    ipcMain.handle("files:select", async (_event, opts?: unknown) => {
      target.__currentUiSelectedFiles?.push(opts);
      return ["C:\\ai\\pi-agent-desktop\\package.json"];
    });
  });
}

async function createWorkspace(page: Page, workspacePath: string): Promise<void> {
  await page.evaluate(async ({ workspacePath }) => {
    window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
    window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
    const ws = await window.piAPI.createWorkspace("current-ui-e2e", workspacePath);
    await window.piAPI.selectWorkspace(ws.path);
  }, { workspacePath });
}

async function waitForReactClickHandler(locator: ReturnType<Page["locator"]>): Promise<void> {
  await expect.poll(async () => locator.evaluate((el) => {
    const keys = Object.keys(el as unknown as Record<string, unknown>);
    const propsKey = keys.find((key) => key.startsWith("__reactProps$") || key.startsWith("__reactEventHandlers$"));
    const props = propsKey ? (el as unknown as Record<string, { onClick?: unknown }>)[propsKey] : null;
    return typeof props?.onClick === "function";
  })).toBe(true);
}

async function openPlusMenu(page: Page): Promise<void> {
  const plus = page.locator('[data-testid="chat-input-plus-trigger"]');
  await expect(plus).toBeVisible();
  await waitForReactClickHandler(plus);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await plus.click();
    const menu = page.getByRole("menu").filter({ hasText: "添加文件或图片" });
    try {
      await expect(menu).toBeVisible({ timeout: 1_500 });
      return;
    } catch {
      // Retry: Electron can finish first paint before React handlers settle after reload.
    }
  }
  await expect(page.getByRole("menu").filter({ hasText: "添加文件或图片" })).toBeVisible();
}

test.describe("Pi Desktop — current chat UI user path", () => {
  let app: ElectronApplication;
  let page: Page;

  test.afterEach(async () => {
    try {
      await app?.close();
    } catch {
      // ignore teardown failures
    }
  });

  test("plus menu attachment + plan mode uses inline clarification, then submits one /plan prompt", async () => {
    const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const workspacePath = test.info().outputPath("workspace");
    app = await _electron.launch({
      args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
      env: { ...process.env, CI: "1" },
    });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await installTestIpc(app);
    await createWorkspace(page, workspacePath);
    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await skipOnboarding(page);

    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("button", { name: "计划模式" })).toHaveCount(0);
    await expect(page.getByText("附件", { exact: true })).toHaveCount(0);
    await expect(page.getByText("深度研究")).toHaveCount(0);
    await expect(page.getByText("Computer Use")).toHaveCount(0);
    await expect(page.getByText("Agent Team")).toHaveCount(0);

    await openPlusMenu(page);
    await expect(page.getByRole("menuitem", { name: "添加文件或图片" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "技能" })).toBeVisible();
    await expect(page.getByRole("menuitemcheckbox", { name: "计划模式" })).toBeVisible();

    await page.getByRole("menuitem", { name: "添加文件或图片" }).click();
    await expect(page.getByText("package.json", { exact: true })).toBeVisible();
    await expect.poll(async () => app.evaluate(() => {
      const target = globalThis as typeof globalThis & { __currentUiSelectedFiles?: unknown[] };
      return target.__currentUiSelectedFiles?.length ?? 0;
    })).toBe(1);

    await openPlusMenu(page);
    const planModeItem = page.getByRole("menuitemcheckbox", { name: "计划模式" });
    await planModeItem.click();
    await expect(page.getByLabel("计划模式已启用")).toBeVisible();
    await expect(page.getByRole("button", { name: "计划模式" })).toHaveCount(0);

    await textarea.focus();
    const focusStyles = await page.locator('[data-testid="chat-input-shell"]').evaluate((shell) => {
      const textarea = shell.querySelector("textarea");
      const shellStyle = getComputedStyle(shell);
      const textareaStyle = textarea ? getComputedStyle(textarea) : null;
      return {
        shellBorder: shellStyle.borderColor,
        textareaOutline: textareaStyle?.outlineStyle,
        textareaOutlineColor: textareaStyle?.outlineColor,
        toolbarBorderTop: getComputedStyle(shell.querySelector(".flex.flex-wrap.items-center.justify-between") ?? shell).borderTopColor,
      };
    });
    expect(focusStyles.textareaOutline).toBe("none");
    expect(focusStyles.shellBorder).not.toMatch(/rgb\(59,\s*130,\s*246\)|blue/i);
    expect(focusStyles.toolbarBorderTop).not.toBe("rgb(0, 0, 0)");

    await textarea.fill("了解一下这个项目");
    await textarea.press("Enter");
    await expect(page.getByRole("article", { name: /你说/ })).toContainText("了解一下这个项目", { timeout: 10_000 });
    await expect(page.getByText("计划模式需要目标")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("PLAN QUESTION")).toHaveCount(0);
    await expect(page.locator("section textarea")).toHaveCount(0);
    await expect(page.getByText("从此消息继续")).toHaveCount(0);
    await expect(page.getByText("继续", { exact: true })).toHaveCount(0);
    await expect.poll(async () => app.evaluate(() => {
      const target = globalThis as typeof globalThis & { __currentUiPromptCalls?: unknown[] };
      return target.__currentUiPromptCalls?.length ?? 0;
    })).toBe(0);

    await textarea.fill("请为聊天输入区的计划模式交互制定实现计划，包含 UI 状态和验证步骤");
    await textarea.press("Enter");

    await expect.poll(async () => app.evaluate(() => {
      const target = globalThis as typeof globalThis & { __currentUiPromptCalls?: unknown[] };
      return target.__currentUiPromptCalls?.length ?? 0;
    })).toBe(1);
    const calls = await app.evaluate(() => {
      const target = globalThis as typeof globalThis & {
        __currentUiPromptCalls?: Array<{ kind: "legacy"; workspaceId: string; message: string } | { kind: "agent"; input: { agentId: string; message: string } }>;
      };
      return target.__currentUiPromptCalls ?? [];
    });
    const sentMessage = calls[0].kind === "agent" ? calls[0].input.message : calls[0].message;
    expect(sentMessage).toMatch(/^\/plan\n/);
    expect(sentMessage.match(/^\/plan/gm) ?? []).toHaveLength(1);
    expect(sentMessage).toContain("原始请求:");
    expect(sentMessage).toContain("了解一下这个项目");
    expect(sentMessage).toContain("补充目标:");
    expect(sentMessage).toContain("聊天输入区的计划模式交互");

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("plan:card", {
        id: "inline-plan-card",
        title: "聊天输入区计划",
        filename: "chat-input-plan.md",
        content: "- 检查计划模式入口\n- 改成聊天内流程",
        createdAt: Date.now(),
      });
    });
    await expect(page.getByRole("article", { name: /Pi 说/ }).filter({ hasText: "聊天内流程" })).toBeVisible();
    await expect(page.getByRole("button", { name: "执行计划" })).toBeVisible();
    await page.getByRole("button", { name: "执行计划" }).click();
    await expect.poll(async () => app.evaluate(() => {
      const target = globalThis as typeof globalThis & { __currentUiPromptCalls?: unknown[] };
      return target.__currentUiPromptCalls?.length ?? 0;
    })).toBe(2);
    await expect(page.getByText("执行计划：chat-input-plan.md")).toBeVisible();
    await expect(page.getByText(/\/execute_plan/)).toHaveCount(0);
    const planArticle = page.getByRole("article", { name: /Pi 说/ }).filter({ hasText: "聊天内流程" });
    await expect(planArticle.getByText("执行中")).toBeVisible();
    await expect(planArticle.getByRole("button", { name: "暂停执行" })).toBeVisible();
    await planArticle.getByRole("button", { name: "暂停执行" }).click();
    await expect.poll(async () => app.evaluate(() => {
      const target = globalThis as typeof globalThis & {
        __currentUiAgentAbortCalls?: unknown[];
        __currentUiStopCalls?: unknown[];
      };
      return (target.__currentUiAgentAbortCalls?.length ?? 0) + (target.__currentUiStopCalls?.length ?? 0);
    })).toBe(1);
    await expect(planArticle.getByText("已暂停")).toBeVisible();
    await expect(planArticle.getByRole("button", { name: "继续执行" })).toBeVisible();
  });

  test("adjacent assistant thinking is rendered as one merged block with correct count", async () => {
    const userDataDir = test.info().outputPath(`user-data-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const workspacePath = test.info().outputPath("thinking-workspace");
    app = await _electron.launch({
      args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
      env: { ...process.env, CI: "1" },
    });
    page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await installTestIpc(app);
    await page.evaluate(async ({ workspacePath }) => {
      window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
      window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
      const ws = await window.piAPI.createWorkspace("thinking-e2e", workspacePath);
      const session = await window.piAPI.createSession(ws.id, "thinking merge e2e", "thinking-merge-e2e");
      await window.piAPI.appendMessage(session.id, {
        id: "user-thinking-seed",
        role: "user",
        content: "验证思考合并",
        timestamp: new Date(Date.now() - 3_000).toISOString(),
      });
      await window.piAPI.appendMessage(session.id, {
        id: "assistant-thinking-1",
        role: "assistant",
        content: "",
        thinking: "第一轮思考",
        timestamp: new Date(Date.now() - 2_000).toISOString(),
      });
      await window.piAPI.appendMessage(session.id, {
        id: "assistant-thinking-2",
        role: "assistant",
        content: "",
        thinking: "第二轮思考",
        timestamp: new Date(Date.now() - 1_000).toISOString(),
      });
    }, { workspacePath });

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await skipOnboarding(page);

    await expect(page.getByRole("article", { name: /你说/ })).toContainText("验证思考合并", { timeout: 15_000 });
    await expect(page.getByRole("article", { name: /Pi 说/ })).toHaveCount(1);
    await expect(page.getByText(/思考 2 次 · \d+ 字符/)).toBeVisible();
    await expect(page.locator("article").filter({ hasText: "第一轮思考" })).toHaveCount(0);
    await expect(page.locator("article").filter({ hasText: "第二轮思考" })).toHaveCount(0);
    await expect(page.getByText("从此消息继续")).toHaveCount(0);
  });
});
