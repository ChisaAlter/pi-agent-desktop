// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PiModelsFile } from "@shared";
import { I18nProvider } from "../../i18n";
import { useSettingsStore } from "../../stores/settings-store";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("../PiStatusPanel", () => ({
    PiStatusPanel: () => null,
}));

function renderSettings(): void {
    render(
        <I18nProvider>
            <SettingsPanel />
        </I18nProvider>,
    );
}

describe("SettingsPanel 配置中心", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.setItem("pi-desktop.locale", "zh-CN");
        Object.defineProperty(window, "piAPI", {
            value: {
                getFullConfig: vi.fn(async () => ({
                    configPath: "C:/Users/demo/.pi/agent",
                    defaultProvider: "openai",
                    defaultModel: "gpt-4o",
                    providers: [],
                })),
                configGetModels: vi.fn(async () => ({ raw: JSON.stringify({ providers: {} }, null, 2), parsed: { providers: {} } })),
                configGetAuth: vi.fn(async () => ({ raw: "{}", parsed: {} })),
                configGetSettings: vi.fn(async () => ({ raw: "{}", parsed: {} })),
                configSaveRaw: vi.fn(async () => ({ valid: true })),
                configExport: vi.fn(async () => "{}"),
                configImport: vi.fn(async () => ({ valid: true })),
                configListManagedModels: vi.fn(async () => ({
                    configDir: "C:/Users/demo/.pi/agent",
                    defaultProvider: "custom_provider",
                    defaultModel: "custom-model-v1",
                    models: [
                        {
                            providerId: "custom_provider",
                            providerName: "Custom AI Provider",
                            modelId: "custom-model-v1",
                            modelName: "Custom Model V1",
                            baseUrl: "https://api.custom-ai.com/v1",
                            apiType: "openai",
                            source: "json",
                            isDefault: true,
                            hasApiKey: true,
                            apiKeyPreview: "sk-...test",
                            maxTokens: 4096,
                        },
                    ],
                })),
                configSaveManagedModel: vi.fn(async () => ({ valid: true })),
                configDeleteManagedModel: vi.fn(async () => ({ valid: true })),
                configSetDefaultModel: vi.fn(async () => ({ valid: true })),
                configFetchModels: vi.fn(async () => []),
                configTestProvider: vi.fn(async () => ({ ok: true, message: "连接成功" })),
                setSettings: vi.fn(async (settings) => settings),
                loadPiConfig: vi.fn(async () => ({ models: [], currentModel: null })),
            },
            configurable: true,
        });
        vi.spyOn(window, "confirm").mockReturnValue(true);
        useSettingsStore.setState({
            isOpen: true,
            lastWriteError: null,
            piModels: null,
        });
    });

    it("没有 provider 时拉取模型不会传空 baseUrl", async () => {
        renderSettings();

        fireEvent.click(screen.getByRole("tab", { name: "配置中心" }));
        fireEvent.click(await screen.findByRole("button", { name: "拉取模型列表" }));

        expect(window.piAPI.configFetchModels).not.toHaveBeenCalled();
        expect(await screen.findByText("请先在 models.json 中配置 provider baseUrl")).toBeTruthy();
    });

    it("使用当前配置中的 provider 信息拉取模型并测试连接", async () => {
        const parsedModels: PiModelsFile = {
            providers: {
                openai: {
                    name: "OpenAI",
                    baseUrl: "https://api.example.com/v1",
                    apiType: "responses",
                    models: [{ id: "gpt-4o", name: "GPT-4o" }],
                },
            },
        };
        window.piAPI.configGetModels = vi.fn(async () => ({
            raw: JSON.stringify(parsedModels, null, 2),
            parsed: parsedModels,
        }));
        window.piAPI.configGetAuth = vi.fn(async () => ({
            raw: JSON.stringify({ openai: { apiKey: "sk-test" } }, null, 2),
            parsed: { openai: { apiKey: "sk-test" } },
        }));

        renderSettings();

        fireEvent.click(screen.getByRole("tab", { name: "配置中心" }));
        fireEvent.click(await screen.findByRole("button", { name: "拉取模型列表" }));
        await waitFor(() => {
            expect(window.piAPI.configFetchModels).toHaveBeenCalledWith(
                "https://api.example.com/v1",
                "sk-test",
                "responses",
            );
        });

        fireEvent.click(screen.getByRole("button", { name: "测试 Provider" }));
        await waitFor(() => {
            expect(window.piAPI.configTestProvider).toHaveBeenCalledWith({
                baseUrl: "https://api.example.com/v1",
                apiKey: "sk-test",
                modelId: "gpt-4o",
                apiType: "responses",
            });
        });
    });

    it("模型页展示 Pi Agent 模型列表并可测试连接", async () => {
        window.piAPI.configGetAuth = vi.fn(async () => ({
            raw: JSON.stringify({ custom_provider: { key: "sk-real-test" } }),
            parsed: { custom_provider: { key: "sk-real-test" } },
        }));

        renderSettings();

        fireEvent.click(screen.getByRole("tab", { name: "模型" }));

        expect(await screen.findByText("Custom Model V1")).toBeTruthy();
        expect(screen.getByText("Custom AI Provider")).toBeTruthy();
        expect(screen.getByText("默认")).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "测试 Custom Model V1" }));

        await waitFor(() => {
            expect(window.piAPI.configTestProvider).toHaveBeenCalledWith({
                baseUrl: "https://api.custom-ai.com/v1",
                apiKey: "sk-real-test",
                modelId: "custom-model-v1",
                apiType: "openai",
                headers: undefined,
            });
        });
        expect(await screen.findByText("连接成功")).toBeTruthy();
    });

    it("模型页可以新增和删除模型", async () => {
        renderSettings();

        fireEvent.click(screen.getByRole("tab", { name: "模型" }));
        fireEvent.click(await screen.findByRole("button", { name: "新增模型" }));

        fireEvent.change(screen.getByLabelText("Provider ID"), { target: { value: "openai" } });
        fireEvent.change(screen.getByLabelText("Provider 名称"), { target: { value: "OpenAI" } });
        fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://api.openai.com/v1" } });
        fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-new" } });
        fireEvent.change(screen.getByLabelText("模型 ID"), { target: { value: "gpt-4o" } });
        fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "GPT-4o" } });
        fireEvent.click(screen.getByRole("button", { name: "保存模型" }));

        await waitFor(() => {
            expect(window.piAPI.configSaveManagedModel).toHaveBeenCalledWith(
                expect.objectContaining({
                    providerId: "openai",
                    providerName: "OpenAI",
                    baseUrl: "https://api.openai.com/v1",
                    apiKey: "sk-new",
                    modelId: "gpt-4o",
                    modelName: "GPT-4o",
                }),
            );
        });

        fireEvent.click(await screen.findByRole("button", { name: "删除 Custom Model V1" }));
        await waitFor(() => {
            expect(window.piAPI.configDeleteManagedModel).toHaveBeenCalledWith({
                providerId: "custom_provider",
                modelId: "custom-model-v1",
            });
        });
    });
});
