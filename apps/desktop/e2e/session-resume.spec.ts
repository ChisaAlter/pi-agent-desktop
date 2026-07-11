import { expect, test, _electron, type ElectronApplication, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir, readFile } from "node:fs/promises";
import { electronMainEntry } from "../playwright.config";
import { resolveElectronExecutablePath } from "./support/electron-launch";
import { getWindowByUrl } from "./support/electron-windows";

const SESSION_ID = "native-session-resume-e2e";
const MARKER = "PI_DESKTOP_NATIVE_SESSION_RESUME_MARKER";
type NativeSessionGlobals = typeof globalThis & { __PI_DESKTOP_TEST_AGENT_REGISTRY__?: {
    list: () => Array<{ id: string; sessionId?: string; sessionPath?: string }>;
    getWorkspaceSession: (id: string) => { session: {
        sessionFile?: string;
        messages: Array<{ role?: string; content?: Array<{ type?: string; text?: string }> }>;
        sessionManager: { getSessionFile: () => string | undefined };
    } };
} };

async function launchApp(userDataDir: string, configDir: string): Promise<{ app: ElectronApplication; page: Page }> {
    const app = await _electron.launch({
        executablePath: resolveElectronExecutablePath(),
        args: [`--user-data-dir=${userDataDir}`, electronMainEntry],
        env: { ...process.env, CI: "1", ELECTRON_RENDERER_URL: "", PI_DESKTOP_CONFIG_DIR: configDir },
    });
    await getWindowByUrl(app, "index.html");
    return { app, page: await getWindowByUrl(app, "index.html") };
}

async function closeApp(app: ElectronApplication | undefined): Promise<void> {
    try { await app?.close(); } catch { /* Best-effort restart cleanup. */ }
}

async function waitForBoundAgent(page: Page): Promise<void> {
    await expect.poll(
        () => page.evaluate(async (sessionId) => (await window.piAPI.agentsList()).some((agent) => agent.sessionId === sessionId), SESSION_ID),
        { timeout: 20_000 },
    ).toBe(true);
}

async function inspectNativeSession(app: ElectronApplication) {
    return app.evaluate((_electron, input) => {
        const registry = (globalThis as NativeSessionGlobals).__PI_DESKTOP_TEST_AGENT_REGISTRY__;
        if (!registry) throw new Error("Missing production agent registry test hook");
        const agent = registry.list().find((item) => item.sessionId === input.sessionId);
        if (!agent) throw new Error(`No production agent bound to ${input.sessionId}`);
        const session = registry.getWorkspaceSession(agent.id).session;
        return {
            agentPath: agent.sessionPath,
            managerPath: session.sessionManager.getSessionFile(),
            sessionFile: session.sessionFile,
            hasMarker: session.messages.some((message) =>
                message.role === "user"
                && message.content?.some((part) => part.type === "text" && part.text?.includes(input.marker))),
        };
    }, { sessionId: SESSION_ID, marker: MARKER });
}

async function startModelServer(): Promise<{ server: Server; baseUrl: string }> {
    const server = createServer((request, response) => {
        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
            response.writeHead(404).end();
            return;
        }
        request.resume();
        response.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
        });
        const chunks = [
            { choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] },
            { choices: [{ index: 0, delta: { content: "marker persisted" }, finish_reason: null }] },
            { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
        ];
        for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
        response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}

async function stopServer(server: Server | undefined): Promise<void> {
    if (!server) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test.describe("Pi Desktop native Pi session resume", () => {
    let app: ElectronApplication | undefined;
    let modelServer: Server | undefined;
    test.afterEach(async () => {
        await closeApp(app);
        await stopServer(modelServer);
        app = undefined;
        modelServer = undefined;
    });

    test("reopens messages persisted through the public agent prompt flow", async ({}, testInfo) => {
        const userDataDir = testInfo.outputPath("native-session-user-data");
        const configDir = testInfo.outputPath("native-session-config");
        const workspacePath = testInfo.outputPath("native-session-workspace");
        await Promise.all([mkdir(workspacePath, { recursive: true }), mkdir(configDir, { recursive: true })]);
        const model = await startModelServer();
        modelServer = model.server;

        let launched = await launchApp(userDataDir, configDir);
        app = launched.app;
        await launched.page.evaluate(async (input) => {
            window.localStorage.setItem("pi-desktop:firstLaunchDone", "true");
            window.localStorage.setItem("pi-desktop.onboarding.completed", "true");
            const savedModels = await window.piAPI.configSaveModels({
                providers: {
                    "resume-test": {
                        name: "Resume Test",
                        baseUrl: input.baseUrl,
                        api: "openai-completions",
                        apiKey: "test-key",
                        models: [{ id: "resume-model", name: "Resume Model", reasoning: false, input: ["text"] }],
                    },
                },
            });
            if (!savedModels.valid) throw new Error(savedModels.error ?? "Failed to save test model");
            await window.piAPI.setSettings({ provider: "resume-test", model: "resume-model" });
            const workspace = await window.piAPI.createWorkspace("native-session-resume", input.workspacePath);
            if ("code" in workspace) throw new Error(workspace.fallback);
            await window.piAPI.selectWorkspace(workspace.path);
            const session = await window.piAPI.createSession(workspace.id, "Native session resume", input.sessionId);
            const agent = await window.piAPI.agentsCreate({ workspaceId: workspace.id, sessionId: session.id });
            await window.piAPI.agentsPrompt({ agentId: agent.id, message: input.marker });
        }, { workspacePath, sessionId: SESSION_ID, marker: MARKER, baseUrl: model.baseUrl });
        await waitForBoundAgent(launched.page);

        const before = await inspectNativeSession(app);
        expect(before.agentPath).toBeTruthy();
        expect(before.managerPath).toBe(before.agentPath);
        expect(before.sessionFile).toBe(before.agentPath);
        await expect.poll(async () => readFile(before.agentPath!, "utf8"), { timeout: 20_000 }).toContain(MARKER);

        await closeApp(app);
        app = undefined;
        launched = await launchApp(userDataDir, configDir);
        app = launched.app;
        await waitForBoundAgent(launched.page);

        const after = await inspectNativeSession(app);
        expect(after.agentPath).toBe(before.agentPath);
        expect(after.managerPath).toBe(before.agentPath);
        expect(after.sessionFile).toBe(before.agentPath);
        expect(after.hasMarker).toBe(true);
        expect(await readFile(after.agentPath!, "utf8")).toContain(MARKER);
    });
});
