import { expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import type { ChildProcess } from "child_process";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { electronMainEntry } from "../../playwright.config";
import { IMPLEMENTED_CART_SOURCE, type MiniNodeProject } from "./programmer-project";
import { resolveElectronExecutablePath } from "./electron-launch";
import { getWindowByUrl, retryMainAction } from "./electron-windows";

export const TEST_TIMEOUT_MS = 120_000;
export const USER_PROMPT = "请像真实程序员一样完成一次小开发：阅读这个 Node 项目，修好购物车总价计算，并运行测试。";
export const ASSISTANT_REPLY = "已完成 src/cart.js 的购物车总价实现，并通过 npm run test 验证。";

type AppContext = {
    readonly app: ElectronApplication;
    readonly page: Page;
};

type LaunchOptions = {
    readonly userDataDir: string;
    readonly configDir: string;
    readonly selectedWorkspacePath: string;
};

type CapturedPrompt = {
    readonly agentId: string;
    readonly message: string;
    readonly mode?: string;
};

type WorkspacePickerCall = {
    readonly path: string;
};

export async function launchApp(options: LaunchOptions): Promise<AppContext> {
    await mkdir(options.configDir, { recursive: true });
    await mkdir(options.selectedWorkspacePath, { recursive: true });
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${options.userDataDir}`, electronMainEntry],
        env: {
            ...process.env,
            CI: "1",
            ELECTRON_RENDERER_URL: "",
            PI_DESKTOP_CONFIG_DIR: options.configDir,
        },
    });
    await app.firstWindow();
    const page = await getWindowByUrl(app, "index.html");
    await installStableIpcStubs(app, options.selectedWorkspacePath);
    await page.evaluate(() => {
        window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
        window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await dismissOnboarding(page);
    return { app, page };
}

export async function closeApp(app: ElectronApplication | undefined): Promise<void> {
    let process: ReturnType<ElectronApplication["process"]> | undefined;
    try {
        process = app?.process();
    } catch {
        // The Playwright handle may already be disposed after Electron exits.
    }
    try {
        await app?.close();
    } catch (error) {
        if (!(error instanceof Error)) throw error;
    } finally {
        await waitForExit(process);
    }
}

export async function openExistingProjectFromUi(
    page: Page,
    app: ElectronApplication,
    projectName: string,
    workspacePath: string,
): Promise<void> {
    await page.getByRole("button", { name: /切换工作区/ }).first().click();
    const menu = page.locator('[role="menu"]').last();
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: "使用现有文件夹" }).click();
    await expect.poll(async () => (await workspacePickerCalls(app)).length).toBe(1);
    await expect.poll(async () => {
        const workspaces = await page.evaluate(async () => window.piAPI.listWorkspaces());
        return Array.isArray(workspaces) ? workspaces.map((workspace) => workspace.path) : [];
    }, { timeout: 30_000 }).toContain(workspacePath);
    await expect(page.getByRole("button", { name: `切换工作区：${projectName}` }).first()).toBeVisible();
}

export async function sendProgrammerPrompt(page: Page, app: ElectronApplication): Promise<void> {
    await page.getByRole("button", { name: "新建对话", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "发送" });
    await expect(composer).toBeEnabled();
    await composer.fill(USER_PROMPT);
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.locator('article[aria-label^="你 ·"]').filter({ hasText: USER_PROMPT })).toBeVisible();
    await expect.poll(async () => (await capturedPrompts(app)).at(-1)?.message).toContain(USER_PROMPT);
}

export async function applyAssistantCodeChange(page: Page, app: ElectronApplication, project: MiniNodeProject): Promise<void> {
    await page.evaluate(async ({ cartSourcePath, workspacePath, source }) => {
        const result = await window.piAPI.filesWriteTextFile(cartSourcePath, source, workspacePath);
        if (result && typeof result === "object" && "code" in result) {
            throw new Error(result.fallback);
        }
    }, { cartSourcePath: project.cartSourcePath, workspacePath: project.workspacePath, source: IMPLEMENTED_CART_SOURCE });
    await emitAssistantReply(page, app, ASSISTANT_REPLY);
    await expect(page.locator('article[aria-label^="Pi ·"]').filter({ hasText: ASSISTANT_REPLY })).toBeVisible();
}

export async function expandRightRailIfNeeded(page: Page): Promise<void> {
    const expandButton = page.getByRole("button", { name: "展开右侧栏" });
    if (await expandButton.isVisible().catch((error: unknown) => {
        if (error instanceof Error) return false;
        throw error;
    })) {
        await expandButton.click();
    }
}

export async function runProjectTestInTerminal(page: Page, resultPath: string): Promise<void> {
    await page.keyboard.press("Control+Backquote");
    await expect(page.getByText("暂无终端")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "+ 新建终端" }).click();
    const terminal = page.locator(".xterm").first();
    await expect(terminal).toBeVisible({ timeout: 10_000 });
    await terminal.click();
    await page.keyboard.type("npm run test");
    await page.keyboard.press("Enter");
    await expect.poll(() => existsSync(resultPath), { timeout: 30_000 }).toBe(true);
}

async function dismissOnboarding(page: Page): Promise<void> {
    const modal = page.getByTestId("onboarding-modal");
    const visible = await modal.isVisible().catch((error: unknown) => {
        if (error instanceof Error) return false;
        throw error;
    });
    if (!visible) return;
    await page.getByRole("button", { name: "跳过引导" }).click();
    await expect(modal).toHaveCount(0);
}

async function waitForExit(process: ChildProcess | undefined, timeoutMs = 5_000): Promise<void> {
    if (!process || process.exitCode !== null || process.killed) return;
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            process.kill();
            resolve();
        }, timeoutMs);
        process.once("exit", () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

async function installStableIpcStubs(app: ElectronApplication, selectedWorkspacePath: string): Promise<void> {
    await retryMainAction(() => app.evaluate(({ ipcMain }, workspacePath) => {
        type MainGlobal = typeof globalThis & {
            __programmerWorkflowPrompts?: CapturedPrompt[];
            __programmerWorkflowPickerCalls?: WorkspacePickerCall[];
        };
        const target: MainGlobal = globalThis;
        target.__programmerWorkflowPrompts = [];
        target.__programmerWorkflowPickerCalls = [];
        for (const channel of ["pi:status", "workspace:select-directory", "agents:prompt", "packages:list-installed", "skills:installed"]) {
            ipcMain.removeHandler(channel);
        }
        ipcMain.handle("pi:status", async () => ({
            installed: true,
            localVersion: "e2e-stub",
            latestVersion: "e2e-stub",
            needsUpdate: false,
            installing: false,
        }));
        ipcMain.handle("workspace:select-directory", async () => {
            target.__programmerWorkflowPickerCalls?.push({ path: workspacePath });
            return workspacePath;
        });
        ipcMain.handle("agents:prompt", async (_event, input: CapturedPrompt) => {
            target.__programmerWorkflowPrompts?.push(input);
            return undefined;
        });
        ipcMain.handle("packages:list-installed", async () => []);
        ipcMain.handle("skills:installed", async () => []);
    }, selectedWorkspacePath));
}

async function workspacePickerCalls(app: ElectronApplication): Promise<readonly WorkspacePickerCall[]> {
    return app.evaluate(() => {
        type MainGlobal = typeof globalThis & { __programmerWorkflowPickerCalls?: WorkspacePickerCall[] };
        return (globalThis as MainGlobal).__programmerWorkflowPickerCalls ?? [];
    });
}

async function capturedPrompts(app: ElectronApplication): Promise<readonly CapturedPrompt[]> {
    return app.evaluate(() => {
        type MainGlobal = typeof globalThis & { __programmerWorkflowPrompts?: CapturedPrompt[] };
        return (globalThis as MainGlobal).__programmerWorkflowPrompts ?? [];
    });
}

async function emitAssistantReply(page: Page, app: ElectronApplication, content: string): Promise<void> {
    const prompt = (await capturedPrompts(app)).at(-1);
    if (!prompt) throw new Error("No captured prompt available for assistant reply injection");
    const agent = await page.evaluate(async (agentId) => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.id === agentId) ?? null;
    }, prompt.agentId);
    if (!agent) throw new Error("No active agent available after sending the prompt");
    await app.evaluate(({ BrowserWindow }, payload) => {
        const mainWindow = BrowserWindow.getAllWindows().find((item) => {
            try {
                return !item.isDestroyed() && item.webContents.getURL().includes("index.html");
            } catch (error) {
                if (!(error instanceof Error)) throw error;
                return false;
            }
        });
        if (!mainWindow) throw new Error("Main window not found for agent event injection");
        for (const event of [
            { type: "agent_start" },
            { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: payload.content } },
            { type: "message_end", message: { role: "assistant", content: payload.content } },
            { type: "turn_end" },
            { type: "agent_end", messages: [{ role: "assistant", content: payload.content }] },
        ]) {
            mainWindow.webContents.send("agents:event", {
                agentId: payload.agent.id,
                workspaceId: payload.agent.workspaceId,
                event,
            });
        }
    }, { agent, content });
}
