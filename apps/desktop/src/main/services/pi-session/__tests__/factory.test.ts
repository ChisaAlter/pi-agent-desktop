import { beforeEach, describe, it, expect, vi } from "vitest";
import {
    createWorkspaceSession,
    resolveBundledComposeExtensionPath,
    resolveBundledDesktopExtensionPaths,
} from "../factory";

const {
    authStorageCreate,
    modelRegistryCreate,
    registerProvider,
    findModel,
    authStorageGetApiKey,
    settingsManagerCreate,
    defaultResourceLoaderCreate,
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
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
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
    createAgentSession: vi.fn().mockResolvedValue({
        session: {
            prompt: vi.fn(),
            subscribe: vi.fn(),
            abort: vi.fn(),
            dispose: vi.fn(),
            bindExtensions: vi.fn().mockResolvedValue(undefined),
        },
        extensionsResult: { extensions: [] },
    }),
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
        const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
        await createWorkspaceSession({
            workspaceId: "ws_2",
            workspacePath: "C:/some/path",
        });
        expect(createAgentSession).toHaveBeenCalledWith(
            expect.objectContaining({
                cwd: "C:/some/path",
                resourceLoader: expect.anything(),
            })
        );
    });

    it("registers configured providers and passes the selected desktop model to the SDK", async () => {
        const { createAgentSession } = await import("@earendil-works/pi-coding-agent");
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
        expect(registerProvider).toHaveBeenCalledTimes(1);
        expect(findModel).toHaveBeenCalledWith("longcat", "LongCat-2.0-Preview");
        expect(createAgentSession).toHaveBeenLastCalledWith(
            expect.objectContaining({
                agentDir: "C:/Users/test/.pi/agent",
                model: selectedModel,
                authStorage: expect.anything(),
                modelRegistry: expect.anything(),
                settingsManager: expect.anything(),
            }),
        );
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
        const { createAgentSession } = await import("@earendil-works/pi-coding-agent");

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
        expect(createAgentSession).toHaveBeenCalledWith(expect.objectContaining({
            noTools: "builtin",
            tools: ["read", "grep"],
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

    it("resolves the bundled desktop compose extension when compose mode is enabled", () => {
        const paths = resolveBundledDesktopExtensionPaths({ composeModeEnabled: true });

        expect(paths).toEqual(expect.arrayContaining([expect.stringContaining("extensions\\compose-mode")]));
    });

    it("resolves the bundled compose extension from both source and built main directories", () => {
        const sourcePath = resolveBundledComposeExtensionPath("C:/Ai/pi-desktop/apps/desktop/src/main/services/pi-session");
        const builtPath = resolveBundledComposeExtensionPath("C:/Ai/pi-desktop/apps/desktop/out/main");

        expect(sourcePath).toContain("extensions\\compose-mode");
        expect(builtPath).toContain("extensions\\compose-mode");
    });
});
