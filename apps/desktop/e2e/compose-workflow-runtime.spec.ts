import { test, expect, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { execFileSync } from "child_process";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl, hideSettingsWindow, showSettingsWindow } from "./support/electron-windows";

const ACCEPTANCE_DIR = join(__dirname, "..", "..", "..", "docs", "compose", "acceptance");
const SESSION_ID = "compose-runtime-e2e-session";
const SESSION_TITLE = "Compose Runtime 验收";
const FALLBACK_SESSION_ID = "compose-runtime-fallback-session";
const FALLBACK_SESSION_TITLE = "Compose Runtime 关闭后回退验收";
const REVIEW_BLOCKED_ERROR = "Review blocked merge: critical findings present";

type RuntimeGlobals = typeof globalThis & {
    __PI_DESKTOP_TEST_AGENT_REGISTRY__?: {
        list: () => Array<{ id: string; sessionId?: string; workspaceId: string }>;
        getWorkspaceSession: (agentId: string) => {
            session: {
                getToolDefinition: (name: string) => {
                    execute: (
                        toolCallId: string,
                        params: Record<string, unknown>,
                        signal: AbortSignal | undefined,
                        onUpdate: ((payload: unknown) => void) | undefined,
                        ctx: unknown,
                    ) => Promise<unknown>;
                } | undefined;
                extensionRunner: {
                    createContext: () => unknown;
                };
            };
        };
    };
    __composeWorkflowRuntime__?: {
        running: boolean;
        updates: string[];
        result?: {
            isError?: boolean;
            content?: Array<{ type?: string; text?: string }>;
            details?: {
                run?: {
                    status?: string;
                    error?: string;
                };
            };
        };
        error?: string | null;
    };
};

function git(args: string[], cwd: string): string {
    return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    }).trim();
}

function seedComposeWorkspace(workspacePath: string): void {
    mkdirSync(workspacePath, { recursive: true });
    writeFileSync(join(workspacePath, "README.md"), "# compose runtime e2e\n", "utf8");
    writeFileSync(join(workspacePath, "package.json"), JSON.stringify({
        name: "compose-runtime-e2e",
        version: "0.0.0",
        private: true,
    }, null, 2), "utf8");
    git(["init"], workspacePath);
    git(["config", "user.name", "Pi Desktop E2E"], workspacePath);
    git(["config", "user.email", "pi-desktop-e2e@example.com"], workspacePath);
    git(["add", "."], workspacePath);
    git(["commit", "-m", "chore: seed compose runtime e2e"], workspacePath);
}

function installFakePi(fakePiDir: string): void {
    mkdirSync(fakePiDir, { recursive: true });
    writeFileSync(join(fakePiDir, "pi.cmd"), "@echo off\r\nnode \"%~dp0fake-pi.js\" %*\r\n", "utf8");
    writeFileSync(join(fakePiDir, "fake-pi.js"), `
const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    process.stdin.resume();
  });
}

async function main() {
  const stdin = await readStdin();
  const prompt = stdin.trim() || (process.argv[process.argv.length - 1] ?? "");
  const cwd = process.cwd();
  await sleep(180);

  if (prompt.includes("Brainstorm phase")) {
    console.log("## Context\\n- Git repo\\n- Compose runtime acceptance workspace\\n\\n## Constraints\\n- Keep changes isolated and verifiable\\n\\n## Risks\\n- Workflow feature gating must be honest\\n\\n## Proposed Approach\\n- Use two isolated implementation tasks and verify their artifacts.");
    return;
  }

  if (prompt.includes("Design phase")) {
    const tasks = [
      {
        id: "task-1",
        description: "Create compose_probe_one.txt with WORKTREE_ONE_OK.",
        acceptance: "compose_probe_one.txt exists and contains WORKTREE_ONE_OK.",
        dependsOn: [],
        files: ["compose_probe_one.txt"]
      },
      {
        id: "task-2",
        description: "Create compose_probe_two.txt with WORKTREE_TWO_OK.",
        acceptance: "compose_probe_two.txt exists and contains WORKTREE_TWO_OK.",
        dependsOn: [],
        files: ["compose_probe_two.txt"]
      }
    ];
    console.log([
      "===SPEC===",
      "# Compose Runtime E2E Spec",
      "",
      "Create two compose probe files through workflow-driven worktree execution.",
      "===PLAN===",
      "# Compose Runtime E2E Plan",
      "",
      "1. task-1: create compose_probe_one.txt",
      "2. task-2: create compose_probe_two.txt",
      "",
      "## Verification",
      "- Confirm both files exist.",
      "===TASKS===",
      JSON.stringify(tasks)
    ].join("\\n"));
    return;
  }

  if (prompt.includes("Implement phase")) {
    const taskIdMatch = prompt.match(/Task ID:\\s*([^\\n]+)/);
    const taskId = taskIdMatch ? taskIdMatch[1].trim() : "unknown";
    if (taskId === "task-1") {
      fs.writeFileSync(path.join(cwd, "compose_probe_one.txt"), "WORKTREE_ONE_OK\\n", "utf8");
      console.log("- created compose_probe_one.txt");
      return;
    }
    if (taskId === "task-2") {
      fs.writeFileSync(path.join(cwd, "compose_probe_two.txt"), "WORKTREE_TWO_OK\\n", "utf8");
      console.log("- created compose_probe_two.txt");
      return;
    }
    console.log("- no-op implement");
    return;
  }

  if (prompt.includes("Verify phase")) {
    const one = fs.existsSync(path.join(cwd, "compose_probe_one.txt"));
    const two = fs.existsSync(path.join(cwd, "compose_probe_two.txt"));
    if (!one || !two) {
      console.error("Result: fail\\nCommands: fake verify\\nFailures: missing compose probe files");
      process.exit(1);
    }
    console.log("Result: ok\\nCommands: fake verify\\nFailures: none");
    return;
  }

  if (prompt.includes("Review phase")) {
    console.log("READY: yes\\nCRITICAL: none\\nIMPORTANT: none");
    return;
  }

  console.log("ok");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
`, "utf8");
}

