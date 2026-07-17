import { beforeEach, describe, it, expect, vi } from "vitest";
import { join } from "path";
import {
    createWorkspaceSession,
    resolveBundledComposeExtensionPath,
    resolveBundledDesktopExtensionPaths,
    resolveBundledGeneratedUiExtensionPath,
} from "../factory";

const {
    authStorageCreate,
    modelRegistryCreate,
    registerProvider,
    findModel,
    authStorageGetApiKey,
    settingsManagerCreate,
    defaultResourceLoaderCreate,
    sessionManagerOpen,
    sessionSendUserMessage,
    sessionSetModel,
    createAgentSessionMock,
    createGuardedBuiltinsMock,
    sdkMock,
} = vi.hoisted(() => ({
    authStorageCreate: vi.fn(() => ({ getApiKey: vi.fn() })),
    modelRegistryCreate: vi.fn(() => ({
        registerProvider: vi.fn(),
        find: vi.fn(),
    })),
    registerProvider: vi.fn(),
    findModel: vi.fn(),
    authStorageGetApiKey: vi.fn(),
    settingsManagerCreate: vi.fn(() => ({ kind: "settings-manager" })),
    defaultResourceLoaderCreate: vi.fn(),
    sessionManagerOpen: vi.fn((sessionPath?: string) => ({ sessionPath })),
    sessionSendUserMessage: vi.fn(async () => undefined),
    sessionSetModel: vi.fn(async () => undefined),
    createAgentSessionMock: vi.fn().mockResolvedValue({
        session: {
            prompt: vi.fn(),
            sendUserMessage: vi.fn(async () => undefined),
            isStreaming: false,
            subscribe: vi.fn(),
            abort: vi.fn(),
            dispose: vi.fn(),
            bindExtensions: vi.fn().mockResolvedValue(undefined),
            setModel: vi.fn(async () => undefined),
        },
        extensionsResult: { extensions: [] },
    }),
    createGuardedBuiltinsMock: vi.fn(() => [
        { name: "read", execute: vi.fn() },
        { name: "bash", execute: vi.fn() },
        { name: "write", execute: vi.fn() },
    ]),
    sdkMock: {} as Record<string, unknown>,
}));

Object.assign(sdkMock, {
    AuthStorage: {
        create: vi.fn((path?: string) => {
            authStorageCreate(path);
            return { getApiKey: authStorageGetApiKey };
        }),
    },
    createEventBus: vi.fn(() => ({})),
    getAgentDir: vi.fn(() => "C:/tmp/pi-agent"),
    DefaultResourceLoader: vi.fn(function DefaultResourceLoader(options?: unknown) {
        defaultResourceLoaderCreate(options);
        return {
            reload: vi.fn().mockResolvedValue(undefined),
        };
    }),
    ModelRegistry: {
        create: modelRegistryCreate,
    },
    SettingsManager: {
        create: settingsManagerCreate,
    },
    SessionManager: {
        open: sessionManagerOpen,
    },
    createAgentSession: createAgentSessionMock,
});

vi.mock("../sdk-runtime", () => ({
    loadPiSdk: vi.fn(async () => sdkMock),
}));

vi.mock("../../permission/guarded-tools", () => ({
    createGuardedBuiltins: createGuardedBuiltinsMock,
}));

