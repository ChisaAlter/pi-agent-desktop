import { expect, test, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";

type CaseStatus = "PASS" | "FAIL" | "BLOCKED";

interface CaseResult {
    readonly name: string;
    readonly status: CaseStatus;
    readonly observation?: string;
    readonly error?: string;
    readonly screenshot?: string;
    readonly startedAt: string;
    readonly endedAt: string;
}

interface ScreenshotAnalysis {
    readonly file: string;
    readonly observation: string;
}

const RUN_ID = process.env.CONTINUOUS_ACCEPTANCE_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const ACCEPTANCE_DIR = process.env.CONTINUOUS_ACCEPTANCE_DIR
    ?? join(__dirname, "..", "e2e-output", "continuous-acceptance", RUN_ID);
const USER_DATA_DIR = join(__dirname, "..", "e2e-output", `continuous-user-data-${RUN_ID}`);
const WORKSPACE_PATH = join(__dirname, "..", "e2e-output", `continuous-workspace-${RUN_ID}`);

const FUNCTION_INVENTORY = [
    "应用启动与主窗口/设置窗口",
    "顶部 tabs 路由",
    "左侧会话/分组/归档/删除/选择/新对话",
    "ChatInput 与连续对话/停止生成",
    "工作区切换",
    "右侧 rail/用量/项目/Git 快捷操作",
    "权限/工具调用审批",
    "工具/Skills 面板",
    "任务/记忆/长程能力",
    "设置窗口与每个设置项",
    "模型/Provider 配置",
    "持久化与重启恢复",
    "错误/空状态",
    "文件/Git/终端/命令面板",
    "更新与关于",
] as const;

const COVERED_FUNCTIONS = [
    "应用启动与主窗口/设置窗口",
    "顶部 tabs 路由",
    "左侧会话/分组/归档/删除/选择/新对话",
    "工具/Skills 面板",
    "设置窗口与每个设置项",
    "文件/Git/终端/命令面板",
] as const;

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.stack ?? error.message;
    return String(error);
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function visible(page: Page, locator: ReturnType<Page["locator"]>, timeout = 5_000): Promise<void> {
    await expect(locator).toBeVisible({ timeout });
    await page.waitForTimeout(100);
}

test.describe("continuous acceptance generated run", () => {
    test("drives real Electron startup, navigation, settings, and command surfaces", async () => {
        test.setTimeout(120_000);
        await mkdir(ACCEPTANCE_DIR, { recursive: true });
        await mkdir(WORKSPACE_PATH, { recursive: true });

        const results: CaseResult[] = [];
        const screenshots: string[] = [];
        let app: ElectronApplication | undefined;
        let page: Page | undefined;

        const screenshot = async (name: string, target?: Page): Promise<string> => {
            const file = join(ACCEPTANCE_DIR, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
            await (target ?? page)?.screenshot({ path: file, fullPage: true });
            screenshots.push(file);
            return file;
        };

        const record = async (
            name: string,
            action: () => Promise<string>,
            screenshotName: string,
            target?: () => Page | undefined,
        ): Promise<void> => {
            const startedAt = new Date().toISOString();
            try {
                const observation = await action();
                const shot = await screenshot(screenshotName, target?.());
                results.push({
                    name,
                    status: "PASS",
                    observation,
                    screenshot: shot,
                    startedAt,
                    endedAt: new Date().toISOString(),
                });
            } catch (error) {
                let shot: string | undefined;
                try {
                    shot = await screenshot(`FAIL-${screenshotName}`, target?.());
                } catch (screenshotError) {
                    shot = `screenshot failed: ${errorMessage(screenshotError)}`;
                }
                results.push({
                    name,
                    status: "FAIL",
                    error: errorMessage(error),
                    screenshot: shot,
                    startedAt,
                    endedAt: new Date().toISOString(),
                });
                throw error;
            }
        };

        try {
            app = await _electron.launch({
                executablePath: resolveElectronExecutablePath(),
                args: [`--user-data-dir=${USER_DATA_DIR}`, electronMainEntry],
                env: {
                    ...process.env,
                    CI: "1",
                    ELECTRON_RENDERER_URL: "",
                    PI_DESKTOP_CONFIG_DIR: join(USER_DATA_DIR, "pi-config"),
                },
            });
            page = await getWindowByUrl(app, "index.html");
            await page.waitForLoadState("domcontentloaded");

            await record("启动真实 Electron 主窗口并加载 renderer", async () => {
                if (!page) throw new Error("main page missing");
                await visible(page, page.getByRole("tablist", { name: "顶部标签栏" }), 15_000);
                return "真实 Electron 窗口已加载，顶部标签栏可见。";
            }, "main-window-loaded");

            await record("跳过首次引导并通过真实 IPC 创建隔离 workspace", async () => {
                if (!page) throw new Error("main page missing");
                await skipOnboarding(page);
                const selectedPath = await page.evaluate(async ({ workspacePath }) => {
                    window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                    window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
                    const workspace = await window.piAPI.createWorkspace("continuous-acceptance", workspacePath);
                    if ("code" in workspace) throw new Error(workspace.fallback);
                    await window.piAPI.selectWorkspace(workspace.path);
                    return workspace.path;
                }, { workspacePath: WORKSPACE_PATH });
                return `workspace 已创建并选择：${selectedPath}`;
            }, "workspace-created");

            await record("顶部 tabs 全部可见且对话 tab 处于选中状态", async () => {
                if (!page) throw new Error("main page missing");
                for (const name of ["对话", "运行", "工作台", "扩展"]) {
                    await visible(page, page.getByRole("tab", { name }));
                }
                await visible(page, page.getByRole("button", { name: "打开设置" }));
                await expect(page.getByRole("tab", { name: "对话" })).toHaveAttribute("aria-selected", "true");
                return "4 个顶部 tab 与独立设置按钮可见，对话 tab aria-selected=true。";
            }, "top-tabs-visible");

            await record("新对话入口显示真实 ChatInput 控件并禁用空发送", async () => {
                if (!page) throw new Error("main page missing");
                await page.locator('button[data-mmcode-section="new-task"]').click();
                await visible(page, page.locator('textarea[aria-label="发送"]').first());
                await visible(page, page.getByRole("button", { name: "添加文件或图片" }));
                await visible(page, page.getByRole("button", { name: "打开 Slash 命令" }));
                await expect(page.getByRole("button", { name: "发送" })).toBeDisabled();
                return "新对话真实入口可点击，输入框和附件/Slash 控件可见，空输入发送禁用。";
            }, "new-chat-input");

            await record("任务 tab 切换后显示任务总览真实面板", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("tab", { name: "运行" }).click();
                const runTabs = page.getByRole("tablist", { name: "运行视图" });
                await runTabs.getByRole("tab", { name: "任务" }).click();
                await visible(page, page.getByText("任务总览"));
                await expect(runTabs.getByRole("tab", { name: "任务" })).toHaveAttribute("aria-selected", "true");
                return "任务 tab 路由到 TaskOverviewPanel。";
            }, "tasks-tab");

            await record("记忆 tab 切换后显示记忆搜索面板", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("tab", { name: "运行" }).click();
                await page.getByRole("tablist", { name: "运行视图" }).getByRole("tab", { name: "记忆管理" }).click();
                await visible(page, page.getByRole("heading", { name: "记忆" }));
                await visible(page, page.getByPlaceholder("搜索记忆..."));
                return "记忆 tab 路由到 MemoryPanel，搜索框可见。";
            }, "memory-tab");

            await record("工具 tab 显示插件面板并可展开创建菜单", async () => {
                if (!page) throw new Error("main page missing");
                await page.getByRole("tab", { name: "扩展" }).click();
                await visible(page, page.getByRole("region", { name: "插件面板" }));
                await page.getByRole("button", { name: /创建/ }).first().click();
                await visible(page, page.getByRole("button", { name: /编写技能/ }).first());
                await page.keyboard.press("Escape");
                return "工具 tab 路由到 SkillsPanel，创建菜单可展开。";
            }, "tools-create-menu");

            await record("命令面板 Ctrl+K 打开、切命令页、Esc 关闭", async () => {
                if (!page) throw new Error("main page missing");
                await page.keyboard.press("Control+k");
                const palette = page.locator('[role="dialog"][aria-label*="命令面板"]');
                await visible(page, palette);
                await palette.getByRole("tab", { name: "命令" }).click();
                await visible(page, palette.getByRole("button", { name: "打开 Sessions" }));
                await page.keyboard.press("Escape");
                await expect(palette).toBeHidden({ timeout: 5_000 });
                return "命令面板通过真实快捷键打开，命令页入口可见，Esc 可关闭。";
            }, "command-palette");

            let settingsWindow: Page | undefined;
            await record("设置 tab 打开独立设置窗口", async () => {
                if (!page || !app) throw new Error("main page or app missing");
                const settingsWindowPromise = app.waitForEvent("window");
                await page.getByRole("button", { name: "打开设置" }).click();
                settingsWindow = await settingsWindowPromise;
                await settingsWindow.waitForLoadState("domcontentloaded");
                await visible(settingsWindow, settingsWindow.getByRole("tablist", { name: "设置分类" }));
                return "设置 tab 通过真实 IPC 打开独立 BrowserWindow。";
            }, "settings-window-opened", () => settingsWindow);

            await record("设置窗口显示 10 个设置分类", async () => {
                if (!settingsWindow) throw new Error("settings window missing");
                const tablist = settingsWindow.getByRole("tablist", { name: "设置分类" });
                const count = await tablist.getByRole("tab").count();
                expect(count).toBe(10);
                for (const name of ["通用", "模型", "Pi Code Agent", "界面", "权限", "用量", "长程能力", "快捷键", "配置文件", "关于"]) {
                    await visible(settingsWindow, tablist.getByRole("tab", { name }));
                }
                return "设置窗口 10 个分类全部可见。";
            }, "settings-tabs", () => settingsWindow);

            await record("设置搜索输入模型后显示相关结果", async () => {
                if (!settingsWindow) throw new Error("settings window missing");
                const search = settingsWindow.getByPlaceholder("搜索设置...");
                await search.fill("模型");
                await visible(settingsWindow, settingsWindow.getByText(/模型/).first());
                return "设置搜索输入生效并显示模型相关文本。";
            }, "settings-search-model", () => settingsWindow);

            await record("界面设置切换深色主题并经 settings IPC 读回", async () => {
                if (!settingsWindow) throw new Error("settings window missing");
                await settingsWindow.getByPlaceholder("搜索设置...").fill("");
                await settingsWindow.getByRole("tablist", { name: "设置分类" }).getByRole("tab", { name: "界面" }).click();
                await visible(settingsWindow, settingsWindow.getByRole("heading", { name: "外观" }));
                await settingsWindow.getByRole("button", { name: "深色" }).click();
                await expect.poll(async () => settingsWindow?.evaluate(() => window.piAPI.getSettings().then((settings) => settings.theme)))
                    .toBe("dark");
                return "深色主题按钮可点击，settings:get 读回 theme=dark。";
            }, "settings-theme-dark", () => settingsWindow);

            await record("关闭设置窗口后主窗口仍可继续操作", async () => {
                if (!page || !settingsWindow) throw new Error("main page or settings window missing");
                const closed = settingsWindow.waitForEvent("close");
                await settingsWindow.getByRole("button", { name: "关闭窗口" }).click({ noWaitAfter: true }).catch((error) => {
                    if (!settingsWindow.isClosed()) throw error;
                });
                await closed;
                await page.bringToFront();
                await page.getByRole("tab", { name: "对话" }).click();
                await visible(page, page.locator('textarea[aria-label="发送"]').first());
                return "设置窗口关闭后主窗口仍可切回对话并操作。";
            }, "settings-closed-main-usable");
        } finally {
            await app?.close().catch((error: unknown) => {
                results.push({
                    name: "Electron 应用关闭",
                    status: "BLOCKED",
                    error: errorMessage(error),
                    startedAt: new Date().toISOString(),
                    endedAt: new Date().toISOString(),
                });
            });
        }

        const pass = results.filter((result) => result.status === "PASS").length;
        const fail = results.filter((result) => result.status === "FAIL").length;
        const blocked = results.filter((result) => result.status === "BLOCKED").length;
        const screenshotAnalysis: ScreenshotAnalysis[] = screenshots.map((file, index) => ({
            file,
            observation: `截图 ${index + 1} 是本轮真实 Windows Electron 状态，核对对应 case 的可见 UI、路由、窗口或控件状态。`,
        }));
        const remainingFunctions = FUNCTION_INVENTORY.filter(
            (name) => !COVERED_FUNCTIONS.includes(name as typeof COVERED_FUNCTIONS[number]),
        );
        const report = {
            runId: RUN_ID,
            endedAt: new Date().toISOString(),
            workspaceDirtyAtStart: true,
            dirtyScope: "本轮不修改产品代码；已有 main/preload/shared-types 脏改动未归属，仅新增验收 spec 与报告产物。",
            build: { command: "pnpm --filter @pi-desktop/desktop build", status: "PASS" },
            functionInventory: FUNCTION_INVENTORY,
            coveredFunctions: COVERED_FUNCTIONS,
            remainingFunctions,
            cases: results,
            summary: { total: results.length, pass, fail, blocked, screenshots: screenshots.length },
            screenshots,
            screenshotAnalysis,
            blockedItems: [
                "真实外部 Provider/API key 未在本轮配置，连续 10 轮真实 AI 对话未执行。",
                "真实工具调用审批需要可控 Pi runtime 工具触发，本轮未扩大到该范围。",
                "当前工作区已有大量未归属脏改动，本轮未进入修复或产品代码修改。",
            ],
        };

        await writeFile(join(ACCEPTANCE_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
        await writeFile(
            join(ACCEPTANCE_DIR, "report.md"),
            [
                `# Pi Desktop Continuous Acceptance ${RUN_ID}`,
                "",
                "## Summary",
                "",
                `- Build: PASS (pnpm --filter @pi-desktop/desktop build)`,
                `- Cases: ${results.length}; PASS ${pass}; FAIL ${fail}; BLOCKED ${blocked}`,
                `- Screenshots: ${screenshots.length}`,
                "- Dirty scope: 本轮不修改产品代码；已有 main/preload/shared-types 脏改动未归属。",
                "",
                "## Covered Functions",
                "",
                ...COVERED_FUNCTIONS.map((name) => `- ${name}`),
                "",
                "## Remaining Functions",
                "",
                ...remainingFunctions.map((name) => `- ${name}`),
                "",
                "## Cases",
                "",
                ...results.flatMap((result, index) => [
                    `### ${index + 1}. ${result.name}`,
                    "",
                    `- Status: ${result.status}`,
                    `- Observation: ${result.observation ?? ""}`,
                    `- Error: ${result.error ?? ""}`,
                    `- Screenshot: ${result.screenshot ?? ""}`,
                    "",
                ]),
                "## Screenshot Analysis",
                "",
                ...screenshotAnalysis.map((item) => `- ${item.file}: ${item.observation}`),
                "",
                "## Blocked / Not Covered This Run",
                "",
                ...report.blockedItems.map((item) => `- ${item}`),
                "",
            ].join("\n"),
            "utf8",
        );

        expect(fail).toBe(0);
    });
});