async function ensureAcceptanceDir(): Promise<void> {
    mkdirSync(ACCEPTANCE_DIR, { recursive: true });
}

async function launchApp(userDataDir: string, fakePiDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const pathEnv = [fakePiDir, process.env.PATH ?? ""].filter(Boolean).join(";");
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: {
            ...process.env,
            PATH: pathEnv,
            CI: "1",
            ELECTRON_RENDERER_URL: "",
        },
    });
    const page = await getWindowByUrl(app, "index.html");
    return { app, page };
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
    try {
        await app?.close();
    } catch {
        // ignore teardown failures
    }
}

async function skipOnboarding(page: Page): Promise<void> {
    const modal = page.locator('[data-testid="onboarding-modal"]');
    if (await modal.count() === 0) return;
    await page.getByRole("button", { name: "跳过引导" }).click({ timeout: 5_000 });
    await expect(modal).toHaveCount(0, { timeout: 5_000 });
}

async function openSession(page: Page, title: string): Promise<void> {
    const sidebar = page.getByRole("navigation", { name: "会话列表" });
    const button = sidebar.getByRole("button", { name: title, exact: true });
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
}

async function waitForBoundAgent(page: Page, sessionId: string): Promise<string> {
    await expect.poll(async () => page.evaluate(async (targetSessionId) => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId === targetSessionId)?.id ?? null;
    }, sessionId), { timeout: 15_000 }).not.toBeNull();
    const agentId = await page.evaluate(async (targetSessionId) => {
        const agents = await window.piAPI.agentsList();
        return agents.find((item) => item.sessionId === targetSessionId)?.id ?? null;
    }, sessionId);
    if (!agentId) throw new Error(`No bound agent found for ${sessionId}`);
    return agentId;
}

async function openSettingsWindow(app: ElectronApplication, page: Page): Promise<Page> {
    // Settings BrowserWindow is hide-on-close; reuse via showSettingsWindow rather
    // than waitForEvent("window"), which only fires on first create.
    const settingsWindow = await showSettingsWindow(app, page);
    await expect(settingsWindow.getByRole("tablist", { name: "设置分类" })).toBeVisible({ timeout: 10_000 });
    return settingsWindow;
}

async function closeSettingsWindow(app: ElectronApplication, settingsWindow: Page): Promise<void> {
    await hideSettingsWindow(app, settingsWindow);
}

async function setSwitch(page: Page, label: string, checked: boolean): Promise<void> {
    const control = page.getByRole("switch", { name: label });
    await expect(control).toBeVisible({ timeout: 10_000 });
    const current = (await control.getAttribute("aria-checked")) === "true";
    if (current !== checked) {
        await control.click();
        await expect(control).toHaveAttribute("aria-checked", checked ? "true" : "false");
    }
}