describe("createWorkspaceSession", () => {
    const selectedModel = { provider: "longcat", id: "LongCat-2.0-Preview" };

    beforeEach(() => {
        registerProvider.mockReset();
        findModel.mockReset();
        authStorageGetApiKey.mockReset();
        authStorageGetApiKey.mockResolvedValue("sk-test");
        authStorageCreate.mockClear();
        settingsManagerCreate.mockClear();
        defaultResourceLoaderCreate.mockReset();
        sessionManagerOpen.mockClear();
        sessionSendUserMessage.mockReset();
        sessionSendUserMessage.mockResolvedValue(undefined);
        sessionSetModel.mockReset();
        sessionSetModel.mockResolvedValue(undefined);
        createAgentSessionMock.mockClear();
        createGuardedBuiltinsMock.mockClear();
        createAgentSessionMock.mockResolvedValue({
            session: {
                prompt: vi.fn(),
                sendUserMessage: sessionSendUserMessage,
                isStreaming: false,
                subscribe: vi.fn(),
                abort: vi.fn(),
                dispose: vi.fn(),
                bindExtensions: vi.fn().mockResolvedValue(undefined),
                setModel: sessionSetModel,
            },
            extensionsResult: { extensions: [] },
        });
        modelRegistryCreate.mockReset();
        modelRegistryCreate.mockReturnValue({
            registerProvider,
            find: findModel,
        });
        findModel.mockReturnValue(undefined);
    });

    it("creates a session for a workspace path", async () => {
        const session = await createWorkspaceSession({
            workspaceId: "ws_1",
            workspacePath: process.cwd(),
        });
        expect(session).toBeDefined();
        expect(session.workspaceId).toBe("ws_1");
        expect(session.session).toBeDefined();
        expect(typeof session.dispose).toBe("function");
    });

    it("calls createAgentSession with the given cwd", async () => {
        await createWorkspaceSession({
            workspaceId: "ws_2",
            workspacePath: "C:/some/path",
        });
        expect(createAgentSessionMock).toHaveBeenCalledWith(
            expect.objectContaining({
                cwd: "C:/some/path",
                resourceLoader: expect.anything(),
            })
        );
    });

    it("queues extension-originated sendUserMessage calls as follow-ups when the session is already streaming", async () => {
        const workspaceSession = await createWorkspaceSession({
            workspaceId: "ws_follow_up",
            workspacePath: "C:/repo",
        });

        const session = workspaceSession.session as unknown as {
            isStreaming: boolean;
            sendUserMessage: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => Promise<unknown>;
        };
        session.isStreaming = true;

        await session.sendUserMessage("execute plan now");

        expect(sessionSendUserMessage).toHaveBeenCalledWith("execute plan now", { deliverAs: "followUp" });
    });

    it("keeps idle extension-originated sendUserMessage calls as fresh turns after a deferred tick", async () => {
        const workspaceSession = await createWorkspaceSession({
            workspaceId: "ws_fresh_turn",
            workspacePath: "C:/repo",
        });

        const session = workspaceSession.session as unknown as {
            isStreaming: boolean;
            sendUserMessage: (content: string, options?: { deliverAs?: "steer" | "followUp" }) => Promise<unknown>;
        };
        session.isStreaming = false;

        await session.sendUserMessage("execute after command");

        expect(sessionSendUserMessage).toHaveBeenCalledWith("execute after command", undefined);
    });

    it("registers configured providers and passes the selected desktop model to the SDK", async () => {
        findModel.mockReturnValue(selectedModel);

        await createWorkspaceSession({
            workspaceId: "ws_3",
            workspacePath: "C:/repo",
            agentDir: "C:/Users/test/.pi/agent",
            provider: "longcat",
            modelId: "LongCat-2.0-Preview",
            piAgentConfig: {
                defaultProvider: "longcat",
                defaultModel: "LongCat-2.0-Preview",
                providers: [
                    {
                        id: "longcat",
                        name: "LongCat",
                        baseUrl: "https://api.longcat.chat/openai",
                        api: "openai-completions",
                        models: [
                            {
                                id: "LongCat-2.0-Preview",
                                name: "LongCat 2.0 Preview",
                                provider: "longcat",
                                providerName: "LongCat",
                            },
                        ],
                    },
                    {
                        id: "xunfei",
                        name: "Xunfei",
                        baseUrl: "https://example.invalid",
                        api: "openai-completions",
                        models: [
                            {
                                id: "unused-model",
                                name: "Unused",
                                provider: "xunfei",
                                providerName: "Xunfei",
                            },
                        ],
                    },
                ],
            },
        });

        expect(authStorageCreate).toHaveBeenCalledWith("C:\\Users\\test\\.pi\\agent\\auth.json");
        expect(modelRegistryCreate).toHaveBeenCalledWith(
            expect.anything(),
            "C:\\Users\\test\\.pi\\agent\\models.json",
        );
        expect(registerProvider).toHaveBeenCalledWith(
            "longcat",
            expect.objectContaining({
                baseUrl: "https://api.longcat.chat/openai",
                apiKey: "sk-test",
                api: "openai-completions",
                models: [
                    expect.objectContaining({
                        id: "LongCat-2.0-Preview",
                        api: "openai-completions",
                    }),
                ],
            }),
        );
        expect(registerProvider).toHaveBeenCalledTimes(2);
        expect(findModel).toHaveBeenCalledWith("longcat", "LongCat-2.0-Preview");
        expect(createAgentSessionMock).toHaveBeenLastCalledWith(
            expect.objectContaining({
                agentDir: "C:/Users/test/.pi/agent",
                model: selectedModel,
                authStorage: expect.anything(),
                modelRegistry: expect.anything(),
                settingsManager: expect.anything(),
            }),
        );
    });

    it("switches an existing session to another registered model without recreating it", async () => {
        const nextModel = { provider: "xunfei", id: "spark-pro" };
        findModel.mockImplementation((provider: string, modelId: string) =>
            provider === "xunfei" && modelId === "spark-pro" ? nextModel : undefined,
        );

        const workspaceSession = await createWorkspaceSession({
            workspaceId: "ws_switch",
            workspacePath: "C:/repo",
            piAgentConfig: {
                providers: [
                    {
                        id: "xunfei",
                        name: "Xunfei",
                        baseUrl: "https://example.invalid",
                        api: "openai-completions",
                        models: [{ id: "spark-pro", name: "Spark Pro", provider: "xunfei", providerName: "Xunfei" }],
                    },
                ],
            },
        });

        await expect(workspaceSession.setModel("xunfei", "spark-pro")).resolves.toBe(true);
        expect(sessionSetModel).toHaveBeenCalledWith(nextModel);
        expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
    });

    it("registers configured providers with a provider apiKey env reference when auth storage has no key", async () => {
        authStorageGetApiKey.mockResolvedValue(undefined);
        process.env.PI_DESKTOP_TEST_MODEL_KEY = "sk-provider-env";

        try {
            await createWorkspaceSession({
                workspaceId: "ws_4",
                workspacePath: "C:/repo",
                agentDir: "C:/Users/test/.pi/agent",
                provider: "longcat",
                modelId: "LongCat-2.0-Preview",
                piAgentConfig: {
                    defaultProvider: "longcat",
                    defaultModel: "LongCat-2.0-Preview",
                    providers: [
                        {
                            id: "longcat",
                            name: "LongCat",
                            baseUrl: "https://api.longcat.chat/openai",
                            apiKey: "PI_DESKTOP_TEST_MODEL_KEY",
                            api: "openai-completions",
                            models: [
                                {
                                    id: "LongCat-2.0-Preview",
                                    name: "LongCat 2.0 Preview",
                                    provider: "longcat",
                                    providerName: "LongCat",
                                },
                            ],
                        },
                    ],
                },
            });
        } finally {
            delete process.env.PI_DESKTOP_TEST_MODEL_KEY;
        }

        expect(registerProvider).toHaveBeenCalledWith(
            "longcat",
            expect.objectContaining({
                apiKey: "sk-provider-env",
            }),
        );
    });

    it("forwards noTools/tools to the SDK and merges explicit desktop extension bundles", async () => {
        await createWorkspaceSession({
            workspaceId: "ws_5",
            workspacePath: "C:/repo",
            noTools: "builtin",
            tools: ["read", "grep"],
            desktopExtensions: ["C:/desktop/compose-extension.ts"],
        });

        expect(defaultResourceLoaderCreate).toHaveBeenCalledWith(expect.objectContaining({
            additionalExtensionPaths: expect.arrayContaining(["C:/desktop/compose-extension.ts"]),
        }));
        expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({
            noTools: "builtin",
            tools: ["read", "grep"],
        }));
    });

    it("appends guarded built-ins while preserving existing custom tools", async () => {
        const getRuntimePolicy = vi.fn();
        const actorTool = { name: "actor", execute: vi.fn() };

        await createWorkspaceSession({
            workspaceId: "ws_guarded",
            workspacePath: "C:/repo",
            getRuntimePolicy,
            customTools: [actorTool] as never,
        });

        expect(createGuardedBuiltinsMock).toHaveBeenCalledWith("C:/repo", getRuntimePolicy);
        expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({
            customTools: [
                actorTool,
                expect.objectContaining({ name: "read" }),
                expect.objectContaining({ name: "bash" }),
                expect.objectContaining({ name: "write" }),
            ],
        }));
    });

    it("keeps guarded built-ins effective when a custom tool uses the same name", async () => {
        const customWrite = { name: "write", execute: vi.fn() };

        await createWorkspaceSession({
            workspaceId: "ws_guarded_override",
            workspacePath: "C:/repo",
            getRuntimePolicy: vi.fn(),
            customTools: [customWrite] as never,
        });

        const passedTools = createAgentSessionMock.mock.calls.at(-1)?.[0].customTools as Array<{
            name: string;
            execute: unknown;
        }>;
        const guardedTools = createGuardedBuiltinsMock.mock.results.at(-1)?.value;
        const guardedWrite = guardedTools.find((tool) => tool.name === "write");

        expect(passedTools).toContain(customWrite);
        expect(passedTools.filter((tool) => tool.name === "write").at(-1)).toBe(guardedWrite);
        expect(passedTools.at(-1)).toBe(guardedWrite);
    });

    it("leaves custom tools untouched when no runtime policy callback is supplied", async () => {
        const actorTool = { name: "actor", execute: vi.fn() };

        await createWorkspaceSession({
            workspaceId: "ws_unguarded",
            workspacePath: "C:/repo",
            customTools: [actorTool] as never,
        });

        expect(createGuardedBuiltinsMock).not.toHaveBeenCalled();
        expect(createAgentSessionMock).toHaveBeenCalledWith(expect.objectContaining({
            customTools: [actorTool],
        }));
    });

    it("does not implicitly load plan-mode extension bundles when none are requested", async () => {
        await createWorkspaceSession({
            workspaceId: "ws_6",
            workspacePath: "C:/repo",
        });

        const loaderOptions = defaultResourceLoaderCreate.mock.calls.at(-1)?.[0] as {
            additionalExtensionPaths?: string[];
        } | undefined;
        expect(loaderOptions?.additionalExtensionPaths ?? []).not.toEqual(
            expect.arrayContaining([expect.stringContaining("pi-openplan")]),
        );
    });

    it("resolves the bundled plan-mode extension to the pi-openplan package root", () => {
        const paths = resolveBundledDesktopExtensionPaths({ planModeEnabled: true });

        expect(paths.some((path) => /pi-openplan(?:\\|\/)?$/.test(path))).toBe(true);
        expect(paths.some((path) => /pi-openplan[\\/]extensions(?:$|[\\/])/.test(path))).toBe(false);
    });

    it("resolves the generated ui extension independently of long-horizon modes", () => {
        const paths = resolveBundledDesktopExtensionPaths({ generatedUiEnabled: true });

        expect(paths.some((path) => /extensions[\\/]generated-ui[\\/]index\.ts$/.test(path))).toBe(true);
        expect(paths.some((path) => /compose-mode|pi-openplan/.test(path))).toBe(false);
    });

    it("resolves the bundled desktop compose extension when compose mode is enabled", () => {
        const paths = resolveBundledDesktopExtensionPaths({ composeModeEnabled: true });

        expect(paths.some((path) => /extensions[\\/]compose-mode[\\/]index\.ts$/.test(path))).toBe(true);
        expect(paths.some((path) => /extensions[\\/]compose-mode[\\/]workflow-extension\.ts$/.test(path))).toBe(false);
    });

    it("resolves the bundled desktop compose extension when workflow runtime is enabled without compose mode", () => {
        const workflowPaths = resolveBundledDesktopExtensionPaths({ workflowEnabled: true });
        const composeWorkflowPaths = resolveBundledDesktopExtensionPaths({ composeWorkflowEnabled: true });

        expect(workflowPaths.some((path) => /extensions[\\/]compose-mode[\\/]workflow-extension\.ts$/.test(path))).toBe(true);
        expect(composeWorkflowPaths.some((path) => /extensions[\\/]compose-mode[\\/]workflow-extension\.ts$/.test(path))).toBe(true);
        expect(workflowPaths.some((path) => /extensions[\\/]compose-mode[\\/]index\.ts$/.test(path))).toBe(false);
    });

    it("resolves the bundled compose extension entry file from both source and built main directories", () => {
        const desktopRoot = process.cwd();
        const sourcePath = resolveBundledComposeExtensionPath(join(desktopRoot, "src/main/services/pi-session"));
        const builtPath = resolveBundledComposeExtensionPath(join(desktopRoot, "out/main"));
        const workflowSourcePath = resolveBundledComposeExtensionPath(
            join(desktopRoot, "src/main/services/pi-session"),
            "workflow-extension.ts",
        );
        const workflowBuiltPath = resolveBundledComposeExtensionPath(
            join(desktopRoot, "out/main"),
            "workflow-extension.ts",
        );

        expect(sourcePath).toMatch(/extensions[\\/]compose-mode[\\/]index\.ts$/);
        expect(builtPath).toMatch(/extensions[\\/]compose-mode[\\/]index\.ts$/);
        expect(workflowSourcePath).toMatch(/extensions[\\/]compose-mode[\\/]workflow-extension\.ts$/);
        expect(workflowBuiltPath).toMatch(/extensions[\\/]compose-mode[\\/]workflow-extension\.ts$/);
    });

    it("prefers unpacked desktop extensions from the packaged resources directory", () => {
        const desktopRoot = process.cwd();
        const missingBase = join(desktopRoot, "missing-out-main");
        const composePath = resolveBundledComposeExtensionPath(missingBase, "index.ts", desktopRoot);
        const generatedUiPath = resolveBundledGeneratedUiExtensionPath(missingBase, desktopRoot);

        expect(composePath).toBe(join(desktopRoot, "extensions/compose-mode/index.ts"));
        expect(generatedUiPath).toBe(join(desktopRoot, "extensions/generated-ui/index.ts"));
    });
});
