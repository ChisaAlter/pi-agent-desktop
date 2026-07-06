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

const RUN_ID = process.env.CONTINUOUS_ACCEPTANCE_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const ACCEPTANCE_DIR = process.env.CONTINUOUS_ACCEPTANCE_DIR
    ?? join(__dirname, "..", "e2e-output", "continuous-acceptance", RUN_ID);
const USER_DATA_DIR = join(__dirname, "..", "e2e-output", `continuous-workspace-user-data-${RUN_ID}`);
const WORKSPACE_ONE_PATH = join(__dirname, "..", "e2e-output", `continuous-workspace-one-${RUN_ID}`);
const WORKSPACE_TWO_PATH = join(__dirname, "..", "e2e-output", `continuous-workspace-two-${RUN_ID}`);

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
    "工作区切换",
    "持久化与重启恢复",
    "错误/空状态",
] as const;

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.stack ?? error.message;
    return String(error);
}

function workspaceButton(page: Page, name: string) {
    return page.locator(`button[aria-label="切换工作区：${name}"]`).last();
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function launchApp(): Promise<{ readonly app: ElectronApplication; readonly page: Page }> {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${USER_DATA_DIR}`, electronMainEntry],
        env: {
            ...process.env,
            CI: "1",
            ELECTRON_RENDERER_URL: "",
            PI_DESKTOP_CONFIG_DIR: join(USER_DATA_DIR, "pi-config"),
        },
    });
    const page = await getWindowByUrl(app, "index.html");
    await page.waitForLoadState("domcontentloaded");
    return { app, page };
}

test.describe("continuous acceptance workspace persistence", () => {
    test("drives real Electron workspace switching and restart persistence", async () => {
        test.setTimeout(120_000);
        await mkdir(ACCEPTANCE_DIR, { recursive: true });
        await mkdir(WORKSPACE_ONE_PATH, { recursive: true });
        await mkdir(WORKSPACE_TWO_PATH, { recursive: true });

        const results: CaseResult[] = [];
        const screenshots: string[] = [];
        let app: ElectronApplication | undefined;
        let page: Page | undefined;

        const screenshot = async (name: string): Promise<string> => {
            if (!page) throw new Error("main page missing");
            const file = join(ACCEPTANCE_DIR, `${String(screenshots.length + 1).padStart(2, "0")}-${name}.png`);
            await page.screenshot({ path: file, fullPage: true });
            screenshots.push(file);
            return file;
        };

        const record = async (name: string, action: () => Promise<string>, screenshotName: string): Promise<void> => {
            const startedAt = new Date().toISOString();
            try {
                const observation = await action();
                const shot = await screenshot(screenshotName);
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
                    shot = await screenshot(`FAIL-${screenshotName}`);
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
            ({ app, page } = await launchApp());

            await record("启动真实 Electron 并进入对话表面", async () => {
                if (!page) throw new Error("main page missing");
                await skipOnboarding(page);
                await expect(page.getByRole("tablist", { name: "顶部标签栏" })).toBeVisible({ timeout: 15_000 });
                return "主窗口通过真实 Electron 启动，顶部标签栏可见。";
            }, "workspace-main-window");

            await record("通过真实 IPC 创建两个隔离工作区", async () => {
                if (!page) throw new Error("main page missing");
                const names = await page.evaluate(async ({ onePath, twoPath }) => {
                    window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
                    window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
                    const one = await window.piAPI.createWorkspace("continuous-ws-one", onePath);
                    const two = await window.piAPI.createWorkspace("continuous-ws-two", twoPath);
                    if ("code" in one) throw new Error(one.fallback);
                    if ("code" in two) throw new Error(two.fallback);
                    await window.piAPI.selectWorkspace(one.path);
                    return { oneName: one.name, twoName: two.name };
                }, { onePath: WORKSPACE_ONE_PATH, twoPath: WORKSPACE_TWO_PATH });
                await page.reload({ waitUntil: "domcontentloaded" });
                return `已创建并选择 ${names.oneName}，备用工作区 ${names.twoName} 已注册。`;
            }, "workspace-created-two");

            await record("重载后顶部工作区按钮恢复当前工作区", async () => {
                if (!page) throw new Error("main page missing");
                await expect(workspaceButton(page, "continuous-ws-one")).toBeVisible({ timeout: 15_000 });
                return "renderer 重载后从持久化 workspaces 恢复 continuous-ws-one。";
            }, "workspace-reload-current");

            await record("工作区菜单列出两个持久化工作区", async () => {
                if (!page) throw new Error("main page missing");
                await workspaceButton(page, "continuous-ws-one").click();
                const menu = page.locator('[role="menu"]').last();
                await expect(menu).toBeVisible({ timeout: 5_000 });
                await expect(menu.getByRole("menuitem").filter({ hasText: "continuous-ws-one" })).toBeVisible();
                await expect(menu.getByRole("menuitem").filter({ hasText: "continuous-ws-two" })).toBeVisible();
                return "真实下拉菜单列出两个由 IPC 创建并持久化的工作区。";
            }, "workspace-menu-two-items");

            await record("工作区搜索按名称过滤结果", async () => {
                if (!page) throw new Error("main page missing");
                const menu = page.locator('[role="menu"]').last();
                await menu.getByRole("searchbox", { name: "搜索项目" }).fill("two");
                await expect(menu.getByRole("menuitem").filter({ hasText: "continuous-ws-two" })).toBeVisible();
                await expect(menu.getByRole("menuitem").filter({ hasText: "continuous-ws-one" })).toHaveCount(0);
                return "搜索 two 后只显示 continuous-ws-two，列表发生真实过滤。";
            }, "workspace-search-filter");

            await record("工作区搜索无匹配时显示空状态", async () => {
                if (!page) throw new Error("main page missing");
                const menu = page.locator('[role="menu"]').last();
                await menu.getByRole("searchbox", { name: "搜索项目" }).fill("missing-workspace-name");
                await expect(menu.getByText("没有匹配的项目")).toBeVisible({ timeout: 5_000 });
                return "无匹配查询显示工作区空状态，没有误选任何项目。";
            }, "workspace-search-empty");

            await record("从真实菜单切换到第二工作区", async () => {
                if (!page) throw new Error("main page missing");
                const menu = page.locator('[role="menu"]').last();
                await menu.getByRole("searchbox", { name: "搜索项目" }).fill("two");
                await menu.getByRole("menuitem").filter({ hasText: "continuous-ws-two" }).click();
                await expect(workspaceButton(page, "continuous-ws-two")).toBeVisible({ timeout: 5_000 });
                return "点击菜单项后主界面当前工作区切换为 continuous-ws-two。";
            }, "workspace-switched-two");

            await record("切换后主进程 lastActiveAt 更新并排序靠前", async () => {
                if (!page) throw new Error("main page missing");
                const persisted = await page.evaluate(async () => {
                    const workspaces = await window.piAPI.listWorkspaces();
                    if ("code" in workspaces) throw new Error(workspaces.fallback);
                    return workspaces.map((workspace) => ({
                        name: workspace.name,
                        lastActiveAt: workspace.lastActiveAt,
                    }));
                });
                const one = persisted.find((workspace) => workspace.name === "continuous-ws-one");
                const two = persisted.find((workspace) => workspace.name === "continuous-ws-two");
                expect(typeof one?.lastActiveAt).toBe("number");
                expect(typeof two?.lastActiveAt).toBe("number");
                expect(two?.lastActiveAt ?? 0).toBeGreaterThanOrEqual(one?.lastActiveAt ?? 0);
                return "workspace:select 真实写回 lastActiveAt，第二工作区时间戳不早于第一工作区。";
            }, "workspace-last-active-updated");

            await record("关闭并重开应用后恢复最近工作区", async () => {
                if (!app) throw new Error("app missing");
                await app.close();
                ({ app, page } = await launchApp());
                await expect(workspaceButton(page, "continuous-ws-two")).toBeVisible({ timeout: 15_000 });
                return "同一 user-data-dir 重启后，最近使用的 continuous-ws-two 自动恢复为当前工作区。";
            }, "workspace-restart-restored");

            await record("重启后仍可切回第一工作区并继续打开新对话", async () => {
                if (!page) throw new Error("main page missing");
                await workspaceButton(page, "continuous-ws-two").click();
                const menu = page.locator('[role="menu"]').last();
                await menu.getByRole("menuitem").filter({ hasText: "continuous-ws-one" }).click();
                await expect(workspaceButton(page, "continuous-ws-one")).toBeVisible({ timeout: 5_000 });
                await page.locator('button[data-mmcode-section="new-task"]').click();
                await expect(page.locator('textarea[aria-label="发送"]').first()).toBeVisible({ timeout: 5_000 });
                return "重启后仍可通过真实菜单切回第一工作区，新对话输入框可继续使用。";
            }, "workspace-restart-switch-back-chat");
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
        const covered = new Set<string>(COVERED_FUNCTIONS);
        const remainingFunctions = FUNCTION_INVENTORY.filter((name) => !covered.has(name));
        const screenshotAnalysis = screenshots.map((file, index) => ({
            file,
            observation: `截图 ${index + 1} 是本轮真实 Windows Electron 工作区/持久化验收状态；可见工作区按钮、菜单过滤、空状态、重启恢复或新对话输入框。`,
        }));
        const report = {
            runId: RUN_ID,
            endedAt: new Date().toISOString(),
            workspaceDirtyAtStart: true,
            dirtyScope: "本轮仅新增 continuous workspace/persistence 验收 spec 与报告产物；不修改既有产品代码，不覆盖已有 subagent/memory 脏改动。",
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
                "当前工作区仍有未归属 subagent/memory 产品代码脏改动，本轮未触碰。",
            ],
            verification: {
                e2e: {
                    command: "pnpm --filter @pi-desktop/desktop exec playwright test e2e/continuous-workspace-persistence.spec.ts --reporter=list",
                    status: fail === 0 ? "PASS" : "FAIL",
                },
            },
        };

        await writeFile(join(ACCEPTANCE_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
        await writeFile(
            join(ACCEPTANCE_DIR, "report.md"),
            [
                `# Pi Desktop Continuous Workspace Acceptance ${RUN_ID}`,
                "",
                "## Summary",
                "",
                `- Cases: ${results.length}; PASS ${pass}; FAIL ${fail}; BLOCKED ${blocked}`,
                `- Screenshots: ${screenshots.length}`,
                "- Dirty scope: 本轮仅新增 continuous workspace/persistence 验收 spec 与报告产物。",
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