async function ensureRightRailExpanded(page: Page): Promise<void> {
    const expand = page.getByRole("button", { name: "展开右侧栏" });
    if (await expand.isVisible().catch(() => false)) {
        await expand.click();
    }
    await expect(page.getByTestId("right-rail-panel")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Git 工具")).toBeVisible({ timeout: 10_000 });
}

async function selectAgentMode(page: Page, mode: "Build" | "Plan" | "Compose"): Promise<void> {
    const trigger = page.getByRole("button", { name: "选择 Agent 模式" });
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    const menu = page.getByRole("menu", { name: "Agent 模式" });
    await trigger.click();
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await menu.getByRole("menuitemradio", { name: new RegExp(mode, "i") }).click();
    await expect(trigger).toContainText(mode);
}

async function workflowToolLoaded(app: ElectronApplication, sessionId: string): Promise<boolean> {
    return app.evaluate((_electron, targetSessionId) => {
        const target = globalThis as RuntimeGlobals;
        const registry = target.__PI_DESKTOP_TEST_AGENT_REGISTRY__;
        if (!registry) {
            throw new Error("Missing __PI_DESKTOP_TEST_AGENT_REGISTRY__ test hook");
        }
        const agent = registry.list().find((item) => item.sessionId === targetSessionId);
        if (!agent) return false;
        return Boolean(registry.getWorkspaceSession(agent.id).session.getToolDefinition("workflow"));
    }, sessionId);
}

async function startComposeWorkflowRun(
    app: ElectronApplication,
    sessionId: string,
): Promise<void> {
    await app.evaluate((_electron, targetSessionId) => {
        const target = globalThis as RuntimeGlobals;
        const registry = target.__PI_DESKTOP_TEST_AGENT_REGISTRY__;
        if (!registry) {
            throw new Error("Missing __PI_DESKTOP_TEST_AGENT_REGISTRY__ test hook");
        }
        const agent = registry.list().find((item) => item.sessionId === targetSessionId);
        if (!agent) {
            throw new Error(`No bound agent found for ${targetSessionId}`);
        }
        const runtimeSession = registry.getWorkspaceSession(agent.id).session;
        const tool = runtimeSession.getToolDefinition("workflow");
        if (!tool) {
            throw new Error("Workflow tool was not registered");
        }
        const ctx = runtimeSession.extensionRunner.createContext();
        target.__composeWorkflowRuntime__ = {
            running: true,
            updates: [],
            result: undefined,
            error: null,
        };
        void tool.execute(
            "compose-workflow-runtime-e2e",
            {
                operation: "run",
                name: "compose",
                args: {
                    task: "Create two compose probe files and write docs/compose artifacts through the workflow runtime.",
                    featureName: "compose-runtime-e2e",
                    isolateWorktrees: true,
                    maxConcurrent: 2,
                    commit: false,
                },
            },
            undefined,
            (update) => {
                const line = JSON.stringify(update);
                target.__composeWorkflowRuntime__?.updates.push(line);
            },
            ctx,
        ).then((result) => {
            if (!target.__composeWorkflowRuntime__) return;
            target.__composeWorkflowRuntime__.running = false;
            target.__composeWorkflowRuntime__.result = JSON.parse(JSON.stringify(result));
        }).catch((error) => {
            if (!target.__composeWorkflowRuntime__) return;
            target.__composeWorkflowRuntime__.running = false;
            target.__composeWorkflowRuntime__.error = error instanceof Error ? error.message : String(error);
        });
    }, sessionId);
}

async function waitForComposeWorkflowRun(app: ElectronApplication): Promise<void> {
    await expect.poll(async () => app.evaluate(() => {
        const target = globalThis as RuntimeGlobals;
        return {
            running: target.__composeWorkflowRuntime__?.running ?? false,
            updates: target.__composeWorkflowRuntime__?.updates.length ?? 0,
        };
    }), { timeout: 60_000 }).toMatchObject({
        running: false,
    });
}

async function readComposeWorkflowRuntime(app: ElectronApplication): Promise<NonNullable<RuntimeGlobals["__composeWorkflowRuntime__"]>> {
    return app.evaluate(() => {
        const target = globalThis as RuntimeGlobals;
        return target.__composeWorkflowRuntime__ ?? {
            running: false,
            updates: [],
            result: undefined,
            error: "missing runtime state",
        };
    });
}

test.describe("Compose workflow runtime acceptance", () => {
    let app: ElectronApplication | undefined;

    test.setTimeout(180_000);

    test.afterEach(async () => {
        await closeApp(app);
        app = undefined;
    });

    test("runs a real Electron compose workflow runtime with honest workflow fallback", async () => {
        await ensureAcceptanceDir();
        const userDataDir = test.info().outputPath(`compose-runtime-user-data-${Date.now()}`);
        const workspacePath = test.info().outputPath("compose-runtime-workspace");
        const fakePiDir = test.info().outputPath("fake-pi");
        seedComposeWorkspace(workspacePath);
        installFakePi(fakePiDir);

        const launched = await launchApp(userDataDir, fakePiDir);
        app = launched.app;
        const page = launched.page;

        await page.evaluate(async ({ workspacePath, sessionId, sessionTitle }) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const settings = await window.piAPI.getSettings();
            await window.piAPI.setSettings({
                longHorizon: {
                    ...(settings.longHorizon ?? {}),
                    enabled: true,
                    planMode: { enabled: true },
                    composeMode: { enabled: true },
                    workflow: {
                        enabled: true,
                        maxConcurrentAgents: 2,
                        maxLifecycleAgents: 8,
                        maxDepth: 3,
                    },
                    composeWorkflow: { enabled: true },
                },
            });
            const workspace = await window.piAPI.createWorkspace("compose-runtime-e2e", workspacePath);
            if (!workspace || !("id" in workspace)) {
                throw new Error("Failed to create compose workflow acceptance workspace");
            }
            await window.piAPI.selectWorkspace(workspace.path);
            const session = await window.piAPI.createSession(workspace.id, sessionTitle, sessionId);
            await window.piAPI.agentsCreate({
                workspaceId: workspace.id,
                title: `${sessionTitle} Agent`,
                sessionId: session.id,
            });
        }, { workspacePath, sessionId: SESSION_ID, sessionTitle: SESSION_TITLE });

        await page.reload();
        await page.waitForLoadState("domcontentloaded");
        await skipOnboarding(page);
        await openSession(page, SESSION_TITLE);
        await waitForBoundAgent(page, SESSION_ID);
        await ensureRightRailExpanded(page);

        const settingsWindow = await openSettingsWindow(app, page);
        await settingsWindow.getByRole("tab", { name: "长程能力" }).click();
        const dynamicWorkflowSwitch = settingsWindow.getByRole("switch", { name: "Dynamic Workflow" });
        await expect(dynamicWorkflowSwitch).toBeVisible({ timeout: 10_000 });
        // Dynamic Workflow defaults to off; ensure it is enabled before asserting state.
        if (await dynamicWorkflowSwitch.getAttribute("aria-checked") !== "true") {
            await dynamicWorkflowSwitch.click();
        }
        await expect(dynamicWorkflowSwitch).toHaveAttribute("aria-checked", "true");
        await expect(settingsWindow.getByRole("switch", { name: "Compose Workflow" })).toHaveAttribute("aria-checked", "true");
        await settingsWindow.screenshot({ path: join(ACCEPTANCE_DIR, "compose-runtime-01-settings-enabled.png") });
        await closeSettingsWindow(app, settingsWindow);
        await page.bringToFront();

        await selectAgentMode(page, "Compose");
        await expect(await workflowToolLoaded(app, SESSION_ID)).toBe(true);

        await startComposeWorkflowRun(app, SESSION_ID);
        await expect.poll(async () => app.evaluate(() => {
            const target = globalThis as RuntimeGlobals;
            return target.__composeWorkflowRuntime__?.updates.length ?? 0;
        }), { timeout: 20_000 }).toBeGreaterThan(0);
        await waitForComposeWorkflowRun(app);

        const runtime = await readComposeWorkflowRuntime(app);
        if (runtime.error) {
            throw new Error(`Compose workflow runtime threw: ${runtime.error}`);
        }
        const reviewBlockedMerge =
            runtime.result?.details?.run?.error === REVIEW_BLOCKED_ERROR ||
            runtime.result?.details?.run?.outcome?.error === REVIEW_BLOCKED_ERROR;
        if (!runtime.result || ((runtime.result.isError || runtime.result.details?.run?.status === "failed") && !reviewBlockedMerge)) {
            const reportPath = join(workspacePath, "docs", "compose", "reports", "compose-runtime-e2e.md");
            const report = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : "missing workflow report";
            throw new Error([
                "Compose workflow returned a failed result.",
                `Result: ${JSON.stringify(runtime.result, null, 2)}`,
                `Report:\n${report}`,
            ].join("\n\n"));
        }

        await expect.poll(() => existsSync(join(workspacePath, "compose_probe_one.txt")), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => existsSync(join(workspacePath, "compose_probe_two.txt")), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => existsSync(join(workspacePath, "docs", "compose", "specs", "compose-runtime-e2e.md")), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => existsSync(join(workspacePath, "docs", "compose", "plans", "compose-runtime-e2e.md")), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => existsSync(join(workspacePath, "docs", "compose", "reports", "compose-runtime-e2e.md")), { timeout: 10_000 }).toBe(true);

        await page.getByRole("tab", { name: "运行" }).click();
        await page.getByRole("tablist", { name: "运行视图" }).getByRole("tab", { name: "任务" }).click();
        await expect(page.getByText("任务总览")).toBeVisible({ timeout: 10_000 });
        // Scope to the run panel — chat message cards may also list the same phase names.
        const taskOverview = page.getByTestId("motion-panel-run");
        await expect(taskOverview.getByText("Brainstorm")).toBeVisible({ timeout: 10_000 });
        await expect(taskOverview.getByText("Design")).toBeVisible();
        await expect(taskOverview.getByText("Implement")).toBeVisible();
        await expect(taskOverview.getByText("Verify")).toBeVisible();
        await expect(taskOverview.getByText("Review")).toBeVisible();
        await expect(taskOverview.getByText("Report")).toBeVisible();
        await expect(taskOverview.getByText("Merge")).toBeVisible();
        await page.screenshot({ path: join(ACCEPTANCE_DIR, "compose-runtime-02-mode-and-phase-sequence.png"), fullPage: true });

        await page.getByRole("tab", { name: "对话" }).click();
        await ensureRightRailExpanded(page);
        await page.evaluate((currentWorkspacePath) => {
            window.dispatchEvent(new CustomEvent("workspace:git-changed", {
                detail: { workspacePath: currentWorkspacePath, reason: "compose-runtime-e2e" },
            }));
        }, workspacePath);
        const expandFiles = page.getByRole("button", { name: /展开其余 .* 个文件/ });
        if (await expandFiles.isVisible().catch(() => false)) {
            await expandFiles.click();
        }
        await expect(page.getByRole("button", { name: "docs/" })).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("button", { name: "Diff" })).toBeVisible({ timeout: 10_000 });
        await page.screenshot({ path: join(ACCEPTANCE_DIR, "compose-runtime-03-artifacts-written.png"), fullPage: true });

        const disabledSettings = await openSettingsWindow(app, page);
        await disabledSettings.getByRole("tab", { name: "长程能力" }).click();
        await setSwitch(disabledSettings, "Dynamic Workflow", false);
        await setSwitch(disabledSettings, "Compose Workflow", false);
        await disabledSettings.screenshot({ path: join(ACCEPTANCE_DIR, "compose-runtime-04-fallback-disabled-honest.png") });
        await closeSettingsWindow(app, disabledSettings);
        await page.bringToFront();

        await page.evaluate(async ({ workspacePath, sessionId, sessionTitle }) => {
            const workspaces = await window.piAPI.listWorkspaces();
            const workspace = workspaces.find((item) => item.path === workspacePath);
            if (!workspace) {
                throw new Error("Workspace disappeared during fallback validation");
            }
            const session = await window.piAPI.createSession(workspace.id, sessionTitle, sessionId);
            await window.piAPI.agentsCreate({
                workspaceId: workspace.id,
                title: `${sessionTitle} Agent`,
                sessionId: session.id,
            });
        }, { workspacePath, sessionId: FALLBACK_SESSION_ID, sessionTitle: FALLBACK_SESSION_TITLE });
        await page.reload();
        await page.waitForLoadState("domcontentloaded");
        await skipOnboarding(page);
        await openSession(page, FALLBACK_SESSION_TITLE);
        await waitForBoundAgent(page, FALLBACK_SESSION_ID);
        await selectAgentMode(page, "Compose");
        await expect(await workflowToolLoaded(app, FALLBACK_SESSION_ID)).toBe(false);

        const reportContent = readFileSync(join(workspacePath, "docs", "compose", "reports", "compose-runtime-e2e.md"), "utf8");
        expect(reportContent).toContain("Compose Workflow Report");
        expect(reportContent).toContain("task-1");
        expect(reportContent).toContain("task-2");
    });
});
