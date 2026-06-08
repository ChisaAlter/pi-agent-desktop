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
                configFetchModels: vi.fn(async () => []),
                configTestProvider: vi.fn(async () => ({ ok: true, message: "连接成功" })),
            },
            configurable: true,
        });
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
});
